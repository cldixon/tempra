/**
 * A concept body drawn from its stored tree (tempra-dev: app/reader), as React elements: no HTML
 * string is injected and nothing is parsed. Every block carries its ID as `data-block`, every
 * textblock its offset in the document's text as `data-text`, and inline content draws exactly the
 * text `docText` reads: a text node counts its characters, an atom (footnote marker, image, raw
 * markdown, hard break) is one element marked `data-atom` that counts one, and what the diff
 * inserts is marked `data-skip` and counts nothing. dom.ts counts the same way. A paragraph that
 * is one image is a figure (Figure.tsx): the paragraph keeps its `data-text` element holding the
 * image's atom, and its caption is drawn beside it, outside the text, marked `data-skip`.
 */
import { type DocNode, idOf, toMarkdown, type WordDiff } from "@tempra/editor";
import type { PhrasingContent, RootContent, TableCell } from "mdast";
import type { ReactNode } from "react";
import { Caption, FigureImage, InlineImage } from "./Figure";
import { imageSrc, linkInfo, type Prepared } from "./prepare";
import { type BlockProps, CodeBlock, code as codeBlocks, node as nodeBlocks } from "./registry";

/** What draws one body: the prepared tree, the diff over it, whether text offsets are drawn. */
interface Ctx {
  p: Prepared;
  diff: WordDiff | null;
  /** False for content outside the document's text (footnote definitions). */
  offsets: boolean;
  /** For React keys within one textblock. */
  key: number;
}

/** A textblock's text as it is drawn: a cursor through the text, and the diff's pieces there. */
class Run {
  at: number;
  private removed: { pos: number; text: string }[];
  private next = 0;

  constructor(
    private ctx: Ctx,
    from: number,
    private added: { from: number; to: number }[],
    removed: { pos: number; text: string }[],
  ) {
    this.at = from;
    this.removed = removed;
  }

  private del(out: ReactNode[], upTo: number) {
    while (this.next < this.removed.length && (this.removed[this.next]?.pos ?? 0) <= upTo) {
      const r = this.removed[this.next++];
      out.push(
        <del key={this.ctx.key++} className="diff-removed" data-skip="">
          <span className="visually-hidden">removed: </span>
          {`${r?.text} `}
        </del>,
      );
    }
  }

  /** Text, split where the diff's added ranges start and end and where removed words go. */
  text(value: string): ReactNode[] {
    const out: ReactNode[] = [];
    const start = this.at;
    let i = 0;
    while (i < value.length) {
      const pos = start + i;
      this.del(out, pos);
      let end = value.length;
      const nr = this.removed[this.next]?.pos;
      if (nr !== undefined && nr > pos && nr - start < end) end = nr - start;
      const inside = this.added.find((r) => r.from <= pos && pos < r.to);
      if (inside) end = Math.min(end, inside.to - start);
      else {
        const later = this.added.find((r) => r.from > pos);
        if (later) end = Math.min(end, later.from - start);
      }
      const piece = value.slice(i, end);
      out.push(
        inside ? (
          <ins key={this.ctx.key++} className="diff-added">
            {/* Spoken, not counted: outside the text (C-28). */}
            <span className="visually-hidden" data-skip="">
              added:{" "}
            </span>
            {piece}
          </ins>
        ) : (
          piece
        ),
      );
      i = end;
    }
    this.at += value.length;
    return out;
  }

  /** One atom: whatever was removed just before it shows first. */
  atom(out: ReactNode[], el: ReactNode) {
    this.del(out, this.at);
    out.push(el);
    this.at += 1;
  }

  /** The end of the textblock: removed words left over show at its end. */
  end(out: ReactNode[]) {
    this.del(out, this.at);
  }
}

/** A run over the textblock starting at `from`, with the diff's pieces that fall in it. */
function run(ctx: Ctx, n: DocNode): Run {
  const from = ctx.offsets ? (ctx.p.starts.get(n) ?? 0) : 0;
  const tb = ctx.p.text.blocks.find((b) => b.from === from);
  const to = tb?.to ?? from;
  const d = ctx.offsets ? ctx.diff : null;
  return new Run(
    ctx,
    from,
    d ? d.added.filter((r) => r.to > from && r.from < to) : [],
    d ? d.removed.filter((r) => r.pos >= from && r.pos <= to).sort((a, b) => a.pos - b.pos) : [],
  );
}

/** A textblock's offset, as drawn, or nothing outside the document's text. */
const offsetOf = (ctx: Ctx, n: DocNode) => (ctx.offsets ? ctx.p.starts.get(n) : undefined);

