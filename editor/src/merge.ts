/**
 * Three-way merge for a person's edit that met a newer version (tempra-dev: app/editor): base is
 * the version the edit started from, mine the edit, theirs the version now in the library. The
 * body merges block by block: changes to different blocks merge by themselves; where both sides
 * changed the same blocks the result holds a conflict for the person to settle. Frontmatter merges
 * field by field. No Wordgard.
 */
import type { RootContent } from "mdast";
import { type Doc, idOf, signature } from "./tree";

export type Segment<T> =
  | { kind: "same"; items: T[] }
  | { kind: "conflict"; base: T[]; mine: T[]; theirs: T[] };

const equal = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * For each item of `a`, the index of the item of `b` it is matched to in a longest common
 * subsequence (undefined when unmatched). Common prefix and suffix are matched first, so the
 * quadratic table only covers the part that differs.
 */
export function lcs(a: readonly string[], b: readonly string[]): (number | undefined)[] {
  const out: (number | undefined)[] = new Array(a.length).fill(undefined);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) {
    out[start] = start;
    start++;
  }
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
    out[endA] = endB;
  }
  const n = endA - start;
  const m = endB - start;
  if (n === 0 || m === 0) return out;
  // lengths[i][j]: LCS of a[start+i..endA) and b[start+j..endB), filled from the end.
  const width = m + 1;
  const lengths = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lengths[i * width + j] =
        a[start + i] === b[start + j]
          ? (lengths[(i + 1) * width + j + 1] ?? 0) + 1
          : Math.max(lengths[(i + 1) * width + j] ?? 0, lengths[i * width + j + 1] ?? 0);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[start + i] === b[start + j]) {
      out[start + i] = start + j;
      i++;
      j++;
    } else if ((lengths[(i + 1) * width + j] ?? 0) >= (lengths[i * width + j + 1] ?? 0)) i++;
    else j++;
  }
  return out;
}

/** Merges two edits of `base` item by item (diff3), items being equal when their keys are. */
export function merge3<T>(
  base: readonly T[],
  mine: readonly T[],
  theirs: readonly T[],
  key: (item: T) => string,
): Segment<T>[] {
  const [B, M, T] = [base.map(key), mine.map(key), theirs.map(key)];
  const toMine = lcs(B, M);
  const toTheirs = lcs(B, T);
  const out: Segment<T>[] = [];
  const same = (items: readonly T[]) => {
    if (items.length === 0) return;
    const last = out.at(-1);
    if (last?.kind === "same") last.items.push(...items);
    else out.push({ kind: "same", items: [...items] });
  };
  let iB = 0;
  let iM = 0;
  let iT = 0;
  while (iB < B.length || iM < M.length || iT < T.length) {
    // A stable item: matched on both sides, right where each side stands.
    if (iB < B.length && toMine[iB] === iM && toTheirs[iB] === iT) {
      same([base[iB] as T]);
      iB++;
      iM++;
      iT++;
      continue;
    }
    // The next base item both sides kept ends the unstable chunk.
    let j = iB;
    while (j < B.length && (toMine[j] === undefined || toTheirs[j] === undefined)) j++;
    const endM = j < B.length ? (toMine[j] as number) : M.length;
    const endT = j < B.length ? (toTheirs[j] as number) : T.length;
    const [b, m, t] = [B.slice(iB, j), M.slice(iM, endM), T.slice(iT, endT)];
    if (equal(m, b)) same(theirs.slice(iT, endT));
    else if (equal(t, b) || equal(m, t)) same(mine.slice(iM, endM));
    else {
      out.push({
        kind: "conflict",
        base: base.slice(iB, j),
        mine: mine.slice(iM, endM),
        theirs: theirs.slice(iT, endT),
      });
    }
    iB = j;
    iM = endM;
    iT = endT;
  }
  return out;
}

/**
 * Merges two edits of a body block by block. The order of blocks merges by ID; then each block
 * either side changed takes that side's content, and a block both changed differently is a
 * conflict of its own, so edits to neighbouring blocks never collide.
 */
export function mergeDocs(base: Doc, mine: Doc, theirs: Doc): Segment<RootContent>[] {
  const id = (n: RootContent) => idOf(n) ?? signature(n);
  const index = (d: Doc) => new Map(d.children.map((n) => [id(n), n]));
  const [B, M, T] = [index(base), index(mine), index(theirs)];
  const out: Segment<RootContent>[] = [];
  const same = (n: RootContent) => {
    const last = out.at(-1);
    if (last?.kind === "same") last.items.push(n);
    else out.push({ kind: "same", items: [n] });
  };
  for (const seg of merge3(base.children, mine.children, theirs.children, id)) {
    if (seg.kind === "conflict") {
      out.push(seg);
      continue;
    }
    for (const n of seg.items) {
      const k = id(n);
      const [b, m, t] = [B.get(k), M.get(k), T.get(k)] as [RootContent, RootContent, RootContent];
      const [sb, sm, st] = [signature(b), signature(m), signature(t)];
      if (sm === sb) same(t);
      else if (st === sb || sm === st) same(m);
      else out.push({ kind: "conflict", base: [b], mine: [m], theirs: [t] });
    }
  }
  return out;
}

/** The conflicts left in a merge: the person settles each. */
export const conflicts = <T>(segments: readonly Segment<T>[]) =>
  segments.filter((s): s is Extract<Segment<T>, { kind: "conflict" }> => s.kind === "conflict");

/** The merged items, each conflict settled by `pick(conflict index)`: mine, theirs, or both. */
export function resolve<T>(
  segments: readonly Segment<T>[],
  pick: (index: number) => "mine" | "theirs" | "both",
): T[] {
  const out: T[] = [];
  let n = 0;
  for (const s of segments) {
    if (s.kind === "same") out.push(...s.items);
    else {
      const choice = pick(n++);
      if (choice === "mine" || choice === "both") out.push(...s.mine);
      if (choice === "theirs" || choice === "both") out.push(...s.theirs);
    }
  }
  return out;
}

export type FieldMerge =
  | { key: string; kind: "same"; value: unknown }
  | { key: string; kind: "conflict"; base: unknown; mine: unknown; theirs: unknown };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Merges two edits of a frontmatter object field by field: a field one side changed takes that
 * side's value; a field both changed differently is a conflict. Absent is `undefined`.
 */
export function mergeFields(
  base: Record<string, unknown>,
  mine: Record<string, unknown>,
  theirs: Record<string, unknown>,
): FieldMerge[] {
  const keys = [...new Set([...Object.keys(theirs), ...Object.keys(mine), ...Object.keys(base)])];
  return keys.map((key) => {
    const [b, m, t] = [base[key], mine[key], theirs[key]];
    if (same(m, b)) return { key, kind: "same", value: t };
    if (same(t, b) || same(m, t)) return { key, kind: "same", value: m };
    return { key, kind: "conflict", base: b, mine: m, theirs: t };
  });
}
