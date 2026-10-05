/**
 * The reader (tempra-dev: app/reader): a Wordgard view of a parsed body, read-only, not editable
 * and not focusable, text selectable. Hovering a footnote reference or a link asks the caller for
 * a tooltip; a word diff can be laid over the text. The only module that touches the DOM.
 */
import type { Leaf, Mark } from "wordgard/doc";
import { Decoration, PointSet, RangeSet, Tooltip, Widget, Wordgard } from "wordgard/editor";
import { GardState, Transaction } from "wordgard/state";
import type { WordDiff } from "./diff";
import { type Editing, type EditOptions, editing } from "./edit";
import type { Parsed } from "./parse";
import { serialize } from "./serialize";

export type { EditOptions } from "./edit";

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
  /** A highlighted range was clicked (comment threads, by id), or the text outside one (null). */
  onMark?(id: string | null): void;
  /**
   * Offers Comment on selected text: a small toolbar beside the selection, drawn by the reader.
   * Called with the selection (document positions) when it is pressed.
   */
  onComment?(range: { from: number; to: number }): void;
}

/** A highlighted range of the document, e.g. a comment's quote. */
export interface Highlight {
  id: string;
  /** Document positions. */
  from: number;
  to: number;
  active?: boolean;
  /** A comment being written on this range (not yet posted). */
  draft?: boolean;
}

export interface Reader {
  /** The editor's outer element. */
  dom: HTMLElement;
  /** Replaces the highlighted ranges, without redrawing the rest. */
  highlight(marks: readonly Highlight[]): void;
  /** The text selected in the reader, as document positions, or null. */
  selection(): { from: number; to: number } | null;
  /**
   * Turns editing on (menu bar, key bindings, history; the same instance, no remount) or off.
   * Turning it off keeps the text as it is; `reset` puts the loaded version back.
   */
  setEditable(on: boolean, opts?: EditOptions): void;
  /** Whether the body differs from the version the reader was built from. */
  dirty(): boolean;
  /** The body as markdown: unchanged blocks byte for byte as loaded (see serialize). */
  markdown(): string;
  /** Puts the loaded version back, dropping every edit. */
  reset(): void;
  destroy(): void;
}

/** What differs between reading and editing: the editing extensions, or none. */
const mode = GardState.Compartment.define();

const setHighlights = Transaction.Effect.define<RangeSet<Decoration.Range>>();

type Range = { from: number; to: number };
const setTools = Transaction.Effect.define<Range | null>();

/**
 * The selection toolbar: shown beside selected text, hidden when the selection goes. Built by
 * `selectionTools`, which knows what its buttons do.
 */
function selectionTools(onComment: (range: Range) => void) {
  return GardState.Field.define<Range | null>({
    create: () => null,
    update: (value, tr) => {
      for (const e of tr.effects) if (e.is(setTools)) value = e.value;
      return value;
    },
    provide: (field) =>
      Tooltip.show.from(field, (range) =>
        range
          ? {
              pos: range.from,
              end: range.to,
              above: true,
              create: (wg) => {
                const dom = document.createElement("div");
                dom.className = "selection-tools";
                dom.setAttribute("role", "toolbar");
                dom.setAttribute("aria-label", "Selection");
                const comment = document.createElement("button");
                comment.type = "button";
                comment.textContent = "Comment";
                // Pressing the button must not take the selection away first.
                comment.addEventListener("mousedown", (e) => e.preventDefault());
                comment.addEventListener("click", () => {
                  wg.dispatch({ effects: setTools.of(null) });
                  onComment(range);
                  // The draft highlight takes over from the browser's selection.
                  document.getSelection()?.removeAllRanges();
                });
                dom.append(comment);
                return { dom };
              },
            }
          : null,
      ),
  });
}

/** The highlighted ranges, replaced as a whole by a setHighlights effect. */
const highlights = GardState.Field.define<RangeSet<Decoration.Range>>({
  create: () => RangeSet.empty,
  update: (value, tr) => {
    // Highlights follow the text while it is edited.
    if (tr.docChanged) value = value.map(tr.changes);
    for (const e of tr.effects) if (e.is(setHighlights)) value = e.value;
    return value;
  },
  provide: (field) => Decoration.Range.source.from(field, (set) => () => set),
});

