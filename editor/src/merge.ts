/**
 * Three-way merge for a person's edit that met a newer version (tempra-dev: app/editor): base is
 * the version the edit started from, mine the edit, theirs the version now in the library.
 * Changes on different lines merge by themselves; where both sides changed the same lines the
 * result holds a conflict for the person to settle. Plain strings, no Wordgard.
 */

export type Segment =
  | { kind: "same"; lines: string[] }
  | { kind: "conflict"; base: string[]; mine: string[]; theirs: string[] };

const equal = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * For each line of `a`, the index of the line of `b` it is matched to in a longest common
 * subsequence (undefined when unmatched). Common prefix and suffix are matched first, so the
 * quadratic table only covers the part that differs.
 */
function matches(a: readonly string[], b: readonly string[]): (number | undefined)[] {
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

/** Merges two edits of `base` line by line (diff3). */
export function merge3(base: string, mine: string, theirs: string): Segment[] {
  const B = base.split("\n");
  const M = mine.split("\n");
  const T = theirs.split("\n");
  const toMine = matches(B, M);
  const toTheirs = matches(B, T);
  const out: Segment[] = [];
  const same = (lines: string[]) => {
    if (lines.length === 0) return;
    const last = out.at(-1);
    if (last?.kind === "same") last.lines.push(...lines);
    else out.push({ kind: "same", lines: [...lines] });
  };
  const chunk = (b: string[], m: string[], t: string[]) => {
    if (equal(m, b)) same(t);
    else if (equal(t, b) || equal(m, t)) same(m);
    else out.push({ kind: "conflict", base: b, mine: m, theirs: t });
  };
  let iB = 0;
  let iM = 0;
  let iT = 0;
  while (iB < B.length || iM < M.length || iT < T.length) {
    // A stable line: matched on both sides, right where each side stands.
    if (iB < B.length && toMine[iB] === iM && toTheirs[iB] === iT) {
      same([B[iB] as string]);
      iB++;
      iM++;
      iT++;
      continue;
    }
    // The next base line both sides kept ends the unstable chunk.
    let j = iB;
    while (j < B.length && (toMine[j] === undefined || toTheirs[j] === undefined)) j++;
    const endM = j < B.length ? (toMine[j] as number) : M.length;
    const endT = j < B.length ? (toTheirs[j] as number) : T.length;
    chunk(B.slice(iB, j), M.slice(iM, endM), T.slice(iT, endT));
    iB = j;
    iM = endM;
    iT = endT;
  }
  return out;
}

/** Whether a merge needs the person: any conflict left. */
export const conflicts = (segments: readonly Segment[]) =>
  segments.filter((s): s is Extract<Segment, { kind: "conflict" }> => s.kind === "conflict");

/** The merged text, each conflict settled by `pick(conflict index)`: mine, theirs, or both. */
export function resolve(
  segments: readonly Segment[],
  pick: (index: number) => "mine" | "theirs" | "both",
): string {
  const lines: string[] = [];
  let n = 0;
  for (const s of segments) {
    if (s.kind === "same") lines.push(...s.lines);
    else {
      const choice = pick(n++);
      if (choice === "mine" || choice === "both") lines.push(...s.mine);
      if (choice === "theirs" || choice === "both") lines.push(...s.theirs);
    }
  }
  return lines.join("\n");
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
