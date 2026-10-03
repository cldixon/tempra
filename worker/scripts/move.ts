/**
 * `bun run move`: moves one deployment to its tempra.dev names (v2 spec: Move to tempra.dev). Run it
 * for staging first. The new D1, R2 bucket and KV namespace must exist, with their ids in
 * cloudflare.config.ts (step 1, the operator's go-ahead).
 *
 *   bun run move --mode staging|production [--from receive|forward|copy|serve|check]
 *
 *   receive  D1 migrations on the new database; deploy the new Worker expecting the Library
 *            Durable Objects (no LIBRARY binding, cron or domain).
 *   forward  Deploy the former Worker as a forwarder whose Library export names the new Worker:
 *            this commits the handoff. From here the service is down until serve.
 *   copy     Copy every account table and every R2 object to the new database and bucket.
 *   serve    Deploy the new Worker normally, on its custom domain.
 *   check    /healthz on the new host, a redirect from the old one.
 *
 * Every step is safe to repeat; --from resumes after a failure.
 */
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { parseMode } from "../cloudflare.config";

const STEPS = ["receive", "forward", "copy", "serve", "check"] as const;

const { values } = parseArgs({
  options: { mode: { type: "string" }, from: { type: "string" } },
});
if (values.mode !== "staging" && values.mode !== "production") {
  console.error("Usage: bun run move --mode staging|production [--from <step>]");
  process.exit(1);
}
const mode = values.mode;
const start = STEPS.indexOf((values.from ?? "receive") as (typeof STEPS)[number]);
if (start === -1) {
  console.error(`--from is one of ${STEPS.join(", ")}.`);
  process.exit(1);
}
const { d } = parseMode(mode);
process.env.TEMPRA_MODE = mode;
// Imported after TEMPRA_MODE is set: it reads the config for that deployment.
const { applyMigrations, cf, d1Raw, WORKER_DIR } = await import("./cf");
const old = d.formerly;

async function deploy(m: string) {
  console.log(`\n$ cf deploy --mode ${m}`);
  const p = Bun.spawn(["bunx", "cf", "deploy", "--mode", m], {
    cwd: WORKER_DIR,
    env: { ...process.env, CF_SEND_TELEMETRY: "false", CI: "1" },
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });
  if ((await p.exited) !== 0) throw new Error(`cf deploy --mode ${m} failed.`);
}

/** SQL literal for a value D1 returned. */
function lit(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number" || typeof v === "bigint") return String(v);
  if (typeof v === "boolean") return v ? "1" : "0";
  return `'${String(v).replace(/'/g, "''")}'`;
}

/** Parents before children (foreign keys); anything else after, by name. */
const ORDER = ["users", "libraries", "tokens", "sessions"];

async function copyD1() {
  const tables = (
    await d1Raw(
      old.d1.id,
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations' ORDER BY name",
    )
  ).rows.map((r) => String(r[0]));
  tables.sort((a, b) => {
    const i = ORDER.indexOf(a);
    const j = ORDER.indexOf(b);
    return (i === -1 ? ORDER.length : i) - (j === -1 ? ORDER.length : j) || a.localeCompare(b);
  });
  for (const table of tables) {
    const { columns, rows } = await d1Raw(old.d1.id, `SELECT * FROM "${table}"`);
    const cols = columns.map((c) => `"${c}"`).join(", ");
    // Statements in batches of about 50 KB; INSERT OR IGNORE so a repeated copy changes nothing.
    let batch: string[] = [];
    let size = 0;
    const flush = async () => {
      if (!batch.length) return;
      await d1Raw(d.d1.id, `PRAGMA defer_foreign_keys = true;\n${batch.join("\n")}`);
      batch = [];
      size = 0;
    };
    for (const row of rows) {
      const stmt = `INSERT OR IGNORE INTO "${table}" (${cols}) VALUES (${row.map(lit).join(", ")});`;
      batch.push(stmt);
      size += stmt.length;
      if (size > 50_000) await flush();
    }
    await flush();
    const [[count] = [0]] = (await d1Raw(d.d1.id, `SELECT count(*) FROM "${table}"`)).rows;
    console.log(`${table}: ${rows.length} rows, ${count} in ${d.d1.name}`);
    if (Number(count) < rows.length) throw new Error(`${table} did not copy whole.`);
  }
}

interface R2Object {
  key: string;
  size: number;
  http_metadata?: { contentType?: string };
  custom_metadata?: Record<string, string>;
}

async function copyR2() {
  const list = (bucket: string) =>
    cf(["r2", "objects", "list", "--bucket-name", bucket, "--per-page", "1000"]).then(
      (out) => JSON.parse(out) as R2Object[],
    );
  const objects = await list(old.r2);
  if (objects.length >= 1000) throw new Error("Over 1000 objects: add paging to copyR2.");
  const have = new Set((await list(d.r2)).map((o) => o.key));
  const dir = mkdtempSync(join(tmpdir(), "tempra-move-"));
  try {
    for (const o of objects) {
      if (have.has(o.key)) continue;
      if (o.custom_metadata && Object.keys(o.custom_metadata).length) {
        throw new Error(`${o.key} has custom metadata, which this copy would lose.`);
      }
      const file = join(dir, "body");
      const get = Bun.spawn(
        ["bunx", "cf", "r2", "objects", "get", o.key, "--bucket-name", old.r2],
        {
          cwd: WORKER_DIR,
          env: { ...process.env, CF_SEND_TELEMETRY: "false", CI: "1" },
          stdin: "ignore",
          stdout: Bun.file(file),
          stderr: "inherit",
        },
      );
      if ((await get.exited) !== 0 || statSync(file).size !== o.size) {
        throw new Error(`Could not read ${o.key} whole from ${old.r2}.`);
      }
      const type = o.http_metadata?.contentType;
      await cf([
        "r2",
        "objects",
        "put",
        o.key,
        "--bucket-name",
        d.r2,
        "--file",
        file,
        ...(type ? ["--content-type", type] : []),
      ]);
      console.log(`${o.key} (${o.size} bytes)`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const copied = await list(d.r2);
  console.log(`R2: ${objects.length} objects in ${old.r2}, ${copied.length} in ${d.r2}`);
  if (copied.length < objects.length) throw new Error("R2 did not copy whole.");
}

async function check() {
  const url = `https://${d.host}/healthz`;
  for (let i = 0; i < 30; i++) {
    const res = await fetch(url).catch(() => null);
    if (res?.ok) {
      console.log(`${url}: ${res.status}`);
      return;
    }
    // A new custom domain's certificate can take a minute or two.
    await Bun.sleep(10_000);
  }
  throw new Error(`${url} is not answering.`);
}

for (const step of STEPS.slice(start)) {
  console.log(`\n== ${step}`);
  if (step === "receive") {
    console.log((await applyMigrations()).trim());
    await deploy(`${mode}:receive`);
  } else if (step === "forward") {
    await deploy(`${mode}:forward`);
  } else if (step === "copy") {
    await copyD1();
    await copyR2();
  } else if (step === "serve") {
    await deploy(mode);
  } else {
    await check();
  }
}
console.log(
  `\nMoved. Set the digest address: bunx cf workers secrets put OPERATOR_EMAIL (on ${d.name}).`,
);
