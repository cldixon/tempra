/**
 * A Wordgard document back to markdown: mapped to mdast and written by mdast-util-to-markdown with
 * GFM. Given the {@link Parsed} result the document came from, blocks that did not change are
 * written as their original source, byte for byte, so agents' `edit` anchors and ledger diffs
 * stay intact. DOM-free.
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
  Root,
  RootContent,
  TableCell,
} from "mdast";
import { gfmToMarkdown } from "mdast-util-gfm";
import { toMarkdown } from "mdast-util-to-markdown";
import type { Leaf, Mark, Node, Plot } from "wordgard/doc";
import type { Parsed } from "./parse";
import {
  Blockquote,
  BulletList,
  CellAlign,
  Code,
  CodeBlock,
  CodeBlockLanguage,
  CodeMeta,
  Emphasis,
  type FootnoteParam,
  FootnoteRef,
  Heading,
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
  SoftBreak,
  Strikethrough,
  Strong,
  Table,
  Task,
} from "./schema";

/** The canonical form: ATX headings, `-` bullets, fenced code, `*` emphasis, `---` rules. */
const OPTIONS = {
  extensions: [gfmToMarkdown()],
  bullet: "-",
  emphasis: "*",
  strong: "*",
  fence: "`",
  fences: true,
  rule: "-",
  listItemIndent: "one",
  setext: false,
} as const;

/**
 * Writes a document as markdown. With `from` (what {@link parse} returned for the document's
 * original markdown), unchanged blocks keep their exact source and footnote definitions are
 * written back as they were; without it, everything is written in the canonical form.
 */
export function serialize(doc: Plot.Doc, from?: Parsed): string {
  const blocks = doc.content;
  const footnotes = from?.footnotes ?? [];
  if (!from) return write({ type: "root", children: blocks.map(toBlock) as RootContent[] });

  const src = from.source;
  const orig = from.blocks;
  // A body with no blocks parses to one empty paragraph; untouched, it is what it was.
  if (orig.length === 0 && blocks.length === 1 && blocks[0]?.eq(Paragraph.create([]))) return src;
  // Footnote definitions sit beside the document; a gap that held one is not reused as is.
  const holdsFootnote = (a: number, b: number) => footnotes.some((f) => f.from >= a && f.to <= b);

  let out = "";
  let prev = -1; // index in `orig` of the block just written from source, or -1
  let wroteAny = false;
  blocks.forEach((node, i) => {
    let j = -1;
    if (prev + 1 < orig.length && sameBlock(orig[prev + 1]?.node, node)) j = prev + 1;
    else j = orig.findIndex((o, k) => k > prev && sameBlock(o.node, node));
    const text = j >= 0 ? src.slice(orig[j]?.from, orig[j]?.to) : write(toRoot(node)).trimEnd();
    if (i === 0) {
      out += j === 0 ? src.slice(0, orig[0]?.from) : "";
    } else {
      const a = orig[j - 1];
      const b = orig[j];
      const contiguous = j >= 1 && j === prev + 1 && a && b && !holdsFootnote(a.to, b.from);
      out += contiguous ? src.slice(a.to, b.from) : "\n\n";
    }
    out += text;
    prev = j >= 0 ? j : prev;
    wroteAny = true;
    if (j < 0) prev = Math.max(prev, -1);
  });

  // The tail: as it was when the last block is the original last one, else the footnotes anew.
  const last = orig[orig.length - 1];
  const lastNode = blocks[blocks.length - 1];
  const tailIntact = last && lastNode && sameBlock(last.node, lastNode) && prev === orig.length - 1;
  const before = footnotes.filter((f) => !last || f.to <= last.from);
  if (tailIntact) {
    const inner = before.map((f) => src.slice(f.from, f.to)).join("\n\n");
    return out + (inner ? `\n\n${inner}` : "") + src.slice(last.to);
  }
  if (!wroteAny && orig.length === 0) return src;
  const defs = footnotes.map((f) => src.slice(f.from, f.to));
  const body = out.replace(/\n*$/, "");
  return `${[body, ...defs].filter(Boolean).join("\n\n")}\n`;
}

function sameBlock(a: Node | undefined, b: Node): boolean {
  return a !== undefined && (a === b || a.eq(b));
}

function write(root: Root): string {
  return toMarkdown(root, OPTIONS as never);
}

function toRoot(node: Node): Root {
  return { type: "root", children: [toBlock(node) as RootContent] };
}

/** The mdast for a whole document, with its footnote definitions appended. */
export function toMdast(doc: Plot.Doc, footnotes: readonly FootnoteDefinition[] = []): Root {
  return { type: "root", children: [...(doc.content.map(toBlock) as RootContent[]), ...footnotes] };
}

function isPlot(node: Node): node is Plot {
  return node.isPlot;
}

function toBlock(node: Node): BlockContent | RootContent {
  if (!isPlot(node)) {
    if (node.tag.is(RawBlock)) return { type: "html", value: node.tag.param as string };
    if (node.tag === HorizontalRule || node.tag.type === HorizontalRule.type) {
      return { type: "thematicBreak" };
    }
    throw new Error(`Unexpected block leaf ${node.name}`);
  }
  const tag = node.tag;
  if (tag.type === Paragraph.type) return { type: "paragraph", children: toInline(node.content) };
  if (tag.is(Heading)) {
    return {
      type: "heading",
      depth: tag.param as 1 | 2 | 3 | 4 | 5 | 6,
      children: toInline(node.content),
    };
  }
  if (tag.type === Blockquote.type) {
    return { type: "blockquote", children: node.content.map(toBlock) as BlockContent[] };
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
    return list;
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
    return code;
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
    return table;
  }
  throw new Error(`Unexpected block ${node.name}`);
}

function toListItem(node: Node): MdListItem {
  if (!isPlot(node) || node.tag.type !== ListItem.type) {
    throw new Error(`Unexpected list item ${node.name}`);
  }
  const task = node.tag.mark(Task);
  return {
    type: "listItem",
    spread: Loose.isInSet(node.tag.marks) !== null,
    checked: task === undefined ? null : task,
    children: node.content.map(toBlock) as BlockContent[],
  };
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
  if (tag === SoftBreak || tag.type === SoftBreak.type) return { type: "text", value: "\n" };
  if (tag === LineBreak || tag.type === LineBreak.type) return { type: "break" };
  if (tag.is(Image)) {
    const p = tag.param as ImageParam;
    return { type: "image", url: p.url, alt: p.alt, title: p.title };
  }
  if (tag.is(FootnoteRef)) {
    const p = tag.param as FootnoteParam;
    return { type: "footnoteReference", identifier: p.identifier, label: p.label };
  }
  if (tag.is(RawInline)) return { type: "html", value: tag.param as string };
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

/** Footnote definitions in mdast, for writing a document from scratch with its notes. */
export function footnoteMdast(parsed: Parsed): FootnoteDefinition[] {
  return parsed.footnotes.map((f) => f.mdast);
}
