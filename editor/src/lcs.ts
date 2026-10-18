/**
 * The longest common subsequence of two key lists, for reconciliation (reconcile.ts). It came
 * from the three-way merge, removed with the editor (TEMPRA-99; in git history at 9717592).
 */

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
