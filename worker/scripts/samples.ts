/**
 * Google's four sample bundles as libraries in one account, so there is something to test against
 * (tempra-dev: decisions/chat-testing-on-staging). Previews import them on `bun run preview up`;
 * staging gets them from this script:
 *
 *   TEMPRA_MODE=staging bun run samples --email <operator>
 *
 * The account must exist already (sign in once). Each bundle becomes a library named after it
 * (acme-retail, crypto-bitcoin, ga4, stackoverflow), imported only while it is empty, so a re-run
 * changes nothing. The write token each import uses is revoked once the import is done. Staging
 * only: production is refused, and previews go through `bun run preview up`.
 */
import { parseArgs } from "node:util";
import { hashToken } from "../src/auth";
import { writeTar } from "../src/util/tar";
import { BUNDLES, loadBundle } from "../test/fixtures";

export interface SampleSeed {
  token: string;
  owner: string;
  slug: string;
}

/**
 * Imports each bundle into its library at `url` through the REST API, skipping libraries that
 * already hold files. `seed` makes the library (if missing) and a write token on it; `done` is
 * called with each token once its library is ready.
 */
export async function importSamples(
  url: string,
  seed: (slug: string) => Promise<SampleSeed>,
  done?: (token: string) => Promise<void>,
): Promise<void> {
  for (const bundle of BUNDLES) {
    const s = await seed(bundle.replace(/_/g, "-"));
    try {
      const lib = `${url}/api/v1/libraries/${s.owner}/${s.slug}`;
      const headers = { Authorization: `Bearer ${s.token}` };
      const tree = await fetch(`${lib}/tree`, { headers });
      if (!tree.ok)
        throw new Error(`tree ${s.owner}/${s.slug}: ${tree.status} ${await tree.text()}`);
      const entries = ((await tree.json()) as { entries?: unknown[] }).entries ?? [];
      if (entries.length > 0) {
        console.log(`${s.owner}/${s.slug} already has files; left as it is`);
        continue;
      }
      const imp = await fetch(`${lib}/import?source=fixtures/${bundle}`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/x-tar" },
        body: writeTar(loadBundle(bundle)),
      });
      if (!imp.ok) throw new Error(`import ${bundle}: ${imp.status} ${await imp.text()}`);
      console.log(`Imported ${bundle} into ${s.owner}/${s.slug}`);
    } finally {
      await done?.(s.token);
    }
  }
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { email: { type: "string" } } });
  if (process.env.TEMPRA_MODE !== "staging") {
    console.error(
      "Staging only: run with TEMPRA_MODE=staging. Previews get the samples from `bun run preview up`.",
    );
    process.exit(2);
  }
  if (!values.email) {
    console.error("Usage: TEMPRA_MODE=staging bun run samples --email <account email>");
    process.exit(2);
  }
  const email = values.email;
  const { d1Sql, WORKER_HOST } = await import("./cf");
  const { seed } = await import("./seed");
  if (!WORKER_HOST) throw new Error("The staging deployment has no custom domain in the config.");
  const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
  await importSamples(
    `https://${WORKER_HOST}`,
    (slug) => seed({ slug, actor: "claude-code/samples", email, remote: true }),
    async (token) => {
      await d1Sql(
        `UPDATE tokens SET revoked = ${q(new Date().toISOString())} WHERE hash = ${q(hashToken(token))}`,
        {},
      );
    },
  );
}
