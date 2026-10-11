import { dirname } from "./paths";

/**
 * Directory and index health (TEMPRA-64). A directory's index.md is synthesized on read from its
 * concepts' titles and descriptions, so what makes an index poor is the concepts behind it. These
 * checks find that, deterministically and without a model; the structure process stores what they
 * find as `structure` flags, one per concept and one per directory, and never rewrites anything.
 * Free of Worker APIs and of the store, so the thresholds can be tuned on the sample bundles.
 */

/** A description longer than this does not fit an index line. */
export const DESCRIPTION_MAX = 200;
/** A directory holding more concepts than this (directly) is a candidate to split. */
export const LARGE_DIRECTORY = 50;
/**
 * A directory holding one concept and nothing else is a candidate to fold up, from this depth on.
 * Top-level folders (`datasets/`, `tables/`) often start with one concept and grow, so they are
 * left alone; on Google's sample bundles this keeps the check to the one nested case.
 */
export const SINGLE_CONCEPT_DEPTH = 2;

export type StructureCode =
  | "long_description"
  | "description_repeats_title"
  | "missing_descriptions"
  | "orphans"
  | "duplicate_titles"
  | "no_concepts"
  | "single_concept"
  | "large_directory";

export interface StructureIssue {
  code: StructureCode;
  message: string;
  /** The concepts it names, for a directory's issues. */
  paths?: string[];
}

/** What the checks read about one file: its place, and for a concept its index line and links in. */
export interface StructureEntry {
  path: string;
  kind: string;
  concept_id: string;
  title: string | null;
  description: string | null;
  /** Concepts other than itself that link to it or cite it. */
  inbound: number;
}

/** The key a directory's flag is stored under: flags are keyed by concept ID, so `dir:<path>`. */
export const dirKey = (dir: string) => `dir:${dir}`;
export const isDirKey = (key: string) => key.startsWith("dir:");
/** The index.md a directory's issues are reported on ("index.md" at the root). */
export const dirIndex = (dir: string) => (dir === "" ? "index.md" : `${dir}/index.md`);

const ACTIONS: Record<StructureCode, string> = {
  long_description:
    "Shorten the description to one line the index can show (under 200 characters); move detail into the body.",
  description_repeats_title:
    "Rewrite the description to say what the concept is or covers, not its title again.",
  missing_descriptions:
    "Give each concept listed a one-line description; the index shows it beside the title.",
  orphans:
    "Link to each from the concepts it relates to, or cite it as a source; if nothing should, ask whether it belongs here.",
  duplicate_titles:
    "Make the titles say how the concepts differ, or merge them into one if they describe the same thing.",
  no_concepts:
    "Add a concept that describes the attachments here, or move them beside the concept that uses them.",
  single_concept:
    "Move the concept up into the parent directory, unless more concepts are coming here.",
  large_directory: "Split the directory into subdirectories by topic.",
};

/** What to do about a set of issues, one sentence per kind, in a stable order. */
export function structureAction(issues: StructureIssue[]): string {
  const codes = new Set(issues.map((i) => i.code));
  return (Object.keys(ACTIONS) as StructureCode[])
    .filter((c) => codes.has(c))
    .map((c) => ACTIONS[c])
    .join(" ");
}

/** Words for comparing titles: case, accents, punctuation and a plural `s` do not count. */
function words(s: string): string[] {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w !== "" && !STOP.has(w))
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
}
const STOP = new Set(["a", "an", "the", "of"]);

/** Two titles that read the same once case, punctuation, plurals and articles are set aside. */
export const titleKey = (title: string) => words(title).join(" ");

/** The checks on one concept's own index line. */
export function descriptionIssues(
  title: string | null,
  description: string | null,
): StructureIssue[] {
  const d = description?.trim() ?? "";
  if (d === "") return []; // missing_description lint says so, and its directory rolls it up
  const out: StructureIssue[] = [];
  if (d.length > DESCRIPTION_MAX) {
    out.push({
      code: "long_description",
      message: `The description is ${d.length} characters; an index line fits ${DESCRIPTION_MAX}.`,
    });
  }
  if (title) {
    const t = new Set(words(title));
    const w = words(d);
    if (t.size > 0 && w.length > 0 && w.every((x) => t.has(x))) {
      out.push({
        code: "description_repeats_title",
        message: "The description only repeats the title.",
      });
    }
  }
  return out;
}

