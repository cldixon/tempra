/**
 * A body's figures (tempra-dev: app/reader, Figures): an image that is a paragraph's only content,
 * or a fence drawn as a diagram, numbered from 1 in document order, footnote definitions left
 * out. The one rule for "Figure n": the reader draws by it (app/src/reader/prepare.ts) and the
 * Worker lists by it (MCP `read`, TEMPRA-154), so an agent's figure 3 is the person's.
 *
 * Figure markup that parses (`:::figure`, TEMPRA-161, ./figure.ts) counts each of its images as a
 * figure, in order, carrying the markup; markup that does not parse is walked like any other
 * content, its images alone in their paragraph figures as usual.
 */
import type { Code, Image, Paragraph } from "mdast";
import { type ContainerDirective, checkFigure, type FigureSpec, isFigure } from "./figure";
import { type DocNode, walk } from "./tree";

/** Fence languages drawn as figures (the app's registry draws them: reader/registry.tsx). */
export const FIGURE_FENCES: ReadonlySet<string> = new Set(["mermaid"]);

/** A fence's caption: `title="…"` (or `'…'`, or one word) in what follows its language. */
export function fenceTitle(meta: string | null | undefined): string | null {
  const m = /(?:^|\s)title=(?:"([^"]*)"|'([^']*)'|(\S+))/.exec(meta ?? "");
  const t = (m?.[1] ?? m?.[2] ?? m?.[3] ?? "").trim();
  return t || null;
}

/** The image a paragraph holds and nothing else, which makes the paragraph a figure. */
export function soleImage(n: DocNode): Image | null {
  if (n.type !== "paragraph" || n.children.length !== 1) return null;
  const only = n.children[0];
  return only?.type === "image" ? only : null;
}

/** A `:::figure` that parses: the directive and what its markup says. */
export interface FoundMarkup {
  node: ContainerDirective;
  spec: FigureSpec;
}

export type FoundFigure =
  | { n: number; kind: "image"; node: Paragraph; image: Image; markup?: FoundMarkup }
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
            out.push({ n: out.length + 1, kind: "image", node: c, image, markup });
          }
        }
      }
      return false;
    }
    const image = soleImage(n);
    if (image && n.type === "paragraph") {
      out.push({ n: out.length + 1, kind: "image", node: n, image });
      return false;
    }
    if (n.type === "code" && n.lang && FIGURE_FENCES.has(n.lang.toLowerCase())) {
      out.push({ n: out.length + 1, kind: "diagram", node: n });
    }
    return undefined;
  });
  return out;
}