/** The markdown a node the reader does not draw reads as, shown as code. */
function rawText(n: DocNode): string {
  return n.type === "html"
    ? n.value
    : toMarkdown({ type: "root", children: [n as RootContent] }).trimEnd();
}

function inline(ctx: Ctx, r: Run, nodes: readonly PhrasingContent[]): ReactNode[] {
  const out: ReactNode[] = [];
  for (const n of nodes) {
    const k = ctx.key++;
    switch (n.type) {
      case "text":
        out.push(...r.text(n.value));
        break;
      case "inlineCode":
        out.push(<code key={k}>{r.text(n.value.replace(/\n/g, " "))}</code>);
        break;
      case "break":
        r.atom(out, <br key={k} data-atom="" />);
        break;
      case "strong":
        out.push(<strong key={k}>{inline(ctx, r, n.children)}</strong>);
        break;
      case "emphasis":
        out.push(<em key={k}>{inline(ctx, r, n.children)}</em>);
        break;
      case "delete":
        out.push(<s key={k}>{inline(ctx, r, n.children)}</s>);
        break;
      case "link": {
        const info = linkInfo(ctx.p.options, n.url);
        const external = info.href !== null && /^(?:https?:)?\/\//i.test(info.href);
        const cls = [info.path !== null ? "internal" : "", info.broken ? "broken" : ""];
        out.push(
          <a
            key={k}
            href={info.href ?? undefined}
            title={n.title ?? undefined}
            rel={external ? "noopener noreferrer" : undefined}
            className={cls.filter(Boolean).join(" ") || undefined}
            data-path={info.path ?? undefined}
          >
            {inline(ctx, r, n.children)}
          </a>,
        );
        break;
      }
      case "image": {
        const figure = ctx.offsets ? ctx.p.figureOf.get(n) : undefined;
        const src = imageSrc(ctx.p.options, n.url);
        r.atom(
          out,
          figure?.kind === "image" ? (
            <FigureImage key={k} figure={figure} />
          ) : src === null ? (
            <span key={k} className="image-dropped" data-atom="">
              {n.alt ?? ""}
            </span>
          ) : (
            <InlineImage key={k} src={src} alt={n.alt ?? ""} title={n.title ?? null} />
          ),
        );
        break;
      }
      case "footnoteReference": {
        const m = ctx.p.markers.get(n) ?? { href: null, mark: `[${n.label ?? n.identifier}]` };
        r.atom(
          out,
          <sup key={k} className="fnref" data-atom="" data-label={n.label ?? n.identifier}>
            {m.href === null ? (
              m.mark
            ) : (
              // Spoken as "footnote 2" (C-28); the atom counts one whatever it says.
              <a href={m.href} aria-label={`footnote ${m.mark}`}>
                {m.mark}
              </a>
            )}
          </sup>,
        );
        break;
      }
      default: {
        const other = n as DocNode;
        if ("children" in other && other.type !== "linkReference") {
          // A wrapper the reader has no element for: its content, as docText reads it.
          out.push(<span key={k}>{inline(ctx, r, other.children as PhrasingContent[])}</span>);
        } else {
          // Raw HTML, reference links and images: their markdown, never rendered.
          r.atom(
            out,
            <code key={k} className="raw" data-atom="">
              {rawText(other)}
            </code>,
          );
        }
      }
    }
  }
  return out;
}

/** A textblock's inline content, with the diff's leftovers at its end. */
function textblock(ctx: Ctx, n: DocNode, nodes: readonly PhrasingContent[]): ReactNode[] {
  const r = run(ctx, n);
  const out = inline(ctx, r, nodes);
  r.end(out);
  return out;
}

function cell(ctx: Ctx, c: TableCell, header: boolean, align: string | null | undefined) {
  const Tag = header ? "th" : "td";
  return (
    <Tag key={ctx.key++} data-text={offsetOf(ctx, c)} data-align={align ?? undefined}>
      {textblock(ctx, c, c.children)}
    </Tag>
  );
}

