/**
 * A stored body made ready to draw (tempra-dev: app/reader): where each textblock starts in the
 * document's text ({@link docText}, which comment anchors count in), each heading's anchor, each
 * footnote reference's marker, and the footnote definitions kept beside the body. Pure and
 * DOM-free: the renderer (Body.tsx) only reads it.
 */
import {
  type Doc,
  type DocNode,
  type DocText,
  docText,
  headingText,
  type LinkTarget,
  linkTarget,
  slugger,
  walk,
} from "@tempra/editor";
import type { Code, FootnoteDefinition, Image, Nodes, Paragraph } from "mdast";

/** How links, images and footnote references in a body point. All optional. */
export interface BodyOptions {
  /** The concept's library path, for relative links. */
  path?: string;
  /**
   * The href for a link or image target, given how it was classified (null when its scheme is
   * unsafe). Return null to drop the link. Defaults to safe external URLs and anchors only.
   */
  href?(target: LinkTarget | null, raw: string, kind: "link" | "image"): string | null;
  /** Library paths links may point to, when known: others are marked broken. */
  exists?(path: string, dir: boolean): boolean;
  /**
   * Where a footnote reference points and what its marker shows (a source's number). `defined`
   * says whether the body has a `[^label]: …` definition. Null: no link, the label in brackets.
   * Called once per reference, in reading order (the body, then the definitions).
   */
  footnote?(label: string, defined: boolean): { href: string | null; mark: string } | null;
}

export interface Heading {
  depth: number;
  text: string;
  /** Its anchor, as the server slugs it. */
  id: string;
  /** The body's first block. */
  first: boolean;
}

/** A footnote definition, shown beside the body (Contents & sources, the marker's card). */
export interface Footnote {
  label: string;
  identifier: string;
  node: FootnoteDefinition;
}

/**
 * A figure (tempra-dev: app/reader, Figures): an image that is a paragraph's only content, or a
 * fence drawn as a diagram. Numbered in document order, from 1, so "Figure n." is stable.
 */
export type Figure = ImageFigure | DiagramFigure;

interface FigureBase {
  /** Its number, from 1, in document order. */
  n: number;
  /** The image's title, else its alt text; a diagram's `title="…"` after the fence's language. */
  caption: string | null;
}

export interface ImageFigure extends FigureBase {
  kind: "image";
  /** The paragraph that holds it (its textblock). */
  node: Paragraph;
  image: Image;
  /** As written in the body. */
  url: string;
  alt: string;
  /** Where it loads from (`href`), or null when it is not shown. */
  src: string | null;
  /** The library path it resolves to, when it is internal. */
  path: string | null;
}

export interface DiagramFigure extends FigureBase {
  kind: "diagram";
  node: Code;
  /** The fence's source. */
  source: string;
}

/** Fence languages drawn as figures (the registry draws them: registry.tsx). */
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

export interface Prepared {
  tree: Doc;
  /** The document's text, for comment anchors and the diff. */
  text: DocText;
  options: BodyOptions;
  /** Where each textblock (paragraph, heading, code, table cell) starts in `text`. */
  starts: Map<DocNode, number>;
  /** Each heading's anchor. */
  anchors: Map<DocNode, string>;
  headings: Heading[];
  /** Each footnote reference's link and marker. */
  markers: Map<DocNode, { href: string | null; mark: string }>;
  footnotes: Footnote[];
  /** The body's figures, in document order (figure n is `figures[n - 1]`). */
  figures: Figure[];
  /** Each figure by its paragraph or fence, and an image figure by its image too. */
  figureOf: Map<DocNode, Figure>;
}

/** The textblocks of a document in the order {@link docText} reads them. */
function textblocks(doc: Doc): DocNode[] {
  const out: DocNode[] = [];
  const visit = (n: DocNode) => {
    switch (n.type) {
      case "footnoteDefinition":
        return;
      case "paragraph":
      case "heading":
      case "code":
        out.push(n);
        return;
      case "table":
        for (const row of n.children) for (const cell of row.children) out.push(cell);
        return;
      default:
        if ("children" in n) for (const c of n.children as Nodes[]) visit(c);
    }
  };
  visit(doc);
  return out;
}

