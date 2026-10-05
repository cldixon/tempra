/**
 * Markdown to a Wordgard document: parsed with mdast-util-from-markdown and GFM (tables,
 * strikethrough, task lists, autolinks, footnotes), as the server parses bodies, then mapped node
 * by node onto the schema. DOM-free.
 */
import type {
  BlockContent,
  DefinitionContent,
  FootnoteDefinition,
  ListItem as MdListItem,
  Nodes,
  PhrasingContent,
  Root,
  RootContent,
  TableCell,
} from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { Leaf, Mark, type Node, type Plot } from "wordgard/doc";
import { type LinkTarget, linkTarget, slugger } from "./links";
import {
  Blockquote,
  BulletList,
  Cell,
  CellAlign,
  Code,
  CodeBlock,
  CodeBlockLanguage,
  CodeMeta,
  Emphasis,
  FootnoteRef,
  HeaderCell,
  Heading,
  HeadingId,
  HorizontalRule,
  Image,
  LineBreak,
  Link,
  ListItem,
  Loose,
  OrderedList,
  Paragraph,
  RawBlock,
  RawInline,
  SoftBreak,
  Strikethrough,
  Strong,
  schema,
  Table,
  TableRow,
  Task,
} from "./schema";

/** How the reader points links, images and footnote references. All optional. */
export interface ParseOptions {
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
   * Where a footnote reference points; `defined` says whether the body has a `[^label]: …`
   * definition. Defaults to `#fn-<label>` for defined ones.
   */
  footnote?(label: string, defined: boolean): string | null;
}

/** A top-level block of the document and the source range it was parsed from. */
export interface SourceBlock {
  node: Node;
  from: number;
  to: number;
}

/** A footnote definition, kept beside the document: its label, source and content. */
export interface Footnote {
  label: string;
  identifier: string;
  from: number;
  to: number;
  /** The definition's content as a document of its own, for showing it beside the body. */
  doc: Plot.Doc;
  mdast: FootnoteDefinition;
}

/** A run of document text and the markdown it came from. */
export interface TextSegment {
  /** Document positions. */
  pos: number;
  end: number;
  /** Markdown offsets. */
  from: number;
  to: number;
}

export interface Parsed {
  doc: Plot.Doc;
  /** The markdown parsed, for byte-stable serialization. */
  source: string;
  blocks: SourceBlock[];
  footnotes: Footnote[];
  segments: TextSegment[];
  /** The headings, in order, with their anchors and document positions. */
  headings: { depth: number; text: string; id: string; pos: number }[];
}

