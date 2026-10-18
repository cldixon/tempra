/**
 * A word-level diff between two versions of a body, over their texts ({@link docText}): what was
 * added (text ranges of the newer version) and what was removed (text to show where it was, at an
 * offset of the newer version). The reader draws them as `ins` and `del` (tempra-dev: app/reader).
 * DOM-free.
 */
import { ATOM, type DocText } from "./text";

export interface WordDiff {
  /** Text ranges of the newer version that the older one did not have. */
  added: { from: number; to: number }[];
  /** Text the older version had, at the offset of the newer version where it was. */
  removed: { pos: number; text: string }[];
}

interface Token {
  text: string;
  from: number;
  to: number;
}

/** Between textblocks: a token of its own, so blocks line up, never shown as a change. */
const BREAK = " ";

/** Words and the whitespace after them, with text offsets; a break between textblocks. */
function tokens(doc: DocText): Token[] {
  const out: Token[] = [];
  doc.blocks.forEach((tb, i) => {
    // The break sits at the end of the block before, so words removed there show there.
    const prev = doc.blocks[i - 1];
    if (prev) out.push({ text: BREAK, from: prev.to, to: prev.to });
    const text = doc.text.slice(tb.from, tb.to);
    for (const m of text.matchAll(/\S+\s*|\s+/g)) {
      const from = tb.from + (m.index ?? 0);
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

/** What changed from `older` to `newer`, word by word, as text offsets of `newer`. */
export function wordDiff(older: DocText, newer: DocText): WordDiff {
  const a = tokens(older);
  const b = tokens(newer);
  const { keptA, keptB } = myers(
    a.map((t) => t.text),
    b.map((t) => t.text),
  );
  const added: WordDiff["added"] = [];
  b.forEach((t, i) => {
    if (keptB[i] || t.text === BREAK) return;
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
    // Breaks and soft breaks read as spaces; atoms (a footnote marker, an image) are not text.
    const clean = text.replaceAll(BREAK, " ").replace(/\n/g, " ").replaceAll(ATOM, "").trim();
    if (clean) removed.push({ pos: at, text: clean.replace(/\s+/g, " ") });
  }
  return { added, removed };
}
