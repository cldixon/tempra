/**
 * The reader's pure parts (Reader.svelte; tempra-dev: app/reader): comment highlights, what a card
 * is over, and scrolling to a quote from outside the reader (the Comments panel).
 */
import { pointAt } from "./dom";

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
export const HIGHLIGHTS = {
  open: "tempra-comment",
  active: "tempra-comment-active",
  draft: "tempra-comment-draft",
} as const;

type Registry = { set(name: string, h: unknown): void; delete(name: string): void };
type HighlightCtor = new (...ranges: Range[]) => unknown;

/** The page's highlight registry, where the browser has one. */
export function highlightRegistry(): { highlights: Registry; Highlight: HighlightCtor } | null {
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

/** What a footnote marker or link element is, for its card. */
export function hoveredOf(el: Element): Hovered | null {
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
export function rectNear(el: Element, x?: number, y?: number): DOMRect {
  const rects = Array.from(el.getClientRects());
  if (x !== undefined && y !== undefined) {
    const hit = rects.find((r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom);
    if (hit) return hit;
  }
  return rects[0] ?? el.getBoundingClientRect();
}