export function parseMdast(markdown: string): Root {
  return fromMarkdown(markdown, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
}

const offsets = (n: Nodes) => ({
  from: n.position?.start.offset ?? 0,
  to: n.position?.end.offset ?? 0,
});

/** Parses a concept body (markdown without frontmatter) into a document. */
export function parse(markdown: string, opts: ParseOptions = {}): Parsed {
  const tree = parseMdast(markdown);
  const defined = new Set<string>();
  const collect = (n: Nodes) => {
    if (n.type === "footnoteDefinition") defined.add(n.label ?? n.identifier);
    if ("children" in n) for (const c of n.children) collect(c);
  };
  collect(tree);

  const b = new Builder(markdown, opts, defined);
  const blocks: SourceBlock[] = [];
  const footnotes: Footnote[] = [];
  const children: Node[] = [];
  let pos = 0;
  for (const child of tree.children) {
    if (child.type === "footnoteDefinition") {
      const sub = new Builder(markdown, opts, defined);
      const content = sub.blocks(child.children, 0);
      footnotes.push({
        label: child.label ?? child.identifier,
        identifier: child.identifier,
        ...offsets(child),
        doc: schema.doc(content.length ? content : [Paragraph.create([])]),
        mdast: child,
      });
      continue;
    }
    const node = b.block(child, pos);
    children.push(node);
    blocks.push({ node, ...offsets(child) });
    pos += node.length;
  }
  return {
    // A document has at least one block: an empty body is one empty paragraph.
    doc: schema.doc(children.length ? children : [Paragraph.create([])]),
    source: markdown,
    blocks,
    footnotes,
    segments: b.segments,
    headings: b.headings,
  };
}

class Builder {
  segments: TextSegment[] = [];
  headings: Parsed["headings"] = [];
  private anchor = slugger();

  constructor(
    private src: string,
    private opts: ParseOptions,
    private defined: Set<string>,
  ) {}

  /** Block nodes starting at document position `pos`. */
  blocks(nodes: readonly (RootContent | BlockContent | DefinitionContent)[], pos: number): Node[] {
    const out: Node[] = [];
    for (const n of nodes) {
      if (n.type === "footnoteDefinition") continue;
      const node = this.block(n, pos);
      out.push(node);
      pos += node.length;
    }
    return out;
  }

  /** One block at `pos`; a plot's content starts at `pos + 1`. */
  block(n: RootContent, pos: number): Node {
    const inner = pos + 1;
    switch (n.type) {
      case "paragraph":
        return Paragraph.create(this.inline(n.children, inner));
      case "heading": {
        const content = this.inline(n.children, inner);
        const text = headingText(n.children);
        const id = this.anchor(text);
        this.headings.push({ depth: n.depth, text, id, pos });
        return Heading.of(n.depth).withMarks(HeadingId.of(id).addToSet(Mark.none)).create(content);
      }
      case "blockquote":
        return Blockquote.create(this.nonEmpty(this.blocks(n.children, inner)));
      case "list": {
        let marks = Mark.none;
        if (n.spread) marks = Loose.addToSet(marks);
        const tag = n.ordered ? OrderedList.of(n.start ?? 1) : BulletList;
        const items: Node[] = [];
        let p = inner;
        for (const item of n.children) {
          const node = this.listItem(item, p);
          items.push(node);
          p += node.length;
        }
        return tag.withMarks(marks).create(items);
      }
      case "code": {
        let marks = Mark.none;
        if (n.lang) marks = CodeBlockLanguage.of(n.lang).addToSet(marks);
        if (n.meta) marks = CodeMeta.of(n.meta).addToSet(marks);
        const content: Node[] = [];
        const { from, to } = offsets(n);
        // Each line found in the source on its own: code in a list item is indented.
        let offset = this.src.indexOf("\n", from) + 1;
        let p = inner;
        n.value.split("\n").forEach((line, i) => {
          if (i > 0) {
            content.push(LineBreak);
            p += 1;
          }
          if (line) {
            const at = this.src.indexOf(line, offset);
            if (offset > 0 && at !== -1 && at + line.length <= to) {
              this.segments.push({ pos: p, end: p + line.length, from: at, to: at + line.length });
              offset = at + line.length;
            }
            content.push(Leaf.text(line));
            p += line.length;
          }
        });
        return CodeBlock.withMarks(marks).create(content);
      }
      case "thematicBreak":
        return HorizontalRule;
      case "table": {
        const rows: Node[] = [];
        let p = inner;
        n.children.forEach((row, r) => {
          const cells: Node[] = [];
          let cp = p + 1;
          row.children.forEach((cell: TableCell, c) => {
            const align = n.align?.[c];
            const tag = (r === 0 ? HeaderCell : Cell).withMarks(
              align ? CellAlign.of(align).addToSet(Mark.none) : Mark.none,
            );
            const node = tag.create(this.inline(cell.children, cp + 1));
            cells.push(node);
            cp += node.length;
          });
          const rowNode = TableRow.create(cells);
          rows.push(rowNode);
          p += rowNode.length;
        });
        return Table.create(rows);
      }
      default:
        // Raw HTML blocks, definitions, and anything else: kept as source.
        return RawBlock.of(this.source(n));
    }
  }

  private listItem(item: MdListItem, pos: number): Node {
    let marks = Mark.none;
    if (item.spread) marks = Loose.addToSet(marks);
    if (typeof item.checked === "boolean") marks = Task.of(item.checked).addToSet(marks);
    return ListItem.withMarks(marks).create(this.nonEmpty(this.blocks(item.children, pos + 1)));
  }

  private nonEmpty(nodes: Node[]): Node[] {
    return nodes.length ? nodes : [Paragraph.create([])];
  }

  private source(n: Nodes): string {
    const { from, to } = offsets(n);
    return this.src.slice(from, to);
  }

  /** Inline content starting at document position `pos`. */
  inline(nodes: readonly PhrasingContent[], pos: number): Node[] {
    const out: Node[] = [];
    let p = pos;
    const push = (node: Node) => {
      out.push(node);
      p += node.length;
    };
    const text = (value: string, marks: Mark.Set, from: number, to: number) => {
      const lines = value.split("\n");
      // Offsets line up only when the source is the value itself (no escapes or entities).
      const exact = to - from === value.length && this.src.slice(from, to) === value;
      let offset = from;
      lines.forEach((line, i) => {
        if (i > 0) {
          push(SoftBreak.withMarks(marks));
          offset += 1;
        }
        if (line) {
          this.segments.push({
            pos: p,
            end: p + line.length,
            from: exact ? offset : from,
            to: exact ? offset + line.length : to,
          });
          push(Leaf.text(line, marks));
          offset += line.length;
        }
      });
    };
    const walk = (n: PhrasingContent, marks: Mark.Set) => {
      const { from, to } = offsets(n);
      switch (n.type) {
        case "text":
          return text(n.value, marks, from, to);
        case "inlineCode": {
          const value = n.value.replace(/\n/g, " ");
          const tick = this.src.indexOf(value, from);
          const at = tick >= from && tick + value.length <= to ? tick : from;
          if (value) {
            this.segments.push({ pos: p, end: p + value.length, from: at, to: at + value.length });
            push(Leaf.text(value, Code.addToSet(marks)));
          }
          return;
        }
        case "strong":
          for (const c of n.children) walk(c, Strong.addToSet(marks));
          return;
        case "emphasis":
          for (const c of n.children) walk(c, Emphasis.addToSet(marks));
          return;
        case "delete":
          for (const c of n.children) walk(c, Strikethrough.addToSet(marks));
          return;
        case "link": {
          const mark = Link.of(this.link(n.url, n.title ?? null, "link"));
          for (const c of n.children) walk(c, mark.addToSet(marks));
          return;
        }
        case "image": {
          const target = this.target(n.url);
          const src = this.href(target, n.url, "image");
          return push(
            Image.of({ url: n.url, alt: n.alt ?? "", title: n.title ?? null, src }, marks),
          );
        }
        case "footnoteReference": {
          const label = n.label ?? n.identifier;
          const defined = this.defined.has(label);
          const href = this.opts.footnote
            ? this.opts.footnote(label, defined)
            : defined
              ? `#fn-${label}`
              : null;
          return push(FootnoteRef.of({ label, identifier: n.identifier, href }, marks));
        }
        case "break":
          return push(LineBreak.withMarks(marks));
        default:
          // Raw HTML, reference links and images, anything else: kept as source.
          return push(RawInline.of(this.source(n), marks));
      }
    };
    for (const n of nodes) walk(n, Mark.none);
    return out;
  }

  private target(url: string): LinkTarget | null {
    return linkTarget(this.opts.path ?? "", url);
  }

  private href(target: LinkTarget | null, raw: string, kind: "link" | "image"): string | null {
    if (this.opts.href) return this.opts.href(target, raw, kind);
    return target && target.kind !== "internal" ? target.href : null;
  }

  private link(url: string, title: string | null, kind: "link") {
    const target = this.target(url);
    const path = target?.kind === "internal" ? target.path : null;
    const broken =
      target?.kind === "internal" && this.opts.exists
        ? !this.opts.exists(target.path, target.dir)
        : false;
    return { url, title, href: this.href(target, url, kind), path, broken };
  }
}

/** A heading's text as the server anchors it: text and code, footnote references as `[x]`. */
function headingText(nodes: readonly PhrasingContent[]): string {
  return nodes
    .map((n): string => {
      if (n.type === "text" || n.type === "inlineCode") return n.value;
      if (n.type === "footnoteReference") return `[${n.label ?? n.identifier}]`;
      if (n.type === "image") return n.alt ?? "";
      if ("children" in n) return headingText(n.children as PhrasingContent[]);
      return "";
    })
    .join("");
}
