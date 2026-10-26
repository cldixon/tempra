/**
 * `bun run preview`: one pull request's preview deployment (tempra-dev library:
 * delivery/preview-deployments). PR N runs as its own Worker, tempra-pr-N on pr-N.tempra.dev, with
 * its own D1, R2 bucket, KV namespace and Queue, so it never touches staging or production data.
 *
 *   bun run preview up --pr N [--email <operator>]   create what is missing, migrate, deploy, seed, smoke
 *   bun run preview down --pr N                      delete the Workers (tempra-pr-N, then its render
 *                                                    Worker tempra-render-pr-N), D1, R2 (emptied
 *                                                    first), KV and Queue
 *   bun run preview sweep --keep 3,7                 tear down every preview whose PR is not listed
 *   bun run preview agents --pr N [--agents 3] [--scenario live] [--pace 2000] [--rounds 5]
 *                              [--patient] [--keep-files] [--email E]
 *                                                    scripted agents on the preview's `agents`
 *                                                    library (scripts/agents.ts); creates nothing
 *                                                    but that library and a token per agent
 *   bun run preview token --pr N --slug S [--actor claude-code/dev]
 *                                                    a write token on the operator's library S
 *                                                    (created if missing), as JSON; used by
 *                                                    `bun run mcp --pr N` (scripts/mcp.ts)
 *
 * `down` and `sweep` take --dry-run: list what would be deleted, delete nothing.
 *
 * Every step is safe to repeat: a re-run or a second push converges. `up` seeds the operator's
 * account (--email, or TEMPRA_PREVIEW_EMAIL) with a copy of the seed library (PREVIEW_SEED_LIBRARY,
 * PREVIEW_SEED_TOKEN, PREVIEW_SEED_URL: scripts/preview-seed.ts, TEMPRA-109), or with none set
 * with Google's four sample bundles, and a `smoke` library; runs the MCP smoke flow against the
 * preview; and writes `url=` and `library_url=` (the seeded copy; empty for the samples) to
 * $GITHUB_OUTPUT. Scripted agents write into a preview only through `agents`.
 */
import { appendFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { previewDeployment } from "../cloudflare.config";

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    pr: { type: "string" },
    keep: { type: "string" },
    email: { type: "string" },
    "dry-run": { type: "boolean" },
    agents: { type: "string" },
    scenario: { type: "string", multiple: true },
    pace: { type: "string" },
    rounds: { type: "string" },
    patient: { type: "boolean" },
    "keep-files": { type: "boolean" },
    slug: { type: "string" },
    actor: { type: "string" },
  },
});
const command = positionals[0];
const dryRun = values["dry-run"] === true;

// Set before cf.ts loads: it resolves cloudflare.config.ts for TEMPRA_MODE once, at import. The
// preview's ids are not known yet, so that resolution gets placeholders; everything that needs the
// real ids (deploy, migrations, seeding) runs as a subprocess with them in its environment.
process.env.TEMPRA_MODE = "preview";
process.env.TEMPRA_PR = values.pr ?? "1";
process.env.TEMPRA_PREVIEW_D1_ID ??= "unresolved";
process.env.TEMPRA_PREVIEW_KV_ID ??= "unresolved";
const { cf, WORKER_DIR } = await import("./cf");

const json = async <T>(args: string[]): Promise<T> => JSON.parse(await cf(args)) as T;

// ------------------------------------------------------------------ finding resources by name

async function d1Id(name: string): Promise<string | null> {
  const list = await json<{ uuid: string; name: string }[]>(["d1", "list", "--name", name]);
  return list.find((d) => d.name === name)?.uuid ?? null;
}

async function kvNamespaces(): Promise<{ id: string; title: string }[]> {
  const all: { id: string; title: string }[] = [];
  for (let page = 1; ; page++) {
    const batch = await json<{ id: string; title: string }[]>([
      "kv",
      "namespaces",
      "list",
      "--per-page",
      "100",
      "--page",
      String(page),
    ]);
    all.push(...batch);
    if (batch.length < 100) return all;
  }
}

async function kvId(title: string): Promise<string | null> {
  return (await kvNamespaces()).find((n) => n.title === title)?.id ?? null;
}

/**
 * A create that Cloudflare answers with "already exists, and you own it" (a listing that missed
 * it, or another run for the same PR) found what `up` wanted: carry on.
 */
async function alreadyOurs(create: Promise<unknown>): Promise<void> {
  try {
    await create;
  } catch (e) {
    if (!/already exists, and you own it/i.test(String(e))) throw e;
    console.log("  (it already exists)");
  }
}