function block(ctx: Ctx, n: RootContent, hidden = false): ReactNode {
  const id = idOf(n);
  const key = id ?? ctx.key++;
  const custom = nodeBlocks[n.type];
  if (custom) {
    const offset = offsetOf(ctx, n);
    const text =
      "children" in n && offset !== undefined && n.type !== "table"
        ? textblock(ctx, n, n.children as PhrasingContent[])
        : null;
    return <Custom key={key} as={custom} node={n} id={id} offset={offset} text={text} />;
  }
  switch (n.type) {
    case "paragraph": {
      const figure = ctx.offsets ? ctx.p.figureOf.get(n) : undefined;
      if (figure) {
        return (
          <figure key={key} className="figure" data-block={id}>
            <p data-text={offsetOf(ctx, n)}>{textblock(ctx, n, n.children)}</p>
            <Caption figure={figure} />
          </figure>
        );
      }
      return (
        <p key={key} data-block={id} data-text={offsetOf(ctx, n)}>
          {textblock(ctx, n, n.children)}
        </p>
      );
    }
    case "heading": {
      const H = `h${n.depth}` as "h1";
      return (
        <H
          key={key}
          id={ctx.p.anchors.get(n)}
          data-block={id}
          data-text={offsetOf(ctx, n)}
          hidden={hidden || undefined}
        >
          {textblock(ctx, n, n.children)}
        </H>
      );
    }
    case "blockquote":
      return (
        <blockquote key={key} data-block={id}>
          {blocks(ctx, n.children)}
        </blockquote>
      );
    case "list": {
      const tasks = n.children.some((i) => typeof i.checked === "boolean");
      const cls = [n.spread ? "loose" : "", tasks ? "tasks" : ""].filter(Boolean).join(" ");
      const items = n.children.map((item) => (
        <li
          key={idOf(item) ?? ctx.key++}
          data-block={idOf(item)}
          className={typeof item.checked === "boolean" ? "task" : undefined}
        >
          {typeof item.checked === "boolean" && (
            <input type="checkbox" checked={item.checked} disabled aria-label="Done" readOnly />
          )}
          {blocks(ctx, item.children)}
        </li>
      ));
      return n.ordered ? (
        <ol
          key={key}
          data-block={id}
          start={n.start != null && n.start !== 1 ? n.start : undefined}
          className={cls || undefined}
        >
          {items}
        </ol>
      ) : (
        <ul key={key} data-block={id} className={cls || undefined}>
          {items}
        </ul>
      );
    }
    case "code": {
      const r = run(ctx, n);
      const text = r.text(n.value);
      const out: ReactNode[] = [...text];
      r.end(out);
      const Component = (n.lang && codeBlocks[n.lang.toLowerCase()]) || CodeBlock;
      return (
        <Custom
          key={key}
          as={Component}
          node={n}
          id={id}
          offset={offsetOf(ctx, n)}
          text={out}
          figure={ctx.offsets ? ctx.p.figureOf.get(n) : undefined}
        />
      );
    }
    case "thematicBreak":
      return <hr key={key} data-block={id} />;
    case "table": {
      const [head, ...body] = n.children;
      return (
        <div key={key} className="table" data-block={id}>
          <table>
            {head && (
              <thead>
                <tr>{head.children.map((c, i) => cell(ctx, c, true, n.align?.[i]))}</tr>
              </thead>
            )}
            {body.length > 0 && (
              <tbody>
                {body.map((row) => (
                  <tr key={ctx.key++}>
                    {row.children.map((c, i) => cell(ctx, c, false, n.align?.[i]))}
                  </tr>
                ))}
              </tbody>
            )}
          </table>
        </div>
      );
    }
    case "footnoteDefinition":
      // Shown beside the body (Contents & sources, the marker's card), not in it.
      return null;
    default:
      if ("children" in n) {
        return (
          <div key={key} data-block={id}>
            {blocks(ctx, n.children as RootContent[])}
          </div>
        );
      }
      // Raw HTML blocks and definitions: their markdown, as code, never rendered.
      return (
        <pre key={key} className="raw" data-block={id}>
          <code>{rawText(n)}</code>
        </pre>
      );
  }
}

/** A registry component, called as a component so it may use hooks. */
function Custom<N>(props: BlockProps<N> & { as: (p: BlockProps<N>) => ReactNode }) {
  const { as: C, ...rest } = props;
  return <C {...rest} />;
}

function blocks(ctx: Ctx, nodes: readonly RootContent[], hideFirst = false): ReactNode[] {
  return nodes.map((n, i) => block(ctx, n, hideFirst && i === 0));
}

/**
 * The body's blocks. `hideFirst` keeps a leading heading that repeats the title in the DOM, hidden,
 * so offsets stay where the text has them.
 */
export function Body(props: { prepared: Prepared; diff: WordDiff | null; hideFirst: boolean }) {
  const ctx: Ctx = { p: props.prepared, diff: props.diff, offsets: true, key: 0 };
  return <>{blocks(ctx, props.prepared.tree.children, props.hideFirst)}</>;
}

/** Content beside the body (a footnote definition), drawn the same way, outside the text. */
export function Note(props: { prepared: Prepared; nodes: readonly RootContent[] }) {
  const ctx: Ctx = { p: props.prepared, diff: null, offsets: false, key: 0 };
  return <>{blocks(ctx, props.nodes)}</>;
}
