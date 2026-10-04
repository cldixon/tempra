/**
 * The reader (tempra-dev: app/reader): a Wordgard view of a parsed body, read-only, not editable
 * and not focusable, text selectable. Hovering a footnote reference or a link asks the caller for
 * a tooltip; a word diff can be laid over the text. The only module that touches the DOM.
 */
import type { Leaf, Mark } from "wordgard/doc";
import { Decoration, PointSet, RangeSet, Tooltip, Widget, Wordgard } from "wordgard/editor";
import { GardState } from "wordgard/state";
import type { WordDiff } from "./diff";
import type { Parsed } from "./parse";
import { type FootnoteParam, FootnoteRef, Link, type LinkParam } from "./schema";

/** What the pointer is over, for a tooltip. */
export type Hovered =
  | { kind: "footnote"; footnote: FootnoteParam }
  | { kind: "link"; link: LinkParam };

export interface ReaderOptions {
  parent: HTMLElement;
  parsed: Parsed;
  /** The page's CSP nonce, for the editor's style sheets. */
  nonce?: string;
  /** The tooltip for a footnote reference or link, or null for none. */
  tooltip?(hovered: Hovered): HTMLElement | null | Promise<HTMLElement | null>;
  /** Changes to show over the text. */
  diff?: WordDiff | null;
  /** Hide the first block (a heading that repeats the page's title). Display only. */
  hideFirst?: boolean;
}

export interface Reader {
  /** The editor's outer element. */
  dom: HTMLElement;
  destroy(): void;
}

const removedWidget = Widget.define<string>({
  render: (text) => {
    const del = document.createElement("del");
    del.className = "diff-removed";
    del.textContent = text;
    return del;
  },
});

export function mountReader(opts: ReaderOptions): Reader {
  const config: GardState.Extension[] = [
    Wordgard.editable.of(false),
    GardState.readOnly.of(true),
    Wordgard.contentAttributes.of({ class: "prose", "aria-label": "Concept body" }),
    Wordgard.cspNonce.of(opts.nonce ?? ""),
  ];

  if (opts.tooltip) {
    const ask = opts.tooltip;
    const hover = Tooltip.hover(async (_wg, pos, side) => {
      const hovered = hoveredAt(opts.parsed, pos, side);
      if (!hovered) return null;
      const dom = await ask(hovered.what);
      if (!dom) return null;
      dom.classList.add("tooltip");
      return { pos: hovered.from, end: hovered.to, above: true, create: () => ({ dom }) };
    });
    config.push(hover.extension);
  }

  if (opts.hideFirst) {
    const hidden = PointSet.create<Decoration.Point>((add) => {
      add(0, Decoration.Point.attributes({ hidden: "" }));
    });
    config.push(Decoration.Point.source.of(() => hidden));
  }

  const diff = opts.diff;
  if (diff && (diff.added.length || diff.removed.length)) {
    const added = RangeSet.create<Decoration.Range>((add) => {
      for (const r of diff.added) {
        add(r.from, r.to, Decoration.Range.wrapper("ins", { attributes: { class: "diff-added" } }));
      }
    });
    const removed = PointSet.create<Decoration.Point>((add) => {
      for (const r of [...diff.removed].sort((a, b) => a.pos - b.pos)) {
        add(r.pos, Decoration.Point.widget(removedWidget.of(`${r.text} `), { side: -1 }));
      }
    });
    config.push(
      Decoration.Range.source.of(() => added),
      Decoration.Point.source.of(() => removed),
    );
  }

  const wg = Wordgard.create({ parent: opts.parent, doc: opts.parsed.doc, config });
  // A Wordgard disconnects (listeners, tooltips) when its element leaves the document.
  return { dom: wg.dom, destroy: () => wg.dom.remove() };
}

/** The footnote reference or link at a document position, with the range it covers. */
function hoveredAt(
  parsed: Parsed,
  pos: number,
  side: -1 | 1,
): { what: Hovered; from: number; to: number } | null {
  const doc = parsed.doc;
  const at = doc.resolve(pos);
  const node = side < 0 ? at.nodeBefore : at.nodeAfter;
  if (!node) return null;
  const start = side < 0 ? pos - node.length : pos;
  if (node.isLeaf && node.tag.is(FootnoteRef)) {
    return {
      what: { kind: "footnote", footnote: (node as Leaf<FootnoteParam>).param },
      from: start,
      to: start + 1,
    };
  }
  const link = node.marks.find((m: Mark) => m.name === Link.name);
  if (!link) return null;
  // The whole link: extend over neighbours that carry the same mark.
  const parent = at.parent;
  let from = pos;
  let to = pos;
  let p = parent.start;
  let inLink = false;
  for (const child of parent.node.content) {
    const has = child.marks.some((m) => m.eq(link));
    if (has && !inLink && p <= pos) {
      from = p;
      inLink = true;
    }
    if (!has && inLink) {
      if (p >= pos) break;
      inLink = false;
    }
    p += child.length;
    if (has) to = p;
  }
  return { what: { kind: "link", link: link.value as LinkParam }, from, to };
}
