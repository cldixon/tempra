/**
 * Sets a secret on one of Tempra's Workers through Cloudflare's API: the value travels only in the
 * request body, never on a command line or in the log.
 *
 *   ANTHROPIC_API_KEY=… bun scripts/worker-secret.ts --mode staging --name ANTHROPIC_API_KEY
 *
 * The value is the environment variable named by --name; when it is empty the script says so and
 * exits 0, so a deploy job without the GitHub secret skips it quietly. --mode is production or
 * staging (the Worker from cloudflare.config.ts); previews set theirs in scripts/preview.ts.
 * Needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN.
 */
import { parseArgs } from "node:util";
import { deploymentFor } from "../cloudflare.config";

/** Tempra's Workers: production, staging, a preview. Nothing else is touched. */
const OURS = /^tempra(-staging|-pr-[0-9]+)?$/;

export async function setWorkerSecret(worker: string, name: string, text: string) {
  if (!OURS.test(worker)) throw new Error(`Not one of Tempra's Workers: ${worker}`);
  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw new Error(`Not a secret's name: ${name}`);
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

if (import.meta.main) {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: { mode: { type: "string" }, name: { type: "string" } },
  });
  const mode = values.mode;
  const name = values.name ?? "";
  if (mode !== "production" && mode !== "staging") {
    console.error("Usage: bun scripts/worker-secret.ts --mode production|staging --name NAME");
    process.exit(1);
  }
  const value = process.env[name] ?? "";
  if (!value) {
    console.log(
      `${name || "(no name)"} is not set here; not changing the ${mode} Worker's secret.`,
    );
    process.exit(0);
  }
  await setWorkerSecret(deploymentFor(mode).name, name, value);
}