async function buckets(): Promise<string[]> {
  const r = await json<{ buckets?: { name: string }[] }>(["r2", "buckets", "list"]);
  return (r.buckets ?? []).map((b) => b.name);
}

async function queues(): Promise<{ queue_id: string; queue_name: string }[]> {
  return json<{ queue_id: string; queue_name: string }[]>(["queues", "list"]);
}

async function queueId(name: string): Promise<string | null> {
  return (await queues()).find((q) => q.queue_name === name)?.queue_id ?? null;
}

/** Workers per page of `workers list`. */
const WORKERS_PAGE = 100;

/**
 * Every Worker's name, a page at a time: `workers list` answers one page (10 by default), and a
 * sweep that saw only the first page left older previews' Workers up, so their queues could not
 * be deleted either (2026-10-26).
 */
async function workers(): Promise<string[]> {
  const names: string[] = [];
  for (let page = 1; ; page++) {
    const r = await json<{ id?: string; name?: string }[] | { result?: { id: string }[] }>([
      "workers",
      "list",
      "--per-page",
      String(WORKERS_PAGE),
      "--page",
      String(page),
    ]);
    const rows = Array.isArray(r) ? r : (r.result ?? []);
    names.push(...rows.map((w) => (w as { name?: string; id?: string }).name ?? w.id ?? ""));
    if (rows.length < WORKERS_PAGE) return names;
  }
}

/** A queue's consumers, by id. */
async function queueConsumers(queue: string): Promise<string[]> {
  const rows = await json<{ consumer_id?: string }[]>([
    "queues",
    "consumers",
    "list",
    "--queue-id",
    queue,
  ]);
  return rows.flatMap((c) => (c.consumer_id ? [c.consumer_id] : []));
}

// ------------------------------------------------------------------ up

async function up(
  pr: string,
  email: string | undefined,
): Promise<{ url: string; library: string | null }> {
  const names = previewDeployment(pr);
  const url = `https://${names.host}`;

  let d1 = await d1Id(names.d1.name);
  if (!d1) {
    console.log(`Creating D1 ${names.d1.name}`);
    await cf(["d1", "create", "--name", names.d1.name]);
    d1 = await d1Id(names.d1.name);
  }
  if (!(await buckets()).includes(names.r2)) {
    console.log(`Creating R2 ${names.r2}`);
    await alreadyOurs(cf(["r2", "buckets", "create", "--name", names.r2]));
  }
  const kvTitle = `tempra-oauth-pr-${pr}`;
  let kv = await kvId(kvTitle);
  if (!kv) {
    console.log(`Creating KV ${kvTitle}`);
    await cf(["kv", "namespaces", "create", "--title", kvTitle]);
    kv = await kvId(kvTitle);
  }
  if (!d1 || !kv) throw new Error(`Could not create or find the D1 or KV for PR ${pr}.`);
  // The blob sweep's queue (TEMPRA-81): the Worker consumes it, so it must exist before the deploy.
  if (!(await queueId(names.queue))) {
    console.log(`Creating Queue ${names.queue}`);
    await cf(["queues", "create", "--queue-name", names.queue]);
  }

  // The Anthropic key goes to the preview Worker as a secret (below), and the seed token only to
  // the copy (preview-seed.ts); neither to a subprocess.
  const {
    ANTHROPIC_API_KEY: anthropicKey,
    PREVIEW_SEED_TOKEN: _seedToken,
    ...inherited
  } = process.env;
  const env = {
    ...inherited,
    TEMPRA_MODE: "preview",
    TEMPRA_PR: pr,
    TEMPRA_PREVIEW_D1_ID: d1,
    TEMPRA_PREVIEW_KV_ID: kv,
    CF_SEND_TELEMETRY: "false",
  };
  // The deploy script applies the migrations, then runs cf deploy --mode preview.
  await run(["bun", "scripts/deploy.ts", "--mode", "preview"], env, { show: true });
  if (anthropicKey) await setWorkerSecret(names.name, "ANTHROPIC_API_KEY", anthropicKey);
  await waitForHealth(url);
  const library = await seedAndSmoke(url, email, env);
  return { url, library };
}

/**
 * Sets a secret on one preview Worker through Cloudflare's API: the value travels only in the
 * request body, never on a command line or in the log. Previews only (the managed-agent spike,
 * TEMPRA-67, calls Claude with it); staging and production get secrets by hand.
 */
