/**
 * A body's figures (tempra-dev: app/reader, Figures): an image that is a paragraph's only content
 * (footnote references right after it aside, TEMPRA-218), or a fence drawn as a diagram, numbered from 1 in document order, footnote definitions left
 * out. The one rule for "Figure n": the reader draws by it (app/src/reader/prepare.ts) and the
 * Worker lists by it (MCP `read`, TEMPRA-154), so an agent's figure 3 is the person's.
 *
 * Figure markup that parses (`:::figure`, TEMPRA-161, ./figure.ts) counts each of its images as a
 * figure, in order, carrying the markup; markup that does not parse is walked like any other
 * content, its images alone in their paragraph figures as usual.
 */
import type { Code, FootnoteReference, Image, Paragraph } from "mdast";
import { type ContainerDirective, checkFigure, type FigureSpec, isFigure } from "./figure";
import { type DocNode, walk } from "./tree";

/** Fence languages drawn as figures (the app's registry draws them: app/src/reader/registry.ts). */
export const FIGURE_FENCES: ReadonlySet<string> = new Set(["mermaid", "svg", "vega-lite"]);

/** A fence's caption: `title="…"` (or `'…'`, or one word) in what follows its language. */
export function fenceTitle(meta: string | null | undefined): string | null {
  const m = /(?:^|\s)title=(?:"([^"]*)"|'([^']*)'|(\S+))/.exec(meta ?? "");
  const t = (m?.[1] ?? m?.[2] ?? m?.[3] ?? "").trim();
  return t || null;
}

/**
 * The image a paragraph holds and nothing else, which makes the paragraph a figure. Footnote
 * references after it (`![…](/x.jpg "Caption")[^src]`, citing where it came from) and whitespace
 * between them do not count against it (TEMPRA-218): the reader draws their markers at the end of
 * the caption. Any other text, or a reference before the image, and it is an inline image.
 */
export function soleImage(n: DocNode): Image | null {
  if (n.type !== "paragraph") return null;
  const [first, ...rest] = n.children;
  if (first?.type !== "image") return null;
  for (const c of rest) {
    if (c.type === "footnoteReference") continue;
    if (c.type === "text" && c.value.trim() === "") continue;
    return null;
  }
  return first;
}

/** The footnote references written right after an image in its paragraph, up to the next image. */
export function imageNotes(paragraph: Paragraph, image: Image): FootnoteReference[] {
  const out: FootnoteReference[] = [];
  const at = paragraph.children.indexOf(image);
  if (at < 0) return out;
  for (const c of paragraph.children.slice(at + 1)) {
    if (c.type === "image") break;
    if (c.type === "footnoteReference") out.push(c);
  }
  return out;
}

/** A `:::figure` that parses: the directive and what its markup says. */
export interface FoundMarkup {
  node: ContainerDirective;
  spec: FigureSpec;
}

export type FoundFigure =
  | {
      n: number;
      kind: "image";
      node: Paragraph;
      image: Image;
      /** The footnote references right after the image (its sources), in order. */
      notes: FootnoteReference[];
      markup?: FoundMarkup;
    }
  | { n: number; kind: "diagram"; node: Code };

/** The figures of a tree, in document order (figure n is `[n - 1]`). */
export function findFigures(tree: DocNode): FoundFigure[] {
  const out: FoundFigure[] = [];
  walk(tree, (n) => {
    if (n.type === "footnoteDefinition") return false;
    if (isFigure(n)) {
      const check = checkFigure(n);
      if (!check.ok) return undefined;
      const markup: FoundMarkup = { node: n, spec: check.spec };
      for (const c of n.children) {
        if (c.type !== "paragraph" || c === check.spec.label) continue;
        for (const image of c.children) {
          if (image.type === "image") {
            const notes = imageNotes(c, image);
            out.push({ n: out.length + 1, kind: "image", node: c, image, notes, markup });
          }
        }
      }
      return false;
    }
    const image = soleImage(n);
    if (image && n.type === "paragraph") {
      out.push({ n: out.length + 1, kind: "image", node: n, image, notes: imageNotes(n, image) });
      return false;
    }
    if (n.type === "code" && n.lang && FIGURE_FENCES.has(n.lang.toLowerCase())) {
      out.push({ n: out.length + 1, kind: "diagram", node: n });
    }
    return undefined;
  });
  return out;
}
