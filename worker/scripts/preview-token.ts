import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const WORKER = join(import.meta.dir, "..");
const CACHE = join(WORKER, ".mcp-tokens.json");

export type Cached = { url: string; owner: string; slug: string; actor: string; token: string };

/**
 * A write token for the operator's library on PR N's preview: kept in worker/.mcp-tokens.json
 * (gitignored), or made once through `bun run preview token`. Used by `bun run mcp` and
 * `bun run spike`.
 */
export async function previewToken(pr: string, slug: string, actor: string): Promise<Cached> {
  const key = `pr-${pr} ${slug} ${actor}`;
  const cache: Record<string, Cached> = existsSync(CACHE)
    ? JSON.parse(readFileSync(CACHE, "utf8"))
    : {};
  const hit = cache[key];
  if (hit) return hit;
  const proc = Bun.spawn(
    ["bun", "scripts/preview.ts", "token", "--pr", pr, "--slug", slug, "--actor", actor],
    { cwd: WORKER, stdout: "pipe", stderr: "inherit" },
  );
  const out = await new Response(proc.stdout).text();
  if ((await proc.exited) !== 0) throw new Error(`Could not get a token for PR ${pr}.`);
  const made = JSON.parse(out.trim().split("\n").at(-1) ?? "{}") as Cached;
  cache[key] = made;
  writeFileSync(CACHE, `${JSON.stringify(cache, null, 2)}\n`, { mode: 0o600 });
  return made;
}
