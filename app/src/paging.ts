/*
 * "Older": a list's first page and the older pages paged back to (Activity, the Inbox). The first
 * page reloads in place (a write on the feed, an item done); the older pages are kept across it.
 */

/** A page as the API answers it: its items, newest first, and where the next (older) page starts. */
export interface Page<T, C> {
  items: T[];
  next: C | null;
}

/** The older pages loaded after `after`, the first page they follow. */
export interface Older<T, C> {
  after: Page<T, C>;
  items: T[];
  next: C | null;
}

/**
 * The older pages carried over to a reloaded first page. What it pushed off its end (k new items
 * at the top push k off) stays listed, so nothing falls between it and the older pages; what it
 * no longer holds above its last item (an item done) goes. With nothing in common (more new
 * items than a page) the list starts again from the top.
 */
export function following<T, C>(
  older: Older<T, C> | null,
  first: Page<T, C> | null,
  id: (t: T) => string,
): Older<T, C> | null {
  if (older === null || first === null || older.after === first) return older;
  const shown = [...older.after.items, ...older.items];
  const now = new Set(first.items.map(id));
  let deepest = -1;
  shown.forEach((t, i) => {
    if (now.has(id(t))) deepest = i;
  });
  if (deepest === -1) return null;
  return {
    after: first,
    items: shown.slice(deepest + 1).filter((t) => !now.has(id(t))),
    next: older.next,
  };
}
