import type { LedgerRequest } from "../activity";
import type { ActedBy } from "../agents";
import { fileLabel, type OutlineFile } from "../tree";

/** The requests read for Recently changed and the empty library's line. */
export const READ = 20;

/** How many pages Recently changed lists. */
const RECENT = 5;

/** A page an agent or a person changed lately, as Recently changed lists it. */
export interface Changed {
  path: string;
  title: string;
  ts: string;
  actor: string;
  by: ActedBy | null;
}

/** Events that make a new version of a page (not a comment, a verification or a delete). */
const CHANGES = new Set(["put", "import", "move", "revert"]);

/**
 * The pages changed most recently, newest first, each once, from the newest requests: only
 * pages still in the library (by the path they have now), each with who changed it and when.
 */
export function recentlyChanged(
  requests: LedgerRequest[],
  files: OutlineFile[],
  max = RECENT,
): Changed[] {
  const here = new Map(files.filter((f) => f.kind === "concept").map((f) => [f.path, f]));
  const out: Changed[] = [];
  const listed = new Set<string>();
  for (const r of requests) {
    for (const e of [...r.events].reverse()) {
      if (!CHANGES.has(e.op) || listed.has(e.path)) continue;
      const f = here.get(e.path);
      if (!f) continue;
      listed.add(e.path);
      out.push({ path: e.path, title: fileLabel(f), ts: e.ts, actor: r.actor, by: r.by ?? null });
      if (out.length === max) return out;
    }
  }
  return out;
}