async function setWorkerSecret(worker: string, name: string, text: string) {
  if (!/^tempra-pr-[0-9]+$/.test(worker)) throw new Error(`Not a preview Worker: ${worker}`);
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!account || !token)
    throw new Error("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are needed");
  const r = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${worker}/secrets`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name, text, type: "secret_text" }),
    },
  );
  if (!r.ok) throw new Error(`Setting ${name} on ${worker}: ${r.status}`);
  console.log(`Set ${name} on ${worker}`);
}

/** Runs a command in worker/; returns its output, or with `show` streams it to the log. */
async function run(
  cmd: string[],
  env: Record<string, string | undefined>,
  opts: { show?: boolean } = {},
): Promise<string> {
  const p = Bun.spawn(cmd, {
    cwd: WORKER_DIR,
    env,
    stdout: opts.show ? "inherit" : "pipe",
    stderr: "inherit",
  });
  const out = opts.show ? "" : await new Response(p.stdout as ReadableStream).text();
  if ((await p.exited) !== 0) throw new Error(`${cmd.join(" ")} failed:\n${out}`);
  return out;
}

/** A new custom domain needs its certificate before the first request succeeds. */
async function waitForHealth(url: string, timeoutMs = 600_000) {
  const started = Date.now();
  let last = "";
  while (Date.now() - started < timeoutMs) {
    try {
      const r = await fetch(`${url}/healthz`);
      if (r.ok) return;
      last = `${r.status}`;
    } catch (e) {
      last = (e as Error).message;
    }
    await Bun.sleep(5000);
  }
  throw new Error(`${url}/healthz did not answer within ${timeoutMs / 1000}s (last: ${last}).`);
}

/** The actors of the tokens `preview up` mints for itself, deleted once it is done with them. */
const SEED_ACTOR = "github-actions/preview";
const SMOKE_ACTOR = "github-actions/smoke";

/**
 * Seeds the operator's account, then runs the MCP smoke flow. The library to review against is a
 * copy of the seed library (PREVIEW_SEED_*, preview-seed.ts) when one is configured, else Google's
 * four sample bundles (TEMPRA-109). Returns the copy's owner/slug on the preview, for the PR
 * comment; null for the samples. The tokens it used are deleted after, whatever happened: every
 * run mints new ones, and the operator's Agents page should list only what a person made.
 */
async function seedAndSmoke(
  url: string,
  email: string | undefined,
  env: Record<string, string | undefined>,
): Promise<string | null> {
  try {
    return await seedAndSmokeWith(url, (slug, actor) => seedRemote(slug, actor, email, env));
  } finally {
    // Cleanup never fails the preview: a token left over is noise, not a broken deploy.
    await run(
      ["bun", "scripts/seed.ts", "--remote", "--drop-actors", `${SEED_ACTOR},${SMOKE_ACTOR}`],
      env,
    ).catch((e) => console.log(`Could not delete the setup tokens: ${(e as Error).message}`));
  }
}

async function seedAndSmokeWith(
  url: string,
  seed: (slug: string, actor: string) => Promise<{ owner: string; slug: string; token: string }>,
): Promise<string | null> {
  const { mcpSmoke } = await import("./mcp-smoke");
  const { copyLibrary, importIfEmpty, seedChoice } = await import("./preview-seed");
  const on = (s: { owner: string; slug: string; token: string }) => ({
    url,
    owner: s.owner,
    slug: s.slug,
    token: s.token,
  });

  let library: string | null = null;
  const choice = seedChoice(process.env);
  if (choice.kind === "library") {
    const { source } = choice;
    const s = await seed(source.slug, SEED_ACTOR);
    const done = await copyLibrary(source, on(s));
    console.log(
      done === "imported"
        ? `Copied ${source.owner}/${source.slug} from ${source.url} into ${s.owner}/${s.slug}`
        : `${s.owner}/${s.slug} already has files; kept`,
    );
    library = `${s.owner}/${s.slug}`;
  } else {
    const line = `No seed library (${choice.reason}); seeding the sample bundles.`;
    console.log(choice.warn && process.env.GITHUB_ACTIONS ? `::warning::${line}` : line);
    const { BUNDLES, loadBundle } = await import("../test/fixtures");
    const { writeTar } = await import("../src/util/tar");
    for (const bundle of BUNDLES) {
      const s = await seed(bundle.replace(/_/g, "-"), SEED_ACTOR);
      const done = await importIfEmpty(on(s), async () => ({
        bytes: writeTar(loadBundle(bundle)),
        source: `fixtures/${bundle}`,
      }));
      if (done === "imported") console.log(`Imported ${bundle} into ${s.owner}/${s.slug}`);
    }
  }

  const smoke = await seed("smoke", SMOKE_ACTOR);
  if (!(await mcpSmoke({ url, token: smoke.token }))) throw new Error("MCP smoke failed.");
  return library;
}

/** A library and write token in the preview's D1, owned by the operator's account. */
async function seedRemote(
  slug: string,
  actor: string,
  email: string | undefined,
  env: Record<string, string | undefined>,
) {
  const args = ["bun", "scripts/seed.ts", "--remote", "--json", "--slug", slug, "--actor", actor];
  if (email) args.push("--email", email);
  return JSON.parse((await run(args, env)).trim().split("\n").at(-1) ?? "{}") as {
    token: string;
    owner: string;
    slug: string;
  };
}

/** PR N's preview: its URL, and the environment that reaches its D1 (it must be up). */
async function previewEnv(pr: string) {
  const names = previewDeployment(pr);
  const d1 = await d1Id(names.d1.name);
  const kv = await kvId(`tempra-oauth-pr-${pr}`);
  if (!d1 || !kv) throw new Error(`PR ${pr} has no preview; bring it up first.`);
  // Neither the Anthropic key nor the seed token goes to a subprocess.
  const {
    ANTHROPIC_API_KEY: _anthropicKey,
    PREVIEW_SEED_TOKEN: _seedToken,
    ...inherited
  } = process.env;
  const env = {
    ...inherited,
    TEMPRA_MODE: "preview",
    TEMPRA_PR: pr,
    TEMPRA_PREVIEW_D1_ID: d1,
    TEMPRA_PREVIEW_KV_ID: kv,
    CF_SEND_TELEMETRY: "false",
  };
  return { url: `https://${names.host}`, env };
}

