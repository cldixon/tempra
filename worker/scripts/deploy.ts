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

if (!args.includes("--dry-run")) {
  const db = accountsDb();
  console.log(`D1 migrations for ${db.name} (${db.id}):`);
  console.log((await applyMigrations()).trim());
}
const deploy = Bun.spawn(["bunx", "cf", "deploy", ...args], {
  cwd: WORKER_DIR,
  env: { ...process.env, CF_SEND_TELEMETRY: "false" },
  stdout: "inherit",
  stderr: "inherit",
});
process.exit(await deploy.exited);

export {};
