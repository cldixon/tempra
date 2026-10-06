/**
 * The stored tree ({@link Doc}) to a Wordgard document and back (tempra-dev: app/markdown-bridge).
 * Block IDs ride along as a mark; footnote definitions are kept beside the document; anything the
 * schema does not model is a raw node that carries its tree node, so it comes back unchanged.
 * DOM-free.
 */
import type {
  BlockContent,
  FootnoteDefinition,
  List,
  Code as MdCode,
  ListItem as MdListItem,
  Table as MdTable,
  TableRow as MdTableRow,
  PhrasingContent,
  RootContent,
  TableCell,
} from "mdast";
import { Leaf, Mark, type Node, type Plot } from "wordgard/doc";
import { headingText, type LinkTarget, linkTarget, slugger } from "./links";
import {
  BlockId,
  Blockquote,
  BulletList,
  Cell,
  CellAlign,
  Code,
  CodeBlock,
  CodeBlockLanguage,
  CodeMeta,
  Emphasis,
  type FootnoteParam,
  FootnoteRef,
  HeaderCell,
  Heading,
  HeadingId,
  HorizontalRule,
  Image,
  type ImageParam,
  LineBreak,
  Link,
  type LinkParam,
  ListItem,
  Loose,
  OrderedList,
  Paragraph,
  RawBlock,
  RawInline,
  type RawParam,
  SoftBreak,
  Strikethrough,
  Strong,
  schema,
  Table,
  TableRow,
  Task,
} from "./schema";
import { type DocText, docText } from "./text";
import { type Doc, type DocNode, idOf, toMarkdown, walk } from "./tree";

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

/** A footnote definition, kept beside the document: its label and content. */
export interface Footnote {
  label: string;
  identifier: string;
  /** The definition's content as a document of its own, for showing it beside the body. */
  doc: Plot.Doc;
  node: FootnoteDefinition;
}

/** A body ready for the reader. */
export interface Parsed {
  doc: Plot.Doc;
  /** The stored tree it was built from. */
  tree: Doc;
  footnotes: Footnote[];
  /** The document's text, for comment anchors. */
  text: DocText;
  /** The document position where each of `text.blocks` starts. */
  starts: number[];
  /** The headings, in order, with their anchors and document positions. */
  headings: { depth: number; text: string; id: string; pos: number }[];
}

/** Builds the reader's document for a stored body. */
export function fromTree(tree: Doc, opts: ParseOptions = {}): Parsed {
  const defined = new Set<string>();
  walk(tree, (n) => {
    if (n.type === "footnoteDefinition") defined.add(n.label ?? n.identifier);
    return undefined;
  });
  const b = new Builder(opts, defined);
  const footnotes: Footnote[] = [];
  const children: Node[] = [];
  let pos = 0;
  for (const child of tree.children) {
    if (child.type === "footnoteDefinition") {
      const sub = new Builder(opts, defined);
      const content = sub.blocks(child.children, 0);
      footnotes.push({
        label: child.label ?? child.identifier,
        identifier: child.identifier,
        doc: schema.doc(content.length ? content : [Paragraph.create([])]),
        node: child,
      });
      continue;
    }
    const node = b.block(child, pos);
    children.push(node);
    pos += node.length;
  }
  return {
    // A document has at least one block: an empty body is one empty paragraph.
    doc: schema.doc(children.length ? children : [Paragraph.create([])]),
    tree,
    footnotes,
    text: docText(tree),
    starts: b.starts,
    headings: b.headings,
  };
}

/** The marks a block's tag carries for its ID (none for a block without one). */
function idMarks(n: DocNode, marks: Mark.Set = Mark.none): Mark.Set {
  const id = idOf(n);
  return id === undefined ? marks : BlockId.of(id).addToSet(marks);
}

class Builder {
  /** Where the content of each textblock starts, in the order of {@link docText}. */
  starts: number[] = [];
  headings: Parsed["headings"] = [];
  private anchor = slugger();

  constructor(
    private opts: ParseOptions,
    private defined: Set<string>,
  ) {}