/**
 * A write token on one of the operator's libraries in PR N's preview (created if missing), for
 * an agent session working against the preview (`bun run mcp --pr N`). Prints JSON.
 */
async function token(pr: string, slug: string, actor: string, email: string | undefined) {
  const { url, env } = await previewEnv(pr);
  const s = await seedRemote(slug, actor, email, env);
  console.log(JSON.stringify({ url, owner: s.owner, slug: s.slug, actor, token: s.token }));
}

// ------------------------------------------------------------------ agents

/**
 * Scripted agents against PR N's preview, which must be up: a token per agent on the library
 * `agents` in the operator's account (written to the preview's D1), then the scenarios.
 */
async function agents(pr: string, email: string | undefined): Promise<boolean> {
  const { url, env } = await previewEnv(pr);
  const seeded = [];
  for (let i = 1; i <= Number(values.agents ?? 3); i++) {
    seeded.push(await seedRemote("agents", `claude-code/agent-${i}`, email, env));
  }
  const { formatReport, runAgents } = await import("./agents");
  const report = await runAgents({
    url,
    owner: seeded[0]?.owner ?? "",
    slug: "agents",
    tokens: seeded.map((s) => s.token),
    scenarios: values.scenario,
    pace: Number(values.pace ?? 0),
    rounds: values.rounds ? Number(values.rounds) : undefined,
    keep: values["keep-files"],
    patient: values.patient,
  });
  console.log(formatReport(report));
  return report.ok;
}

// ------------------------------------------------------------------ down and sweep

async function down(pr: string) {
  const names = previewDeployment(pr);
  if (dryRun) {
    console.log(
      `Would delete PR ${pr}: ${names.name}, ${names.render}, ${names.d1.name}, ${names.r2}, tempra-oauth-pr-${pr}, ${names.queue}`,
    );
    return;
  }
  // A Worker that consumes a queue cannot be deleted (Cloudflare 10064): detach it first. The
  // queue itself goes last, once no Worker binds it (11005).
  const queue = await queueId(names.queue);
  if (queue) {
    for (const consumer of await queueConsumers(queue)) {
      console.log(`Removing ${names.queue}'s consumer ${consumer}`);
      await cf(["queues", "consumers", "delete", consumer, "--queue-id", queue, "--force"]);
    }
  }
  const running = await workers();
  if (running.includes(names.name)) {
    console.log(`Deleting Worker ${names.name}`);
    await cf(["workers", "delete", names.name, "--force"]);
  }
  // After the Worker that binds to it (TEMPRA-165).
  if (running.includes(names.render)) {
    console.log(`Deleting Worker ${names.render}`);
    await cf(["workers", "delete", names.render, "--force"]);
  }
  const d1 = await d1Id(names.d1.name);
  if (d1) {
    console.log(`Deleting D1 ${names.d1.name}`);
    await cf(["d1", "delete", d1, "--force"]);
  }
  if ((await buckets()).includes(names.r2)) {
    console.log(`Emptying and deleting R2 ${names.r2}`);
    await emptyBucket(names.r2);
    await cf(["r2", "buckets", "delete", names.r2, "--force"]);
  }
  const kv = await kvId(`tempra-oauth-pr-${pr}`);
  if (kv) {
    console.log(`Deleting KV tempra-oauth-pr-${pr}`);
    await cf(["kv", "namespaces", "delete", kv, "--force"]);
  }
  // After the Worker, which binds it as producer and consumer.
  if (queue) {
    console.log(`Deleting Queue ${names.queue}`);
    await cf(["queues", "delete", queue, "--force"]);
  }
}

