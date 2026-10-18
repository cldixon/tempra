/**
 * `bun run deploy`: applies D1 migrations to the account database, then runs `cf deploy`.
 * cf takes the database by ID, read from cloudflare.config.ts. Extra arguments go to `cf deploy`;
 * with --dry-run nothing remote is touched, migrations included. `--mode staging` deploys the
 * staging Worker with its own resources (cloudflare.config.ts).
 *
 *   bun run deploy [--mode staging] [--dry-run] [--message <text>] [...]
 */
const args = process.argv.slice(2);
// Production unless told otherwise; the custom domain is attached only with an explicit mode.
if (!args.includes("--mode")) args.push("--mode", "production");
const i = args.indexOf("--mode");
if (args[i + 1]) process.env.TEMPRA_MODE = args[i + 1];
// Imported after TEMPRA_MODE is set: it reads the config for that deployment.
const { accountsDb, applyMigrations, WORKER_DIR } = await import("./cf");
const { PROPAGATION_DELAYS_MS, workerNotYetVisible } = await import("./cf-retry");

if (!args.includes("--dry-run")) {
  const db = accountsDb();
  console.log(`D1 migrations for ${db.name} (${db.id}):`);
  console.log((await applyMigrations()).trim());
}
/** Runs `cf deploy` once, streaming its output to the log; resolves to its exit code and output. */
async function deployOnce(): Promise<{ code: number; output: string }> {
  const p = Bun.spawn(["bunx", "cf", "deploy", ...args], {
    cwd: WORKER_DIR,
    env: { ...process.env, CF_SEND_TELEMETRY: "false" },
    stdout: "pipe",
    stderr: "pipe",
  });
  let output = "";
  const tee = async (from: ReadableStream<Uint8Array>, to: NodeJS.WriteStream) => {
    const decoder = new TextDecoder();
    for await (const chunk of from) {
      to.write(chunk);
      output += decoder.decode(chunk, { stream: true });
    }
  };
  await Promise.all([tee(p.stdout, process.stdout), tee(p.stderr, process.stderr)]);
  return { code: await p.exited, output };
}

// The first deploy of a new Worker can upload it and then fail to attach its domain because the
// Worker is not visible yet (10007); deploying again is safe, so it is retried for about 60 s.
for (let attempt = 0; ; attempt++) {
  const { code, output } = await deployOnce();
  const wait = PROPAGATION_DELAYS_MS[attempt];
  if (code === 0 || wait === undefined || !workerNotYetVisible(output)) process.exit(code);
  console.error(
    `cf deploy: the new Worker is not visible yet (10007); deploying again in ${wait / 1000} s (${attempt + 1}/${PROPAGATION_DELAYS_MS.length})`,
  );
  await Bun.sleep(wait);
}

export {};