  /** Block nodes starting at document position `pos`. */
  blocks(nodes: readonly RootContent[], pos: number): Node[] {
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
        this.starts.push(inner);
        return Paragraph.withMarks(idMarks(n)).create(this.inline(n.children));
      case "heading": {
        this.starts.push(inner);
        const text = headingText(n.children);
        const id = this.anchor(text);
        this.headings.push({ depth: n.depth, text, id, pos });
        const marks = idMarks(n, HeadingId.of(id).addToSet(Mark.none));
        return Heading.of(n.depth).withMarks(marks).create(this.inline(n.children));
      }
      case "blockquote":
        return Blockquote.withMarks(idMarks(n)).create(
          this.nonEmpty(this.blocks(n.children, inner)),
        );
      case "list": {
        let marks = idMarks(n);
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
        this.starts.push(inner);
        let marks = idMarks(n);
        if (n.lang) marks = CodeBlockLanguage.of(n.lang).addToSet(marks);
        if (n.meta) marks = CodeMeta.of(n.meta).addToSet(marks);
        const content: Node[] = [];
        n.value.split("\n").forEach((line, i) => {
          if (i > 0) content.push(LineBreak);
          if (line) content.push(Leaf.text(line));
        });
        return CodeBlock.withMarks(marks).create(content);
      }
      case "thematicBreak":
        return HorizontalRule.withMarks(idMarks(n));
      case "table": {
        const rows: Node[] = [];
        let p = inner;
        n.children.forEach((row, r) => {
          const cells: Node[] = [];
          let cp = p + 1;
          row.children.forEach((cell: TableCell, c) => {
            this.starts.push(cp + 1);
            const align = n.align?.[c];
            const tag = (r === 0 ? HeaderCell : Cell).withMarks(
              align ? CellAlign.of(align).addToSet(Mark.none) : Mark.none,
            );
            const node = tag.create(this.inline(cell.children));
            cells.push(node);
            cp += node.length;
          });
          const rowNode = TableRow.create(cells);
          rows.push(rowNode);
          p += rowNode.length;
        });
        return Table.withMarks(idMarks(n)).create(rows);
      }
      default:
        // Raw HTML blocks, definitions, and anything else: kept as the node itself.
        return RawBlock.of(raw(n), idMarks(n));
    }
  }

  private listItem(item: MdListItem, pos: number): Node {
    let marks = idMarks(item);
    if (item.spread) marks = Loose.addToSet(marks);
    if (typeof item.checked === "boolean") marks = Task.of(item.checked).addToSet(marks);
    return ListItem.withMarks(marks).create(this.nonEmpty(this.blocks(item.children, pos + 1)));
  }

  private nonEmpty(nodes: Node[]): Node[] {
    return nodes.length ? nodes : [Paragraph.create([])];
  }

  /** Inline content. Its text, atoms one character each, is what {@link docText} reads. */
  inline(nodes: readonly PhrasingContent[]): Node[] {
    const out: Node[] = [];
    const text = (value: string, marks: Mark.Set) => {
      value.split("\n").forEach((line, i) => {
        if (i > 0) out.push(SoftBreak.withMarks(marks));
        if (line) out.push(Leaf.text(line, marks));
      });
    };
    const walkInline = (n: PhrasingContent, marks: Mark.Set) => {
      switch (n.type) {
        case "text":
          return text(n.value, marks);
        case "inlineCode": {
          const value = n.value.replace(/\n/g, " ");
          if (value) out.push(Leaf.text(value, Code.addToSet(marks)));
          return;
        }
        case "strong":
          for (const c of n.children) walkInline(c, Strong.addToSet(marks));
          return;
        case "emphasis":
          for (const c of n.children) walkInline(c, Emphasis.addToSet(marks));
          return;
        case "delete":
          for (const c of n.children) walkInline(c, Strikethrough.addToSet(marks));
          return;
        case "link": {
          const mark = Link.of(linkParam(this.opts, n.url, n.title ?? null));
          for (const c of n.children) walkInline(c, mark.addToSet(marks));
          return;
        }
        case "image": {
          const target = linkTarget(this.opts.path ?? "", n.url);
          const src = this.opts.href
            ? this.opts.href(target, n.url, "image")
            : target && target.kind !== "internal"
              ? target.href
              : null;
          out.push(Image.of({ url: n.url, alt: n.alt ?? "", title: n.title ?? null, src }, marks));
          return;
        }
        case "footnoteReference": {
          const label = n.label ?? n.identifier;
          const defined = this.defined.has(label);
          const href = this.opts.footnote
            ? this.opts.footnote(label, defined)
            : defined
              ? `#fn-${label}`
              : null;
          out.push(FootnoteRef.of({ label, identifier: n.identifier, href }, marks));
          return;
        }
        case "break":
          out.push(LineBreak.withMarks(marks));
          return;
        default:
          // Raw HTML, reference links and images, anything else: kept as the node itself.
          out.push(RawInline.of(raw(n), marks));
      }
    };
    for (const n of nodes) walkInline(n, Mark.none);
    return out;
  }
}

