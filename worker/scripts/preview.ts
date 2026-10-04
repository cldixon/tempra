/**
 * `bun run preview`: one pull request's preview deployment (tempra-dev library:
 * delivery/preview-deployments). PR N runs as its own Worker, tempra-pr-N on pr-N.tempra.dev, with
 * its own D1, R2 bucket and KV namespace, so it never touches staging or production data.
 *
 *   bun run preview up --pr N [--email <operator>]   create what is missing, migrate, deploy, seed, smoke
 *   bun run preview down --pr N                      delete the Worker, D1, R2 (emptied first) and KV
 *   bun run preview sweep --keep 3,7                 tear down every preview whose PR is not listed
 *   bun run preview agents --pr N [--agents 3] [--scenario live] [--pace 2000] [--rounds 5]
 *                              [--patient] [--keep-files] [--email E]
 *                                                    scripted agents on the preview's `agents`
 *                                                    library (scripts/agents.ts); creates nothing
 *                                                    but that library and a token per agent
 *
 * `down` and `sweep` take --dry-run: list what would be deleted, delete nothing.
 *
 * Every step is safe to repeat: a re-run or a second push converges. `up` seeds the operator's
 * account (--email, or TEMPRA_PREVIEW_EMAIL) with Google's four sample bundles and a `smoke`
 * library, runs the MCP smoke flow against the preview, and writes `url=` to $GITHUB_OUTPUT.
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

async function buckets(): Promise<string[]> {
  const r = await json<{ buckets?: { name: string }[] }>(["r2", "buckets", "list"]);
  return (r.buckets ?? []).map((b) => b.name);
}

async function workers(): Promise<string[]> {
  const r = await json<{ id?: string; name?: string }[] | { result?: { id: string }[] }>([
    "workers",
    "list",
  ]);
  const rows = Array.isArray(r) ? r : (r.result ?? []);
  return rows.map((w) => (w as { name?: string; id?: string }).name ?? w.id ?? "");
}

// ------------------------------------------------------------------ up

async function up(pr: string, email: string | undefined): Promise<string> {
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
    await cf(["r2", "buckets", "create", "--name", names.r2]);
  }
  const kvTitle = `tempra-oauth-pr-${pr}`;
  let kv = await kvId(kvTitle);
  if (!kv) {
    console.log(`Creating KV ${kvTitle}`);
    await cf(["kv", "namespaces", "create", "--title", kvTitle]);
    kv = await kvId(kvTitle);
  }
  if (!d1 || !kv) throw new Error(`Could not create or find the D1 or KV for PR ${pr}.`);

  const env = {
    ...process.env,
    TEMPRA_MODE: "preview",
    TEMPRA_PR: pr,
    TEMPRA_PREVIEW_D1_ID: d1,
    TEMPRA_PREVIEW_KV_ID: kv,
    CF_SEND_TELEMETRY: "false",
  };
  // The deploy script applies the migrations, then runs cf deploy --mode preview.
  await run(["bun", "scripts/deploy.ts", "--mode", "preview"], env, { show: true });
  await waitForHealth(url);
  await seedAndSmoke(url, email, env);
  return url;
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

async function seedAndSmoke(
  url: string,
  email: string | undefined,
  env: Record<string, string | undefined>,
) {
  const { mcpSmoke } = await import("./mcp-smoke");
  const { BUNDLES, loadBundle } = await import("../test/fixtures");
  const { writeTar } = await import("../src/util/tar");
  const seed = (slug: string, actor: string) => seedRemote(slug, actor, email, env);

  for (const bundle of BUNDLES) {
    const s = await seed(bundle.replace(/_/g, "-"), "github-actions/preview");
    const lib = `${url}/api/v1/libraries/${s.owner}/${s.slug}`;
    const headers = { Authorization: `Bearer ${s.token}` };
    const tree = (await (await fetch(`${lib}/tree`, { headers })).json()) as {
      entries?: unknown[];
    };
    if ((tree.entries ?? []).length > 0) continue;
    const imp = await fetch(`${lib}/import?source=fixtures/${bundle}`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/x-tar" },
      body: writeTar(loadBundle(bundle)),
    });
    if (!imp.ok) throw new Error(`import ${bundle}: ${imp.status} ${await imp.text()}`);
    console.log(`Imported ${bundle} into ${s.owner}/${s.slug}`);
  }

  const smoke = await seed("smoke", "github-actions/smoke");
  if (!(await mcpSmoke({ url, token: smoke.token }))) throw new Error("MCP smoke failed.");
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

// ------------------------------------------------------------------ agents

/**
 * Scripted agents against PR N's preview, which must be up: a token per agent on the library
 * `agents` in the operator's account (written to the preview's D1), then the scenarios.
 */
async function agents(pr: string, email: string | undefined): Promise<boolean> {
  const names = previewDeployment(pr);
  const url = `https://${names.host}`;
  const d1 = await d1Id(names.d1.name);
  const kv = await kvId(`tempra-oauth-pr-${pr}`);
  if (!d1 || !kv) throw new Error(`PR ${pr} has no preview; bring it up first.`);
  const env = {
    ...process.env,
    TEMPRA_MODE: "preview",
    TEMPRA_PR: pr,
    TEMPRA_PREVIEW_D1_ID: d1,
    TEMPRA_PREVIEW_KV_ID: kv,
    CF_SEND_TELEMETRY: "false",
  };
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
      `Would delete PR ${pr}: ${names.name}, ${names.d1.name}, ${names.r2}, tempra-oauth-pr-${pr}`,
    );
    return;
  }
  if ((await workers()).includes(names.name)) {
    console.log(`Deleting Worker ${names.name}`);
    await cf(["workers", "delete", names.name, "--force"]);
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
  for (const w of await workers()) add(w, /^tempra-pr-([0-9]+)$/);
  for (const d of await json<{ name: string }[]>(["d1", "list", "--name", "tempra-accounts-pr-"]))
    add(d.name, /^tempra-accounts-pr-([0-9]+)$/);
  for (const b of await buckets()) add(b, /^tempra-blobs-pr-([0-9]+)$/);
  for (const n of await kvNamespaces()) add(n.title, /^tempra-oauth-pr-([0-9]+)$/);
  return [...found].sort((a, b) => Number(a) - Number(b));
}

async function sweep(keep: Set<string>) {
  const stale = (await previews()).filter((pr) => !keep.has(pr));
  console.log(stale.length ? `Tearing down previews: ${stale.join(", ")}` : "No stale previews.");
  for (const pr of stale) await down(pr);
}

// ------------------------------------------------------------------ main

if (command === "up" && values.pr) {
  const url = await up(values.pr, values.email || process.env.TEMPRA_PREVIEW_EMAIL || undefined);
  console.log(`Preview: ${url}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `url=${url}\n`);
} else if (command === "down" && values.pr) {
  await down(values.pr);
} else if (command === "agents" && values.pr) {
  const ok = await agents(values.pr, values.email || process.env.TEMPRA_PREVIEW_EMAIL || undefined);
  process.exit(ok ? 0 : 1);
} else if (command === "sweep" && values.keep !== undefined) {
  await sweep(new Set(values.keep.split(/[\s,]+/).filter(Boolean)));
} else {
  console.error(
    "Usage: bun run preview up --pr N [--email E] | down --pr N | sweep --keep 3,7 (empty: none) | agents --pr N [--agents 3] [--scenario …] [--pace ms] [--rounds n] [--patient] [--keep-files]",
  );
  process.exit(2);
}