/**
 * Deletes every object in a bucket, a page at a time, by key; synchronous, unlike the API's
 * empty-bucket mode (a bulk delete with an empty prefix), which runs as a background job.
 */
async function emptyBucket(bucket: string) {
  let last = "";
  for (;;) {
    const page = await json<{ key: string }[]>([
      "r2",
      "objects",
      "list",
      "--bucket-name",
      bucket,
      "--per-page",
      "1000",
    ]);
    if (page.length === 0) return;
    // A page that comes back unchanged means the delete did nothing: stop rather than spin.
    const first = page[0]?.key ?? "";
    if (first === last) throw new Error(`Could not empty ${bucket}: ${first} is still there.`);
    last = first;
    await cf([
      "r2",
      "objects",
      "bulk-delete",
      "--bucket-name",
      bucket,
      "--body",
      JSON.stringify(page.map((o) => o.key)),
      // Without it cf asks to confirm, prints "Aborted." and still exits 0.
      "--force",
    ]);
  }
}

/** PR numbers that still have a preview resource of any kind. */
async function previews(): Promise<string[]> {
  const found = new Set<string>();
  const add = (name: string, pattern: RegExp) => {
    const m = pattern.exec(name);
    if (m?.[1]) found.add(m[1]);
  };
  for (const w of await workers()) {
    add(w, /^tempra-pr-([0-9]+)$/);
    add(w, /^tempra-render-pr-([0-9]+)$/);
  }
  for (const d of await json<{ name: string }[]>(["d1", "list", "--name", "tempra-accounts-pr-"]))
    add(d.name, /^tempra-accounts-pr-([0-9]+)$/);
  for (const b of await buckets()) add(b, /^tempra-blobs-pr-([0-9]+)$/);
  for (const n of await kvNamespaces()) add(n.title, /^tempra-oauth-pr-([0-9]+)$/);
  for (const q of await queues()) add(q.queue_name, /^tempra-sweep-pr-([0-9]+)$/);
  return [...found].sort((a, b) => Number(a) - Number(b));
}

async function sweep(keep: Set<string>) {
  const stale = (await previews()).filter((pr) => !keep.has(pr));
  console.log(stale.length ? `Tearing down previews: ${stale.join(", ")}` : "No stale previews.");
  for (const pr of stale) await down(pr);
}

// ------------------------------------------------------------------ main

if (command === "up" && values.pr) {
  const { url, library } = await up(
    values.pr,
    values.email || process.env.TEMPRA_PREVIEW_EMAIL || undefined,
  );
  const libraryUrl = library ? `${url}/${library}` : "";
  console.log(`Preview: ${url}${libraryUrl ? ` (library ${libraryUrl})` : ""}`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `url=${url}\nlibrary_url=${libraryUrl}\n`);
  }
} else if (command === "down" && values.pr) {
  await down(values.pr);
} else if (command === "agents" && values.pr) {
  const ok = await agents(values.pr, values.email || process.env.TEMPRA_PREVIEW_EMAIL || undefined);
  process.exit(ok ? 0 : 1);
} else if (command === "token" && values.pr && values.slug) {
  await token(
    values.pr,
    values.slug,
    values.actor ?? "claude-code/dev",
    values.email || process.env.TEMPRA_PREVIEW_EMAIL || undefined,
  );
} else if (command === "sweep" && values.keep !== undefined) {
  await sweep(new Set(values.keep.split(/[\s,]+/).filter(Boolean)));
} else {
  console.error(
    "Usage: bun run preview up --pr N [--email E] | down --pr N | sweep --keep 3,7 (empty: none) | agents --pr N [--agents 3] [--scenario …] [--pace ms] [--rounds n] [--patient] [--keep-files] | token --pr N --slug S [--actor A]",
  );
  process.exit(2);
}