/** A node the schema does not model, with the markdown it reads as. */
function raw(node: DocNode): RawParam {
  const text =
    node.type === "html"
      ? node.value
      : toMarkdown({ type: "root", children: [node as RootContent] }).trimEnd();
  return { node, text };
}

/**
 * A link's parameters as the reader draws it (an editor making a link uses this too). `href` is
 * null for a target a browser must not follow.
 */
export function linkParam(opts: ParseOptions, url: string, title: string | null = null) {
  const target = linkTarget(opts.path ?? "", url);
  const path = target?.kind === "internal" ? target.path : null;
  const broken =
    target?.kind === "internal" && opts.exists ? !opts.exists(target.path, target.dir) : false;
  const href = opts.href
    ? opts.href(target, url, "link")
    : target && target.kind !== "internal"
      ? target.href
      : null;
  return { url, title, href, path, broken };
}

/** The text offset of a document position, by {@link Parsed.starts}; -1 outside every textblock. */
export function textOffset(parsed: Parsed, pos: number): number {
  for (let i = parsed.starts.length - 1; i >= 0; i--) {
    const start = parsed.starts[i] as number;
    const tb = parsed.text.blocks[i];
    if (tb && pos >= start) return pos - start <= tb.to - tb.from ? tb.from + (pos - start) : -1;
  }
  return -1;
}

/** The document position of a text offset; -1 when it falls between textblocks. */
export function documentPos(parsed: Parsed, offset: number): number {
  const i = parsed.text.blocks.findIndex((b) => offset >= b.from && offset <= b.to);
  const tb = parsed.text.blocks[i];
  const start = parsed.starts[i];
  return tb && start !== undefined ? start + (offset - tb.from) : -1;
}

// ---------------------------------------------------------------- back to the tree

/** The tree of a Wordgard document, with its footnote definitions appended as they were. */
export function toTree(doc: Plot.Doc, footnotes: readonly Footnote[] = []): Doc {
  const children = doc.content.map(toBlock) as RootContent[];
  // An empty body is one empty paragraph in Wordgard and nothing in the tree.
  const body = children.filter((c) => !(c.type === "paragraph" && c.children.length === 0));
  return { type: "root", children: [...body, ...footnotes.map((f) => f.node)] };
}

function isPlot(node: Node): node is Plot {
  return node.isPlot;
}

/** The node's block ID as a tree field, if it has one. */
function withId<T extends object>(node: Node, out: T): T {
  const id = node.tag.mark(BlockId);
  return id === undefined ? out : { ...out, id };
}

function toBlock(node: Node): BlockContent | RootContent {
  if (!isPlot(node)) {
    if (node.tag.is(RawBlock)) return (node.tag.param as RawParam).node as RootContent;
    if (node.tag.type === HorizontalRule.type) return withId(node, { type: "thematicBreak" });
    throw new Error(`Unexpected block leaf ${node.name}`);
  }
  const tag = node.tag;
  if (tag.type === Paragraph.type) {
    return withId(node, { type: "paragraph", children: toInline(node.content) });
  }
  if (tag.is(Heading)) {
    return withId(node, {
      type: "heading",
      depth: tag.param as 1 | 2 | 3 | 4 | 5 | 6,
      children: toInline(node.content),
    });
  }
  if (tag.type === Blockquote.type) {
    return withId(node, {
      type: "blockquote",
      children: node.content.map(toBlock) as BlockContent[],
    });
  }
  if (tag.type === BulletList.type || tag.is(OrderedList)) {
    const ordered = tag.is(OrderedList);
    const list: List = {
      type: "list",
      ordered,
      start: ordered ? (tag.param as number) : null,
      spread: Loose.isInSet(tag.marks) !== null,
      children: node.content.map(toListItem),
    };
    return withId(node, list);
  }
  if (tag.type === CodeBlock.type) {
    const code: MdCode = {
      type: "code",
      lang: tag.mark(CodeBlockLanguage) ?? null,
      meta: tag.mark(CodeMeta) ?? null,
      value: node.content
        .map((c) => (c.isText ? (c as Leaf<string>).param : c.tag === LineBreak ? "\n" : ""))
        .join(""),
    };
    return withId(node, code);
  }
  if (tag.type === Table.type) {
    const rows = node.content.filter(isPlot);
    const first = rows[0]?.content.filter(isPlot) ?? [];
    const table: MdTable = {
      type: "table",
      align: first.map((cell) => cell.tag.mark(CellAlign) ?? null),
      children: rows.map(
        (row): MdTableRow => ({
          type: "tableRow",
          children: row.content
            .filter(isPlot)
            .map((cell): TableCell => ({ type: "tableCell", children: toInline(cell.content) })),
        }),
      ),
    };
    return withId(node, table);
  }
  throw new Error(`Unexpected block ${node.name}`);
}

