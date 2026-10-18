/**
 * A concept body in the reader (tempra-dev: app/reader): the stored tree drawn as React elements
 * (reader/Body.tsx), with the overlays a person reads with. Comment quotes are drawn with the CSS
 * Custom Highlight API, so drawing or clearing one never touches the body; hovering or focusing a
 * footnote marker or a link shows a card; selecting text shows a small toolbar (Comment). The two
 * popovers live in the top layer; the app sets only their coordinates, the look is the design
 * package's.
 */
import type { WordDiff } from "@tempra/editor";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Body } from "./reader/Body";
import { offsetAtPoint, pointAt, rangeOf, selectionAt } from "./reader/dom";
import type { Prepared } from "./reader/prepare";

/** A highlighted range of the text (text offsets), e.g. a comment's quote. */
export interface Highlight {
  id: string;
  from: number;
  to: number;
  active?: boolean;
  /** A comment being written on this range (not yet posted). */
  draft?: boolean;
}

/** What the pointer or focus is on, for a card. */
export type Hovered =
  | { kind: "footnote"; label: string }
  | { kind: "link"; href: string | null; path: string | null; broken: boolean };

/** The names the stylesheet draws (`::highlight(…)`): open threads, the one in focus, the draft. */
const NAMES = {
  open: "tempra-comment",
  active: "tempra-comment-active",
  draft: "tempra-comment-draft",
} as const;

type Registry = { set(name: string, h: unknown): void; delete(name: string): void };
type HighlightCtor = new (...ranges: Range[]) => unknown;

/** The page's highlight registry, where the browser has one. */
function registry(): { highlights: Registry; Highlight: HighlightCtor } | null {
  const g = globalThis as { CSS?: { highlights?: Registry }; Highlight?: HighlightCtor };
  return g.CSS?.highlights && g.Highlight
    ? { highlights: g.CSS.highlights, Highlight: g.Highlight }
    : null;
}

/** The concept reader's text, for scrolling to a quote from outside it (the Comments panel). */
function conceptRoot(): Element | null {
  return document.querySelector(".doc .body > .prose");
}

/** Scrolls the reader to a text offset (smoothly, unless motion is reduced). */
export function revealOffset(at: number) {
  const root = conceptRoot();
  const point = root && pointAt(root, at);
  if (!point) return;
  const el = point.node.nodeType === 1 ? (point.node as Element) : point.node.parentElement;
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  el?.scrollIntoView({ block: "center", behavior: still ? "auto" : "smooth" });
}

/**
 * A popover in the top layer, placed above `rect` (below it when there is no room), kept inside
 * the viewport. Only its coordinates are set here, as custom properties the stylesheet reads.
 */
function Floating(props: {
  rect: DOMRect;
  className: string;
  children: ReactNode;
  onPointerEnter?(): void;
  onPointerLeave?(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { rect } = props;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof el.showPopover === "function" && !el.matches(":popover-open")) el.showPopover();
    const gap = 8;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const x = Math.max(gap, Math.min(rect.left + rect.width / 2 - w / 2, innerWidth - w - gap));
    const above = rect.top - h - gap;
    const y = above >= gap ? above : rect.bottom + gap;
    el.style.setProperty("--float-x", `${Math.round(x)}px`);
    el.style.setProperty("--float-y", `${Math.round(y)}px`);
  });
  return (
    <div
      ref={ref}
      popover="manual"
      className={`floating ${props.className}`}
      onPointerEnter={props.onPointerEnter}
      onPointerLeave={props.onPointerLeave}
    >
      {props.children}
    </div>
  );
}

/** What a footnote marker or link element is, for its card. */
function hoveredOf(el: Element): Hovered | null {
  if (el.matches("sup.fnref"))
    return { kind: "footnote", label: el.getAttribute("data-label") ?? "" };
  if (el.matches("a")) {
    return {
      kind: "link",
      href: el.getAttribute("href"),
      path: el.getAttribute("data-path"),
      broken: el.classList.contains("broken"),
    };
  }
  return null;
}

