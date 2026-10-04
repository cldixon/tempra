import { bindings, defineConfig, exports, triggers } from "cf/config";

/**
 * The Worker and its bindings, for the `cf` CLI (`cf dev`, `cf build`, `cf deploy`, `cf workers
 * types`). Scripts import this file too (scripts/cf.ts), so keep it free of Worker code imports.
 *
 * `--mode staging` gives a separate Worker with its own D1, R2 and KV (v2 spec: Operations);
 * `--mode production` is production; `--mode preview` is one pull request's Worker, named by
 * TEMPRA_PR with its resource ids in TEMPRA_PREVIEW_D1_ID and TEMPRA_PREVIEW_KV_ID (scripts/preview.ts
 * sets them); no mode is local dev (`cf dev`), type generation and dry runs.
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
  /** Analytics Engine dataset for metering; tempra_usage unless set. */
  usage?: string;
  /** False: no daily sweep and digest. */
  cron?: false;
}

const PRODUCTION: Deployment = {
  name: "tempra",
  host: "app.tempra.dev",
  d1: { name: "tempra-accounts", id: "60dcce9c-4a20-44db-8d49-1ee040225c4d" },
  r2: "tempra-blobs",
  kv: "9e57232de5b940e4b2319f31da509f42",
  // mail.tempra.dev is onboarded for Cloudflare Email Sending.
  mailFrom: "noreply@mail.tempra.dev",
};

const STAGING: Deployment = {
  name: "tempra-staging",
  host: "staging.tempra.dev",
  d1: { name: "tempra-accounts-staging", id: "d66e1ceb-591e-419d-ba51-9cc32b87f658" },
  r2: "tempra-blobs-staging",
  kv: "b63bffc9b65743a99783013effb89324",
  mailFrom: "noreply@mail.tempra.dev",
};

/**
 * Pull request N's preview (tempra-dev library: delivery/preview-deployments): its own Worker and
 * resources on pr-N.tempra.dev, created and deleted by scripts/preview.ts. The ids are known only
 * once the resources exist, so they come from the environment.
 */
export function previewDeployment(pr: string, ids: { d1?: string; kv?: string } = {}): Deployment {
  if (!/^[1-9][0-9]*$/.test(pr)) throw new Error(`Not a pull request number: ${pr || "(unset)"}`);
  return {
    name: `tempra-pr-${pr}`,
    host: `pr-${pr}.tempra.dev`,
    d1: { name: `tempra-accounts-pr-${pr}`, id: ids.d1 ?? "" },
    r2: `tempra-blobs-pr-${pr}`,
    kv: ids.kv ?? "",
    mailFrom: "noreply@mail.tempra.dev",
    // Previews are short-lived; the daily sweep and digest run on staging and production only,
    // and their traffic stays out of the usage data.
    cron: false,
    usage: "tempra_usage_preview",
  };
}

/** The CLI's environment; the Worker's tsconfig has no Node types, so it is reached by hand. */
const env: Record<string, string | undefined> =
  (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

const COMPATIBILITY = {
  compatibilityDate: "2026-09-01",
  // global_fetch_strictly_public: outbound fetch cannot reach private addresses; required for
  // OAuth Client ID Metadata Documents (the Worker fetches a URL an MCP client names).
  compatibilityFlags: ["nodejs_compat", "global_fetch_strictly_public"],
  observability: { enabled: true },
};

export default defineConfig(({ mode }) => {
  const d: Deployment =
    mode === "preview"
      ? previewDeployment(env.TEMPRA_PR ?? "", {
          d1: env.TEMPRA_PREVIEW_D1_ID,
          kv: env.TEMPRA_PREVIEW_KV_ID,
        })
      : mode === "staging"
        ? STAGING
        : PRODUCTION;
  // No mode: local dev, type generation and dry runs. `cf dev` would send local requests to the
  // custom domain, so the domain is attached only with an explicit --mode.
  const local = !mode;
  if (!d.d1.id || !d.kv) {
    throw new Error(
      `The ${d.name} deployment's D1 and KV ids are not set in cloudflare.config.ts.`,
    );
  }
  return {
    worker: {
      name: d.name,
      entrypoint: "src/index.ts",
      ...COMPATIBILITY,

      // One host per deployment (v2 spec: Operations); no workers.dev, so no second origin.
      domains: local ? [] : [d.host],
      workersDev: false,

      // The daily blob sweep and operator digest (v2 spec: A3), after the libraries' 03:00 exports.
      triggers: d.cron === false ? [] : [triggers.scheduled({ schedule: "30 4 * * *" })],

      // One SQLite-backed Durable Object per library (spec: Backend architecture). Declared as an
      // export; this replaces Wrangler's `migrations` history (its v1 created the same class).
      exports: {
        Library: exports.durableObject({ storage: "sqlite" }),
      },

      env: {
        // Bound by Worker name, which cf/config cannot type; src/index.ts types the stub.
        LIBRARY: bindings.durableObject({ worker: d.name, exportName: "Library" }),

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
        USAGE: bindings.analyticsEngineDataset({ name: d.usage ?? "tempra_usage" }),

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
});