function toListItem(node: Node): MdListItem {
  if (!isPlot(node) || node.tag.type !== ListItem.type) {
    throw new Error(`Unexpected list item ${node.name}`);
  }
  const task = node.tag.mark(Task);
  return withId(node, {
    type: "listItem",
    spread: Loose.isInSet(node.tag.marks) !== null,
    checked: task === undefined ? null : task,
    children: node.content.map(toBlock) as BlockContent[],
  });
}

/**
 * Marks that wrap phrasing content, by type name. When several open on the same node and run
 * equally far, the earlier one here goes outside: `**[x](y)**` is how agents bold a link, and
 * `***x***` reads back as emphasis around strong whichever way it was meant.
 */
const WRAPPERS = [Emphasis.type.name, Strong.type.name, Strikethrough.type.name, Link.name];

type Wrapper = Extract<PhrasingContent, { children: PhrasingContent[] }>;

function wrapperFor(mark: Mark): Wrapper {
  if (mark.name === Link.name) {
    const p = mark.value as LinkParam;
    return { type: "link", url: p.url, title: p.title, children: [] };
  }
  if (mark.name === Strong.type.name) return { type: "strong", children: [] };
  if (mark.name === Emphasis.type.name) return { type: "emphasis", children: [] };
  return { type: "delete", children: [] };
}

function wrappingMarks(marks: Mark.Set): Mark[] {
  return marks.filter((m) => WRAPPERS.includes(m.name));
}

/**
 * Inline nodes to phrasing content. Marks become nested wrappers; a wrapper already open stays
 * open while the following content keeps its mark, so `*a **b***` comes back as it was written.
 */
function toInline(nodes: readonly Node[]): PhrasingContent[] {
  const root: { children: PhrasingContent[] } = { children: [] };
  const stack: { mark: Mark; node: Wrapper }[] = [];
  const top = () => stack[stack.length - 1]?.node ?? root;
  const markIn = (m: Mark, set: Mark[]) => set.some((x) => x.eq(m));

  /** How many nodes from `i` on carry `mark`. */
  const run = (mark: Mark, i: number) => {
    let n = 0;
    while (i + n < nodes.length && nodes[i + n]?.marks.some((m) => m.eq(mark))) n++;
    return n;
  };

  nodes.forEach((node, i) => {
    const wanted = wrappingMarks(node.marks);
    // Close down to the deepest wrapper whose mark this node no longer has.
    const keep = stack.findIndex((s) => !markIn(s.mark, wanted));
    if (keep !== -1) stack.length = keep;
    // Marks opening here: the one that runs furthest goes outside.
    const order = (m: Mark) => WRAPPERS.indexOf(m.name);
    for (const m of wanted
      .filter((m) => !stack.some((s) => s.mark.eq(m)))
      .sort((a, b) => run(b, i) - run(a, i) || order(a) - order(b))) {
      const wrapper = wrapperFor(m);
      top().children.push(wrapper);
      stack.push({ mark: m, node: wrapper });
    }
    const leaf = phrasing(node);
    if (leaf) top().children.push(leaf);
  });
  return mergeText(root.children);
}

function phrasing(node: Node): PhrasingContent | null {
  if (node.isText) {
    const value = (node as Leaf<string>).param;
    return node.marks.some((m) => m.name === Code.type.name)
      ? { type: "inlineCode", value }
      : { type: "text", value };
  }
  const tag = node.tag;
  if (tag.type === SoftBreak.type) return { type: "text", value: "\n" };
  if (tag.type === LineBreak.type) return { type: "break" };
  if (tag.is(Image)) {
    const p = tag.param as ImageParam;
    return { type: "image", url: p.url, alt: p.alt, title: p.title };
  }
  if (tag.is(FootnoteRef)) {
    const p = tag.param as FootnoteParam;
    return { type: "footnoteReference", identifier: p.identifier, label: p.label };
  }
  if (tag.is(RawInline)) return (tag.param as RawParam).node as PhrasingContent;
  return null;
}

/** Adjacent text nodes (split around soft breaks) back into one, as the parser makes them. */
function mergeText(nodes: PhrasingContent[]): PhrasingContent[] {
  const out: PhrasingContent[] = [];
  for (const n of nodes) {
    if ("children" in n) n.children = mergeText(n.children as PhrasingContent[]) as never;
    const prev = out[out.length - 1];
    if (n.type === "text" && prev?.type === "text") prev.value += n.value;
    else out.push(n);
  }
  return out;
}
