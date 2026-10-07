/**
 * The Wordgard schema for OKF concept bodies (tempra-dev: app/markdown-bridge): the GFM subset
 * agents write, plus Tempra's own nodes. DOM-free.
 */
import { Elt, Leaf, Mark, Node, Schema } from "wordgard/doc";
import * as T from "wordgard/types";

export {
  Blockquote,
  BulletList,
  Cell,
  Code,
  CodeBlock,
  CodeBlockLanguage,
  Emphasis,
  HeaderCell,
  Heading,
  HorizontalRule,
  LineBreak,
  ListItem,
  OrderedList,
  Paragraph,
  Strikethrough,
  Strong,
  Table,
  TableRow,
} from "wordgard/types";

/**
 * A link. `url` and `title` are the markdown as written; `href` is where the reader points it (a
 * UI page for a library path, the URL for a safe external link, null to drop it), and `path` the
 * library path it resolves to, if any. Only `url` and `title` are serialized.
 */
export interface LinkParam {
  url: string;
  title: string | null;
  href: string | null;
  path: string | null;
  broken: boolean;
}

export const Link = Mark.Type.define<LinkParam>("link", {
  rank: 20,
  shape: {
    element: "a",
    attributes: (p: LinkParam): Record<string, string> => {
      const attrs: Record<string, string> = {};
      if (p.href !== null) attrs.href = p.href;
      if (p.title) attrs.title = p.title;
      if (p.href !== null && /^(?:https?:)?\/\//i.test(p.href)) attrs.rel = "noopener noreferrer";
      const cls = [p.path !== null ? "internal" : "", p.broken ? "broken" : ""].filter(Boolean);
      if (cls.length) attrs.class = cls.join(" ");
      return attrs;
    },
  },
});

/** An image: `url`, `alt` and `title` as written; `src` where the reader loads it from, or null. */
export interface ImageParam {
  url: string;
  alt: string;
  title: string | null;
  src: string | null;
}

export const Image = Leaf.Type.define<ImageParam>("image", {
  inline: true,
  group: [Node.Group.Inline],
  shape: {
    structure: (p: ImageParam) =>
      p.src === null
        ? Elt.mk("span", { class: "image-dropped" }, [p.alt])
        : Elt.mk("img", {
            src: p.src,
            alt: p.alt,
            loading: "lazy",
            ...(p.title ? { title: p.title } : {}),
          }),
  },
  toText: (n: Leaf) => (n.param as ImageParam).alt,
});

/**
 * A footnote reference, `[^label]`. `identifier` is the normalized label, as mdast keeps it;
 * `href` is where the reader points it (the cited source, or the footnote), or null.
 */
export interface FootnoteParam {
  label: string;
  identifier: string;
  href: string | null;
  /** What the marker shows (a source's number); the label in brackets when not set. */
  mark?: string;
}

export const FootnoteRef = Leaf.Type.define<FootnoteParam>("footnoteRef", {
  inline: true,
  group: [Node.Group.Inline],
  shape: {
    structure: (p: FootnoteParam) => {
      const mark = p.mark ?? `[${p.label}]`;
      return Elt.mk("sup", { class: "fnref", "data-label": p.label }, [
        p.href === null ? mark : Elt.mk("a", { href: p.href }, [mark]),
      ]);
    },
  },
  toText: (n: Leaf) => `[${(n.param as FootnoteParam).label}]`,
});

/** A soft line break inside a paragraph: a newline in the markdown, a space on the page. */
export const SoftBreak = Leaf.define("softBreak", {
  inline: true,
  group: [Node.Group.Inline],
  shape: { structure: Elt.mk("span", { class: "softbreak" }, [" "]) },
  toText: () => "\n",
});

/**
 * A node the schema does not model (raw HTML, reference links and definitions): the tree node
 * itself, written back unchanged, and the markdown it reads as, shown as code, never rendered.
 */
export interface RawParam {
  node: unknown;
  text: string;
}

/** Anything inline the schema does not model, as a {@link RawParam}. */
export const RawInline = Leaf.Type.define<RawParam>("rawInline", {
  inline: true,
  group: [Node.Group.Inline],
  shape: { structure: (p: RawParam) => Elt.mk("code", { class: "raw" }, [p.text]) },
  toText: (n: Leaf) => (n.param as RawParam).text,
});

/** The block counterpart of {@link RawInline}: raw HTML blocks, definitions, anything else. */
export const RawBlock = Leaf.Type.define<RawParam>("rawBlock", {
  group: [Node.Group.Content],
  shape: {
    structure: (p: RawParam) => Elt.mk("pre", { class: "raw" }, [Elt.mk("code", [p.text])]),
  },
  toText: (n: Leaf) => (n.param as RawParam).text,
});

/**
 * A block's ID in the stored tree (tempra-dev: decisions/structured-documents). A block split in
 * two keeps it in the first half only; a block whose type changes keeps it.
 */
export const BlockId = Mark.Type.define<string>("blockId", {
  target: [Node.Group.Content, T.ListItem],
  validate: "string",
  keepOnSplit: false,
  keepOnTypeChange: true,
  shape: { attribute: "data-block", value: 0 },
});

/** A heading's anchor, as the server slugs it. Not stored. */
export const HeadingId = Mark.Type.define<string>("headingId", {
  target: T.Heading,
  validate: "string",
  shape: { attribute: "id", value: 0 },
});

/** A table cell's column alignment from the delimiter row (`:--`, `:-:`, `--:`). */
export const CellAlign = Mark.Type.define<"left" | "center" | "right">("cellAlign", {
  target: [T.Cell, T.HeaderCell],
  validate: "string",
  shape: { attribute: "data-align", value: 0 },
});

/** The info string after a fence's language (```` ```sql title=x ````). */
export const CodeMeta = Mark.Type.define<string>("codeMeta", {
  target: T.CodeBlock,
  validate: "string",
  shape: { attribute: "data-meta", value: 0 },
});

/** A loose list or list item (blank lines between items or blocks). */
export const Loose = Mark.define("loose", {
  target: [T.BulletList, T.OrderedList, T.ListItem],
  shape: { attribute: "data-loose", value: "true" },
});

/** A task list item: checked or not (`- [x]`, `- [ ]`). */
export const Task = Mark.Type.define<boolean>("task", {
  target: T.ListItem,
  validate: "boolean",
  shape: { attribute: "data-task", value: (done: boolean) => (done ? "done" : "open") },
});

/** Everything an OKF body may contain. */
export const elements: Schema.Element[] = [
  T.Doc,
  T.Paragraph,
  T.Heading,
  T.Blockquote,
  T.BulletList,
  T.OrderedList,
  T.ListItem,
  T.CodeBlock,
  T.CodeBlockLanguage,
  T.HorizontalRule,
  T.Table,
  T.TableRow,
  T.HeaderCell,
  T.Cell,
  T.LineBreak,
  T.Strong,
  T.Emphasis,
  T.Code,
  T.Strikethrough,
  Link,
  Image,
  FootnoteRef,
  SoftBreak,
  RawInline,
  RawBlock,
  HeadingId,
  BlockId,
  CellAlign,
  CodeMeta,
  Loose,
  Task,
];

export const schema = Schema.define(elements);
