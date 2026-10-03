import { bindings, defineConfig, exports, triggers } from "cf/config";

/**
 * The Worker and its bindings, for the `cf` CLI (`cf dev`, `cf build`, `cf deploy`, `cf workers
 * types`). Scripts import this file too (scripts/cf.ts), so keep it free of Worker code imports.
 *
 * `--mode staging` gives a separate Worker with its own D1, R2 and KV (v2 spec: Operations);
 * anything else is production (and local dev). `bun run move` adds a phase to the mode
 * (`production:receive`, `staging:forward`) for the move to tempra.dev (v2 spec: Move to tempra.dev).
 */

interface Deployment {
  name: string;
  /** The custom domain that serves everything: /app, /api, /mcp and OAuth. */
  host: string;
  d1: { name: string; id: string };
  r2: string;
  kv: string;
  /** The address sign-in links and the digest come from (Cloudflare Email Service). */
  mailFrom: string;
  /** The deployment before the move to tempra.dev: its Worker forwards here, its data is copied. */
  formerly: { name: string; d1: { name: string; id: string }; r2: string };
}

export const PRODUCTION: Deployment = {
  name: "tempra",
  host: "app.tempra.dev",
  d1: { name: "tempra-accounts", id: "60dcce9c-4a20-44db-8d49-1ee040225c4d" },
  r2: "tempra-blobs",
  kv: "9e57232de5b940e4b2319f31da509f42",
  // mail.tempra.dev is onboarded for Cloudflare Email Sending.
  mailFrom: "noreply@mail.tempra.dev",
  formerly: {
    name: "okf-service",
    d1: { name: "okf-accounts", id: "c36c4e44-2d34-4053-9fee-3ac7f1ad6c0c" },
    r2: "okf-blobs",
  },
};

export const STAGING: Deployment = {
  name: "tempra-staging",
  host: "staging.tempra.dev",
  d1: { name: "tempra-accounts-staging", id: "d66e1ceb-591e-419d-ba51-9cc32b87f658" },
  r2: "tempra-blobs-staging",
  kv: "b63bffc9b65743a99783013effb89324",
  mailFrom: "noreply@mail.tempra.dev",
  formerly: {
    name: "okf-service-staging",
    d1: { name: "okf-accounts-staging", id: "e158a54a-c209-48d6-9265-9a688cffedb8" },
    r2: "okf-blobs-staging",
  },
};

/** A mode is `<deployment>[:<move phase>]`, e.g. `staging`, `production:receive`. */
export function parseMode(mode: string | undefined): {
  d: Deployment;
  phase: "receive" | "forward" | undefined;
} {
  const [env, phase] = (mode ?? "").split(":");
  const d = env === "staging" ? STAGING : PRODUCTION;
  if (!phase) return { d, phase: undefined };
  if (phase === "receive" || phase === "forward") return { d, phase };
  throw new Error(`Unknown move phase ${phase} (receive or forward).`);
}

const COMPATIBILITY = {
  compatibilityDate: "2026-09-01",
  // global_fetch_strictly_public: outbound fetch cannot reach private addresses; required for
  // OAuth Client ID Metadata Documents (the Worker fetches a URL an MCP client names).
  compatibilityFlags: ["nodejs_compat", "global_fetch_strictly_public"],
  observability: { enabled: true },
};

/**
 * Move, step 3: the former Worker hands its libraries' Durable Objects to the new one and forwards
 * every request to the new host. The class stays in its code until the handoff has rolled out.
 */
function forward(d: Deployment) {
  return {
    worker: {
      name: d.formerly.name,
      entrypoint: "src/moved.ts",
      ...COMPATIBILITY,
      exports: {
        Library: exports.durableObject({ state: "transferred", transferredTo: d.name }),
      },
      env: { MOVED_TO: bindings.text(`https://${d.host}`) },
    },
  };
}

export default defineConfig(({ mode }) => {
  const { d, phase } = parseMode(mode);
  if (!d.d1.id || !d.kv) {
    throw new Error(
      `The ${d.name} deployment's D1 and KV ids are not set in cloudflare.config.ts.`,
    );
  }
  // Binding types (`cf workers types`) come from the serving config below, not the forwarder's.
  if (phase === "forward") return forward(d) as unknown as ReturnType<typeof serve>;
  return serve(d, phase !== "receive");
});

/** The Worker; `serving` false is move step 2 (receive): no LIBRARY binding, cron or domain yet. */
function serve(d: Deployment, serving: boolean) {
  return {
    worker: {
      name: d.name,
      entrypoint: "src/index.ts",
      ...COMPATIBILITY,

      // One host per deployment (v2 spec: Operations); no workers.dev, so no second origin.
      domains: serving ? [d.host] : [],
      workersDev: false,

      // The daily blob sweep and operator digest (v2 spec: A3), after the libraries' 03:00 exports.
      triggers: serving ? [triggers.scheduled({ schedule: "30 4 * * *" })] : [],

      // One SQLite-backed Durable Object per library (spec: Backend architecture). Declared as an
      // export; this replaces Wrangler's `migrations` history (its v1 created the same class).
      exports: {
        Library: serving
          ? exports.durableObject({ storage: "sqlite" })
          : exports.durableObject({
              state: "expecting-transfer",
              storage: "sqlite",
              transferFrom: d.formerly.name,
            }),
      },

      env: {
        // Bound by Worker name, which cf/config cannot type; src/index.ts types the stub.
        ...(serving
          ? { LIBRARY: bindings.durableObject({ worker: d.name, exportName: "Library" }) }
          : {}),

        // Account layer (users, libraries, tokens, sessions); migrations in ./migrations.
        DB: bindings.d1(d.d1),

        // Attachment blobs (blobs/<sha256>), exports and restore records.
        BLOBS: bindings.r2({ name: d.r2 }),

        // OAuth clients and grants for MCP apps (Cloudflare's OAuth provider library).
        OAUTH_KV: bindings.kv({ id: d.kv }),

        // Nightly exports (exports/<library id>/<date>/) older than this are deleted; the newest stays.
        EXPORT_RETENTION_DAYS: bindings.text("30"),

        // Who may create an account (v2 spec: A4): open, invite or closed. Local dev and the gate
        // override it in .dev.vars.
        SIGNUP: bindings.text("invite"),

        // Storage per library, SQLite plus attachments (v2 spec: Limits).
        LIBRARY_STORAGE_MB: bindings.text("100"),

        // Per-minute limits (v2 spec: Limits): writes per account, requests per token or app. The
        // per-account numbers in limits.ts match; overrides above them need a separate limiter.
        WRITE_LIMITER: bindings.rateLimit({ namespace: "1001", simple: { limit: 60, period: 60 } }),
        REQUEST_LIMITER: bindings.rateLimit({
          namespace: "1002",
          simple: { limit: 600, period: 60 },
        }),

        // Metering: one data point per request, write and email (v2 spec: Metering).
        USAGE: bindings.analyticsEngineDataset({ name: "tempra_usage" }),

        // The daily digest goes to OPERATOR_EMAIL, a secret (typed in src/env.d.ts); unset sends none.
        MAIL_FROM: bindings.text(d.mailFrom),
        ...(d.mailFrom
          ? { EMAIL: bindings.sendEmail({ allowedSenderAddresses: [d.mailFrom] }) }
          : {}),

        // Secrets (typed in src/env.d.ts): OPERATOR_EMAIL. For local dev, copy .dev.vars.sample to
        // .dev.vars.
      },
    },
  };
}