const depth = (dir: string) => (dir === "" ? 0 : dir.split("/").length);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** Paths for a message: the first few, and how many more. */
const LISTED = 5;
const list = (paths: string[]) =>
  paths
    .slice(0, LISTED)
    .map((p) => `/${p}`)
    .join(", ") + (paths.length > LISTED ? ` and ${paths.length - LISTED} more` : "");

/**
 * Runs the checks. `entries` must hold every file under each directory checked; `dirs` limits
 * which directories (and which directories' concepts) are checked, or null for all of them.
 * Returns the issues by flag key: a concept's ID, or `dirKey(dir)`. Keys with no issues are absent.
 */
export function checkStructure(
  entries: StructureEntry[],
  dirs: Set<string> | null,
  libraryConcepts: number,
): Map<string, StructureIssue[]> {
  const out = new Map<string, StructureIssue[]>();
  const add = (key: string, issue: StructureIssue) => {
    const list = out.get(key);
    if (list) list.push(issue);
    else out.set(key, [issue]);
  };
  const inScope = (dir: string) => dirs === null || dirs.has(dir);

  // Every directory: its own concepts, whether it has subdirectories, concepts anywhere beneath.
  interface Dir {
    concepts: StructureEntry[];
    subdirs: boolean;
    beneath: number;
  }
  const tree = new Map<string, Dir>();
  const at = (dir: string) => {
    let d = tree.get(dir);
    if (!d) {
      d = { concepts: [], subdirs: false, beneath: 0 };
      tree.set(dir, d);
    }
    return d;
  };
  for (const e of entries) {
    const parent = dirname(e.path);
    if (e.kind === "concept") at(parent).concepts.push(e);
    else at(parent);
    // Walk up: each ancestor has a subdirectory, and one more concept beneath it.
    let dir = parent;
    for (;;) {
      if (e.kind === "concept") at(dir).beneath++;
      if (dir === "") break;
      const up = dirname(dir);
      at(up).subdirs = true;
      dir = up;
    }
  }

  for (const [dir, d] of tree) {
    if (!inScope(dir)) continue;
    const key = dirKey(dir);
    const n = d.concepts.length;

    // Concepts: their own index line.
    for (const c of d.concepts) {
      for (const issue of descriptionIssues(c.title, c.description)) add(c.concept_id, issue);
    }

    const missing = d.concepts.filter((c) => !c.description?.trim()).map((c) => c.path);
    if (missing.length > 0) {
      add(key, {
        code: "missing_descriptions",
        message: `${plural(missing.length, "concept")} of ${n} ${missing.length === 1 ? "has" : "have"} no description, so the index shows a bare title: ${list(missing)}.`,
        paths: missing,
      });
    }

    // Orphans, rolled up like descriptions: one item per directory, however many there are, so
    // a library that links little gets a few items to work through, not one per concept.
    const orphans =
      libraryConcepts > 1 ? d.concepts.filter((c) => c.inbound === 0).map((c) => c.path) : [];
    if (orphans.length > 0) {
      add(key, {
        code: "orphans",
        message: `${plural(orphans.length, "concept")} of ${n} ${orphans.length === 1 ? "has" : "have"} no links in from other concepts, only the index: ${list(orphans)}.`,
        paths: orphans,
      });
    }

    const byTitle = new Map<string, string[]>();
    for (const c of d.concepts) {
      const k = c.title ? titleKey(c.title) : "";
      if (k === "") continue;
      byTitle.set(k, [...(byTitle.get(k) ?? []), c.path]);
    }
    const dupes = [...byTitle.values()].filter((p) => p.length > 1);
    if (dupes.length > 0) {
      add(key, {
        code: "duplicate_titles",
        message: `Titles that read the same: ${dupes.map((p) => p.map((x) => `/${x}`).join(" and ")).join("; ")}.`,
        paths: dupes.flat(),
      });
    }

    if (dir !== "" && d.beneath === 0) {
      add(key, {
        code: "no_concepts",
        message: "No concept here or below, only attachments: the index has nothing to describe.",
      });
    } else if (n === 1 && !d.subdirs && depth(dir) >= SINGLE_CONCEPT_DEPTH) {
      add(key, {
        code: "single_concept",
        message: "The directory holds a single concept.",
        paths: [d.concepts[0]?.path ?? ""],
      });
    }
    if (n > LARGE_DIRECTORY) {
      add(key, {
        code: "large_directory",
        message: `${n} concepts directly here; an index reads well up to about ${LARGE_DIRECTORY}.`,
      });
    }
  }
  return out;
}
