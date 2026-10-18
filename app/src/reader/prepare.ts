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
import type { FootnoteDefinition, Nodes } from "mdast";

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
  return { tree, text, options, starts, anchors, headings, markers, footnotes };
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