export function prepare(tree: Doc, options: BodyOptions = {}): Prepared {
  const text = docText(tree);
  const starts = new Map<DocNode, number>();
  const blocks = textblocks(tree);
  blocks.forEach((n, i) => {
    const tb = text.blocks[i];
    if (tb) starts.set(n, tb.from);
  });

  const footnotes: Footnote[] = [];
  const defined = new Set<string>();
  walk(tree, (n) => {
    if (n.type === "footnoteDefinition") {
      defined.add(n.label ?? n.identifier);
      footnotes.push({ label: n.label ?? n.identifier, identifier: n.identifier, node: n });
      return false;
    }
    return undefined;
  });

  const anchors = new Map<DocNode, string>();
  const headings: Heading[] = [];
  const anchor = slugger();
  const markers = new Map<DocNode, { href: string | null; mark: string }>();
  const marker = (n: DocNode) => {
    if (n.type !== "footnoteReference") return;
    const label = n.label ?? n.identifier;
    const has = defined.has(label);
    const ref = options.footnote
      ? options.footnote(label, has)
      : has
        ? { href: `#fn-${label}`, mark: `[${label}]` }
        : null;
    markers.set(n, ref ?? { href: null, mark: `[${label}]` });
  };
  // The body first, in reading order, then the definitions: markers are numbered as they are met.
  walk(tree, (n) => {
    if (n.type === "footnoteDefinition") return false;
    if (n.type === "heading") {
      const t = headingText(n.children);
      const id = anchor(t);
      anchors.set(n, id);
      headings.push({ depth: n.depth, text: t, id, first: tree.children[0] === n });
    }
    marker(n);
    return undefined;
  });
  for (const f of footnotes) walk(f.node, (n) => void marker(n));

  // Figures, in document order: images alone in their paragraph and fences drawn as figures.
  const figures: Figure[] = [];
  const figureOf = new Map<DocNode, Figure>();
  walk(tree, (n) => {
    if (n.type === "footnoteDefinition") return false;
    const image = soleImage(n);
    if (image && n.type === "paragraph") {
      const target = linkTarget(options.path ?? "", image.url);
      const f: ImageFigure = {
        n: figures.length + 1,
        kind: "image",
        caption: image.title?.trim() || image.alt?.trim() || null,
        node: n,
        image,
        url: image.url,
        alt: image.alt ?? "",
        src: imageSrc(options, image.url),
        path: target?.kind === "internal" ? target.path : null,
      };
      figures.push(f);
      figureOf.set(n, f);
      figureOf.set(image, f);
      return false;
    }
    if (n.type === "code" && n.lang && FIGURE_FENCES.has(n.lang.toLowerCase())) {
      const f: DiagramFigure = {
        n: figures.length + 1,
        kind: "diagram",
        caption: fenceTitle(n.meta),
        node: n,
        source: n.value,
      };
      figures.push(f);
      figureOf.set(n, f);
    }
    return undefined;
  });
  return { tree, text, options, starts, anchors, headings, markers, footnotes, figures, figureOf };
}

/** Where a link written in the body points, as the reader draws it. */
export interface LinkInfo {
  /** Null for a target a browser must not follow (`javascript:`, `data:`), or one dropped. */
  href: string | null;
  /** The library path it resolves to, if it is internal. */
  path: string | null;
  broken: boolean;
}

export function linkInfo(options: BodyOptions, url: string): LinkInfo {
  const target = linkTarget(options.path ?? "", url);
  const path = target?.kind === "internal" ? target.path : null;
  const broken =
    target?.kind === "internal" && options.exists
      ? !options.exists(target.path, target.dir)
      : false;
  const href = options.href
    ? options.href(target, url, "link")
    : target && target.kind !== "internal"
      ? target.href
      : null;
  return { href, path, broken };
}

/** Where an image written in the body loads from, or null to show its alt text instead. */
export function imageSrc(options: BodyOptions, url: string): string | null {
  const target = linkTarget(options.path ?? "", url);
  if (options.href) return options.href(target, url, "image");
  return target && target.kind !== "internal" ? target.href : null;
}