/** The part of an element (a link may wrap lines) nearest a pointer, else its first line. */
function rectNear(el: Element, x?: number, y?: number): DOMRect {
  const rects = Array.from(el.getClientRects());
  if (x !== undefined && y !== undefined) {
    const hit = rects.find((r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom);
    if (hit) return hit;
  }
  return rects[0] ?? el.getBoundingClientRect();
}

export function Reader(props: {
  prepared: Prepared;
  diff: WordDiff | null;
  hideFirst: boolean;
  /** The card for a footnote marker or link, or null for none. */
  hover?(h: Hovered): ReactNode | Promise<ReactNode> | null;
  /** Ranges to highlight (comment quotes); changing them does not redraw the body. */
  highlights?: readonly Highlight[];
  /** A highlight was clicked (its id), or the body outside one (null). */
  onMark?(id: string | null): void;
  /** Offers Comment on selected text (text offsets). */
  onComment?(range: { from: number; to: number }): void;
}) {
  const { prepared, diff, hideFirst, highlights, onComment } = props;
  const root = useRef<HTMLDivElement>(null);
  // The body draws again only when what it shows changes, never for a card or a highlight.
  const body = useMemo(
    () => <Body prepared={prepared} diff={diff} hideFirst={hideFirst} />,
    [prepared, diff, hideFirst],
  );

  // Comment highlights: ranges over the drawn text, redrawn whenever the text or the marks change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `body` changes when the drawn text does.
  useEffect(() => {
    const reg = registry();
    const el = root.current;
    if (!reg || !el || highlights === undefined) return;
    const sets = { open: [] as Range[], active: [] as Range[], draft: [] as Range[] };
    for (const h of highlights) {
      const range = rangeOf(el, h.from, h.to);
      if (!range) continue;
      sets[h.draft ? "draft" : h.active ? "active" : "open"].push(range);
    }
    for (const k of Object.keys(NAMES) as (keyof typeof NAMES)[]) {
      reg.highlights.set(NAMES[k], new reg.Highlight(...sets[k]));
    }
    return () => {
      for (const name of Object.values(NAMES)) reg.highlights.delete(name);
    };
  }, [highlights, body]);

  // Cards over footnote markers and links.
  const hover = useRef(props.hover);
  hover.current = props.hover;
  const [card, setCard] = useState<{ el: Element; rect: DOMRect; content: ReactNode } | null>(null);
  const pending = useRef<Element | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hide = useCallback((delay: number) => {
    clearTimeout(timer.current);
    pending.current = null;
    timer.current = setTimeout(() => setCard(null), delay);
  }, []);
  const show = useCallback((el: Element, delay: number, x?: number, y?: number) => {
    clearTimeout(timer.current);
    if (pending.current === el) return;
    pending.current = el;
    timer.current = setTimeout(async () => {
      const what = hoveredOf(el);
      const content = what && hover.current ? await hover.current(what) : null;
      if (pending.current !== el) return;
      setCard(content ? { el, rect: rectNear(el, x, y), content } : null);
    }, delay);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  const targetOf = (t: EventTarget | null) => {
    // A marker's own link is the marker: its card is the source, not the link.
    const el = t instanceof Element ? (t.closest("sup.fnref") ?? t.closest("a")) : null;
    return el && root.current?.contains(el) ? el : null;
  };

  // The selection toolbar: shown once the selection settles, gone as soon as it does.
  const [tools, setTools] = useState<{ range: { from: number; to: number }; rect: DOMRect } | null>(
    null,
  );
  useEffect(() => {
    if (!onComment) return;
    let wait: ReturnType<typeof setTimeout> | undefined;
    const follow = () => {
      clearTimeout(wait);
      wait = setTimeout(() => {
        const el = root.current;
        const sel = document.getSelection();
        const at = el ? selectionAt(el, sel) : null;
        if (!at || !sel || !prepared.text.text.slice(at.from, at.to).trim()) {
          setTools(null);
          return;
        }
        setTools({ range: at, rect: sel.getRangeAt(0).getBoundingClientRect() });
      }, 120);
    };
    document.addEventListener("selectionchange", follow);
    return () => {
      clearTimeout(wait);
      document.removeEventListener("selectionchange", follow);
    };
  }, [onComment, prepared]);
  // Scrolling: the card follows its marker or link, the toolbar its text.
  useEffect(() => {
    const scrolled = () => {
      setCard((c) => c && { ...c, rect: rectNear(c.el) });
      setTools((t) => {
        const sel = document.getSelection();
        return t && sel && sel.rangeCount > 0
          ? { ...t, rect: sel.getRangeAt(0).getBoundingClientRect() }
          : t;
      });
    };
    document.addEventListener("scroll", scrolled, { capture: true, passive: true });
    return () => document.removeEventListener("scroll", scrolled, { capture: true });
  }, []);

  const onMark = props.onMark;
  const click = (e: React.MouseEvent) => {
    // A click that ends a selection is not a click on a highlight.
    if (!onMark || !root.current || !(document.getSelection()?.isCollapsed ?? true)) return;
    const at = offsetAtPoint(root.current, e.clientX, e.clientY);
    const hit =
      at === null
        ? undefined
        : (highlights ?? [])
            .filter((h) => !h.draft && h.from <= at && at <= h.to)
            .sort((a, b) => a.to - a.from - (b.to - b.from))[0];
    onMark(hit?.id ?? null);
  };

  return (
    <div className="body">
      {/* biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: a click on a highlighted quote opens its thread, which the Comments panel also lists. */}
      <div
        ref={root}
        className="prose"
        onClick={click}
        onPointerOver={(e) => {
          const el = targetOf(e.target);
          if (el) show(el, 250, e.clientX, e.clientY);
        }}
        onPointerOut={(e) => {
          const el = targetOf(e.target);
          if (el && !(e.relatedTarget instanceof Node && el.contains(e.relatedTarget))) hide(200);
        }}
        onFocus={(e) => {
          const el = targetOf(e.target);
          if (el) show(el, 0);
        }}
        onBlur={() => hide(0)}
      >
        {body}
      </div>
      {card && (
        <Floating
          rect={card.rect}
          className="tooltip"
          onPointerEnter={() => clearTimeout(timer.current)}
          onPointerLeave={() => hide(200)}
        >
          {card.content}
        </Floating>
      )}
      {tools && onComment && (
        <Floating rect={tools.rect} className="selection-tools">
          <div role="toolbar" aria-label="Selection">
            <button
              type="button"
              // Pressing the button must not take the selection away first.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                const range = tools.range;
                setTools(null);
                onComment(range);
                // The draft highlight takes over from the browser's selection.
                document.getSelection()?.removeAllRanges();
              }}
            >
              Comment
            </button>
          </div>
        </Floating>
      )}
    </div>
  );
}
