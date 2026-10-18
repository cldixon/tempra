/**
 * Text offsets in the drawn body (tempra-dev: app/reader): DOM points to offsets in the document's
 * text and back, counted by the renderer's rules (Body.tsx). Inside an element marked `data-text`
 * (a textblock, at that offset), a text node counts its characters, an element marked `data-atom`
 * counts one whatever it holds, and one marked `data-skip` counts nothing. These are `docText`'s
 * rules, so a selection maps to the same (block, offset) an anchor stores.
 */

const TEXT = 3;
const ELEMENT = 1;

/** The textblock elements of a body, in document (and so text) order. */
export function textblocks(root: Element): Element[] {
  return Array.from(root.querySelectorAll("[data-text]"));
}

/** A textblock's start offset. */
const startOf = (tb: Element) => Number(tb.getAttribute("data-text"));

/** The text of a textblock as the reader counts it: atoms as one ATOM character, skips left out. */
export function readText(tb: Element, atom = "￼"): string {
  let out = "";
  const visit = (n: Node) => {
    if (n.nodeType === TEXT) out += (n as Text).data;
    if (n.nodeType !== ELEMENT) return;
    const el = n as Element;
    if (el.hasAttribute("data-skip")) return;
    if (el.hasAttribute("data-atom")) {
      out += atom;
      return;
    }
    for (const c of Array.from(el.childNodes)) visit(c);
  };
  for (const c of Array.from(tb.childNodes)) visit(c);
  return out;
}

/** How many characters of `tb` come before a DOM point inside it. */
function charsBefore(tb: Element, container: Node, offset: number, end: boolean): number {
  let count = 0;
  let done = false;
  const visit = (n: Node) => {
    if (done) return;
    if (n.nodeType === TEXT) {
      if (n === container) {
        count += Math.min(offset, (n as Text).data.length);
        done = true;
      } else count += (n as Text).data.length;
      return;
    }
    if (n.nodeType !== ELEMENT) {
      if (n === container) done = true;
      return;
    }
    const el = n as Element;
    const holds = el === container || el.contains(container);
    if (el.hasAttribute("data-skip")) {
      if (holds) done = true;
      return;
    }
    if (el.hasAttribute("data-atom")) {
      if (el === container && offset === 0) done = true;
      else if (holds) {
        // Inside an atom: its edge, before it for a start and after it for an end.
        if (end) count += 1;
        done = true;
      } else count += 1;
      return;
    }
    const kids = el.childNodes;
    for (let i = 0; i < kids.length; i++) {
      if (el === container && i === offset) {
        done = true;
        return;
      }
      visit(kids[i] as Node);
      if (done) return;
    }
    if (el === container) done = true;
  };
  visit(tb);
  return count;
}

/**
 * The text offset of a DOM point in `root`. A point between textblocks snaps to the next one's
 * start (`end` false) or the previous one's end (`end` true); null when there is none that way.
 */
export function offsetAt(root: Element, container: Node, offset: number, end: boolean) {
  if (!root.contains(container)) return null;
  const el = container.nodeType === ELEMENT ? (container as Element) : container.parentElement;
  const tb = el?.closest("[data-text]");
  if (tb && root.contains(tb)) return startOf(tb) + charsBefore(tb, container, offset, end);
  const doc = root.ownerDocument;
  const all = textblocks(root);
  const range = doc.createRange();
  const where = (t: Element) => {
    range.selectNodeContents(t);
    return range.comparePoint(container, offset);
  };
  if (end) {
    for (let i = all.length - 1; i >= 0; i--) {
      const t = all[i] as Element;
      if (where(t) > 0) return startOf(t) + readText(t).length;
    }
    return null;
  }
  for (const t of all) if (where(t) < 0) return startOf(t);
  return null;
}

/** The DOM point at a text offset inside `tb` (`n` characters in). */
function pointIn(tb: Element, n: number): { node: Node; offset: number } {
  let left = n;
  let found: { node: Node; offset: number } | null = null;
  const visit = (node: Node) => {
    if (found) return;
    if (node.nodeType === TEXT) {
      const len = (node as Text).data.length;
      if (left <= len) found = { node, offset: left };
      else left -= len;
      return;
    }
    if (node.nodeType !== ELEMENT) return;
    const el = node as Element;
    if (el.hasAttribute("data-skip")) return;
    if (el.hasAttribute("data-atom")) {
      const parent = el.parentNode as Node;
      const index = Array.prototype.indexOf.call(parent.childNodes, el) as number;
      if (left === 0) found = { node: parent, offset: index };
      else if (left === 1 && !el.nextSibling) found = { node: parent, offset: index + 1 };
      else left -= 1;
      return;
    }
    for (const c of Array.from(el.childNodes)) visit(c);
  };
  for (const c of Array.from(tb.childNodes)) visit(c);
  return found ?? { node: tb, offset: tb.childNodes.length };
}

/** The textblock holding a text offset (at its end counts as inside). */
function blockAt(all: Element[], at: number): Element | null {
  let best: Element | null = null;
  for (const t of all) {
    if (startOf(t) <= at) best = t;
    else break;
  }
  return best && at <= startOf(best) + readText(best).length ? best : null;
}

/** The DOM point at a text offset, or null when it falls between textblocks. */
export function pointAt(root: Element, at: number): { node: Node; offset: number } | null {
  const tb = blockAt(textblocks(root), at);
  return tb ? pointIn(tb, at - startOf(tb)) : null;
}

/** A DOM range over the text from `from` to `to`, or null when either end is not in a block. */
export function rangeOf(root: Element, from: number, to: number): Range | null {
  const all = textblocks(root);
  const a = blockAt(all, from);
  const b = blockAt(all, to);
  if (!a || !b) return null;
  const start = pointIn(a, from - startOf(a));
  const end = pointIn(b, to - startOf(b));
  const range = root.ownerDocument.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range;
}

/** A DOM selection inside `root` as text offsets, or null (collapsed, outside, or empty). */
export function selectionAt(
  root: Element,
  sel: Selection | null,
): { from: number; to: number } | null {
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const r = sel.getRangeAt(0);
  if (!root.contains(r.startContainer) || !root.contains(r.endContainer)) return null;
  // A rich block that draws its own text differently takes no comment.
  const opaque = (n: Node) =>
    (n.nodeType === ELEMENT ? (n as Element) : n.parentElement)?.closest("[data-opaque]");
  if (opaque(r.startContainer) || opaque(r.endContainer)) return null;
  const from = offsetAt(root, r.startContainer, r.startOffset, false);
  const to = offsetAt(root, r.endContainer, r.endOffset, true);
  if (from === null || to === null || to <= from) return null;
  return { from, to };
}

/** The text offset under a viewport point (a click), or null. */
export function offsetAtPoint(root: Element, x: number, y: number): number | null {
  const doc = root.ownerDocument as Document & {
    caretPositionFromPoint?(x: number, y: number): { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?(x: number, y: number): Range | null;
  };
  const pos = doc.caretPositionFromPoint?.(x, y);
  if (pos) return offsetAt(root, pos.offsetNode, pos.offset, false);
  const r = doc.caretRangeFromPoint?.(x, y);
  return r ? offsetAt(root, r.startContainer, r.startOffset, false) : null;
}