function highlightSet(marks: readonly Highlight[], size: number): RangeSet<Decoration.Range> {
  const sorted = marks
    .map((m) => ({ ...m, from: Math.max(0, m.from), to: Math.min(size, m.to) }))
    .filter((m) => m.to > m.from)
    .sort((a, b) => a.from - b.from || a.to - b.to);
  return RangeSet.create<Decoration.Range>((add) => {
    for (const m of sorted) {
      add(
        m.from,
        m.to,
        Decoration.Range.wrapper("mark", {
          attributes: m.draft
            ? { class: "comment-draft" }
            : { class: m.active ? "comment-mark active" : "comment-mark", "data-thread": m.id },
        }),
      );
    }
  });
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
  const reading: GardState.Extension[] = [Wordgard.editable.of(false), GardState.readOnly.of(true)];
  const config: GardState.Extension[] = [
    highlights,
    mode.of(reading),
    Wordgard.contentAttributes.of({ class: "prose", "aria-label": "Concept body" }),
    Wordgard.cspNonce.of(opts.nonce ?? ""),
  ];

  const tools = opts.onComment ? selectionTools(opts.onComment) : null;
  if (tools) config.push(tools);

  if (opts.tooltip) {
    const ask = opts.tooltip;
    const hover = Tooltip.hover(async (wg, pos, side) => {
      // The document on screen, which differs from the loaded one while a person edits.
      const hovered = hoveredAt(wg.state.doc, pos, side);
      if (!hovered) return null;
      const dom = await ask(hovered.what);
      if (!dom) return null;
      dom.classList.add("tooltip");
      return { pos: hovered.from, end: hovered.to, above: true, create: () => ({ dom }) };
    });
    config.push(hover.extension);
  }

  if (opts.hideFirst) {
    // Reading only: an editor shows the heading it may change.
    const hidden = PointSet.create<Decoration.Point>((add) => {
      add(0, Decoration.Point.attributes({ hidden: "" }));
    });
    reading.push(Decoration.Point.source.of(() => hidden));
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
  const onMark = opts.onMark;
  const click = (e: MouseEvent) => {
    // A click that ends a selection is not a click on the highlight.
    if (!(document.getSelection()?.isCollapsed ?? true)) return;
    const mark = (e.target as Element | null)?.closest?.("mark.comment-mark");
    onMark?.(mark?.getAttribute("data-thread") ?? null);
  };
  wg.dom.addEventListener("click", click);
  const selection = (): Range | null => {
    const sel = document.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    if (!wg.dom.contains(range.startContainer) || !wg.dom.contains(range.endContainer)) {
      return null;
    }
    try {
      const a = wg.posAtDOM(range.startContainer, range.startOffset);
      const b = wg.posAtDOM(range.endContainer, range.endOffset);
      return a === b ? null : { from: Math.min(a, b), to: Math.max(a, b) };
    } catch {
      return null;
    }
  };
  let editingNow = false;
  // The toolbar follows the selection: shown once it settles, gone as soon as it does.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const follow = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!wg.dom.isConnected) return;
      // While editing, the selection is for editing; the toolbar is for reading.
      const now = editingNow ? null : selection();
      const shown = tools ? wg.state.field(tools, false) : null;
      if (now?.from === shown?.from && now?.to === shown?.to) return;
      wg.dispatch({ effects: setTools.of(now) });
    }, 120);
  };
  if (tools) document.addEventListener("selectionchange", follow);
  let session: Editing | null = null;
  return {
    dom: wg.dom,
    highlight: (marks) =>
      wg.dispatch({ effects: setHighlights.of(highlightSet(marks, wg.state.doc.length)) }),
    selection,
    setEditable: (on, editOpts) => {
      editingNow = on;
      session?.close();
      session = on ? editing(editOpts ?? {}) : null;
      wg.dispatch({
        effects: [mode.reconfigure(session ? session.extensions : reading), setTools.of(null)],
      });
      // No focus here: the person clicks where they mean to type (focusing would put the caret
      // at the start of the body, and on a fresh view could land after their click).
    },
    dirty: () => !wg.state.doc.eq(opts.parsed.doc),
    markdown: () => serialize(wg.state.doc, opts.parsed),
    reset: () => {
      const doc = wg.state.doc;
      wg.dispatch({ changes: { from: 0, to: doc.length, insert: opts.parsed.doc.slice(0) } });
    },
    // A Wordgard disconnects (listeners, tooltips) when its element leaves the document.
    destroy: () => {
      session?.close();
      clearTimeout(timer);
      document.removeEventListener("selectionchange", follow);
      wg.dom.removeEventListener("click", click);
      wg.dom.remove();
    },
  };
}

/** The footnote reference or link at a document position, with the range it covers. */
function hoveredAt(
  doc: Parsed["doc"],
  pos: number,
  side: -1 | 1,
): { what: Hovered; from: number; to: number } | null {
  if (pos < 0 || pos > doc.length) return null;
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
