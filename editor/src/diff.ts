/**
 * A word-level diff between two versions of a body, located in the newer document: what was
 * added (ranges to highlight) and what was removed (text to show where it was). DOM-free.
 */
import type { Leaf, Plot } from "wordgard/doc";

export interface WordDiff {
  /** Document ranges of the newer version that the older one did not have. */
  added: { from: number; to: number }[];
  /** Text the older version had, at the newer document position where it was. */
  removed: { pos: number; text: string }[];
}

interface Token {
  text: string;
  from: number;
  to: number;
}

/** Words and the whitespace after them, with document positions; blocks end in a break. */
function tokens(doc: Plot.Doc): Token[] {
  const out: Token[] = [];
  let lastBlockEnd = -1;
  doc.iterate((node, pos) => {
    if (node.isPlot && (node as Plot).isTextblock) {
      if (lastBlockEnd !== -1) out.push({ text: "\n", from: lastBlockEnd, to: lastBlockEnd });
      lastBlockEnd = pos + node.length - 1;
      return;
    }
    if (!node.isText) return;
    const text = (node as Leaf<string>).param;
    for (const m of text.matchAll(/\S+\s*|\s+/g)) {
      const from = pos + (m.index ?? 0);
      out.push({ text: m[0], from, to: from + m[0].length });
    }
  });
  return out;
}

/** Myers' O(ND) diff: for each token of `b`, whether it is kept; for `a`, likewise. */
function myers(a: string[], b: string[]): { keptA: boolean[]; keptB: boolean[] } {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const v = new Map<number, number>([[1, 0]]);
  const trace: Map<number, number>[] = [];
  outer: for (let d = 0; d <= max; d++) {
    trace.push(new Map(v));
    for (let k = -d; k <= d; k += 2) {
      const down = k === -d || (k !== d && (v.get(k - 1) ?? -1) < (v.get(k + 1) ?? -1));
      let x = down ? (v.get(k + 1) ?? 0) : (v.get(k - 1) ?? 0) + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v.set(k, x);
      if (x >= n && y >= m) break outer;
    }
  }
  const keptA = new Array<boolean>(n).fill(false);
  const keptB = new Array<boolean>(m).fill(false);
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0 && (x > 0 || y > 0); d--) {
    const vd = trace[d] as Map<number, number>;
    const k = x - y;
    const down = k === -d || (k !== d && (vd.get(k - 1) ?? -1) < (vd.get(k + 1) ?? -1));
    const prevK = down ? k + 1 : k - 1;
    const prevX = vd.get(prevK) ?? 0;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
      keptA[x] = true;
      keptB[y] = true;
    }
    if (d > 0) {
      x = prevX;
      y = prevY;
    }
  }
  return { keptA, keptB };
}

/** What changed from `older` to `newer`, word by word, as positions in `newer`. */
export function wordDiff(older: Plot.Doc, newer: Plot.Doc): WordDiff {
  const a = tokens(older);
  const b = tokens(newer);
  const { keptA, keptB } = myers(
    a.map((t) => t.text),
    b.map((t) => t.text),
  );
  const added: WordDiff["added"] = [];
  b.forEach((t, i) => {
    if (keptB[i] || t.text === "\n") return;
    const last = added[added.length - 1];
    if (last && last.to === t.from) last.to = t.to;
    else added.push({ from: t.from, to: t.to });
  });
  // Removed runs of the older version, placed before the next kept token of the newer one.
  const removed: WordDiff["removed"] = [];
  let ai = 0;
  let bi = 0;
  while (ai < a.length) {
    if (keptA[ai]) {
      while (bi < b.length && !keptB[bi]) bi++;
      ai++;
      bi++;
      continue;
    }
    let text = "";
    while (ai < a.length && !keptA[ai]) {
      text += (a[ai] as Token).text;
      ai++;
    }
    let j = bi;
    while (j < b.length && !keptB[j]) j++;
    const at = j < b.length ? (b[j] as Token).from : (b[b.length - 1]?.to ?? 0);
    const clean = text.replace(/\n/g, " ").trim();
    if (clean) removed.push({ pos: at, text: clean });
  }
  return { added, removed };
}
