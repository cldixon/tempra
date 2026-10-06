/**
 * @tempra/editor: OKF concept bodies as Wordgard documents (tempra-dev: app/markdown-bridge). The
 * only package that imports Wordgard. This entry is DOM-free; the reader's view is
 * `@tempra/editor/view`, and the stored tree without Wordgard is `@tempra/editor/doc`.
 */
import { type Plot, serialize as toElements } from "wordgard/doc";

export {
  documentPos,
  type Footnote,
  fromTree,
  linkParam,
  type Parsed,
  type ParseOptions,
  textOffset,
  toTree,
} from "./bridge";
export { type WordDiff, wordDiff } from "./diff";
export * from "./doc";
export * from "./schema";

/**
 * A document as an HTML string, with every text and attribute escaped by Wordgard. For small
 * pieces shown outside the reader (footnote definitions beside the body, a merge's blocks).
 */
export function toHTML(doc: Plot.Doc): string {
  return toElements(doc).toHTML();
}
