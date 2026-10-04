/**
 * @tempra/editor: OKF concept bodies as Wordgard documents (tempra-dev: app/markdown-bridge). The
 * only package that imports Wordgard. This entry is DOM-free (the Worker may import it); the
 * reader's view is `@tempra/editor/view`.
 */
import { type Plot, serialize as toElements } from "wordgard/doc";
import type { Parsed } from "./parse";

export { type WordDiff, wordDiff } from "./diff";
export * from "./links";
export {
  type Footnote,
  type Parsed,
  type ParseOptions,
  parse,
  parseMdast,
  type SourceBlock,
  type TextSegment,
} from "./parse";
export * from "./schema";
export { footnoteMdast, serialize, toMdast } from "./serialize";

/**
 * The markdown offset for a document position: exact inside text that was written as is,
 * otherwise the start of the run or block that holds it. -1 for a position outside the body.
 */
export function markdownOffset(parsed: Parsed, pos: number): number {
  const exact = (s: Parsed["segments"][number]) => s.end - s.pos === s.to - s.from;
  // The run that starts at or holds `pos`, before one that merely ends there.
  const hit =
    parsed.segments.find((s) => pos >= s.pos && pos < s.end) ??
    parsed.segments.find((s) => pos === s.end);
  if (hit) return exact(hit) ? hit.from + (pos - hit.pos) : hit.from;
  let at = 0;
  for (const b of parsed.blocks) {
    if (pos >= at && pos < at + b.node.length) return b.from;
    at += b.node.length;
  }
  return -1;
}

/** The document position for a markdown offset, by the same map; -1 when it maps to none. */
export function documentPos(parsed: Parsed, offset: number): number {
  const exact = (s: Parsed["segments"][number]) => s.end - s.pos === s.to - s.from;
  // A run written as is maps exactly; a coarse one (escapes, entities) only to its start.
  for (const s of parsed.segments) {
    if (exact(s) && offset >= s.from && offset <= s.to) return s.pos + (offset - s.from);
  }
  for (const s of parsed.segments) {
    if (offset >= s.from && offset <= s.to) return s.pos;
  }
  let at = 0;
  for (const b of parsed.blocks) {
    if (offset >= b.from && offset < b.to) return at;
    at += b.node.length;
  }
  return -1;
}

/**
 * A document as an HTML string, with every text and attribute escaped by Wordgard. For small
 * pieces shown outside the reader (footnote definitions beside the body).
 */
export function toHTML(doc: Plot.Doc): string {
  return toElements(doc).toHTML();
}
