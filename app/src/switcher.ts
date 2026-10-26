/*
 * The quick search's options (QuickSearch.svelte): a library's files (Switcher.svelte) or the
 * person's libraries (LibrarySearch.svelte).
 */

import type { Recent } from "./recent";
import { libraryLabel, type ReachableLibrary } from "./role";
import type { OutlineFile } from "./tree";
import { Urls } from "./urls";

/** One of the library's search's results. */
export interface Hit {
  path: string;
  title: string;
}

/** One row of a quick search: what it reads as, a quiet detail beside it, where it goes. */
export interface Option {
  key: string;
  title: string;
  detail: string;
  href: string;
}

const MAX = 12;

/**
 * A library's options for what was typed (`needle`, lower case): recent files first, then titles
 * and paths from the library's index, then the library's search inside files.
 */
export function fileOptions(
  urls: Urls,
  needle: string,
  recent: Recent[],
  index: OutlineFile[],
  found: Hit[],
): Option[] {
  const matches = (h: Hit) =>
    !needle || h.title.toLowerCase().includes(needle) || h.path.toLowerCase().includes(needle);
  const named = needle
    ? index
        .map((f) => ({ path: f.path, title: f.title ?? "" }))
        .filter(matches)
        // Names that start with what was typed come first.
        .sort(
          (a, b) =>
            Number(!(a.title || a.path).toLowerCase().startsWith(needle)) -
              Number(!(b.title || b.path).toLowerCase().startsWith(needle)) ||
            a.path.localeCompare(b.path),
        )
    : [];
  const out: Option[] = [];
  for (const h of [...recent.filter(matches), ...named, ...found]) {
    if (out.length === MAX) break;
    if (!out.some((o) => o.key === h.path)) {
      out.push({ key: h.path, title: h.title || h.path, detail: h.path, href: urls.file(h.path) });
    }
  }
  return out;
}

/** The person's libraries matching what was typed (`needle`, lower case), by title or owner/slug. */
export function libraryOptions(list: ReachableLibrary[], needle: string): Option[] {
  return list
    .filter(
      (l) =>
        !needle ||
        (l.title ?? "").toLowerCase().includes(needle) ||
        `${l.owner}/${l.slug}`.toLowerCase().includes(needle),
    )
    .slice(0, MAX)
    .map((l) => ({
      key: `${l.owner}/${l.slug}`,
      title: libraryLabel(l),
      detail: l.description ?? "",
      href: new Urls(l.owner, l.slug).tree(""),
    }));
}

/** The search query for what was typed: every word a prefix, as an editor's quick open does. */
export function prefixQuery(words: string[]): string {
  return words.map((w) => `${w.replace(/[*"]/g, "")}*`).join(" ");
}
