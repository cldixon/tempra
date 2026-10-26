/* The tree's data (Tree.svelte): the library's index as `GET …/outline` lists it. */

import { baseName } from "./urls";

/** One file of `GET …/outline`: the library's index, without bodies. */
export interface OutlineFile {
  path: string;
  kind: "dir" | "concept" | "attachment";
  title?: string | null;
  seq?: number | null;
  /** Open comment threads on it. */
  comments?: number;
  /** Past its stale_after, or within 14 days of it (the staleness process's flags). */
  stale?: "stale" | "stale_soon";
}

/** A file as the tree names it: a concept by its title, anything else by its file name. */
export function fileLabel(e: OutlineFile): string {
  return e.kind === "concept" && e.title ? e.title : baseName(e.path);
}
