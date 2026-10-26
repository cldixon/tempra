import { following, type Older, type Page } from "./paging";

/**
 * A list's first page (`first()`, as the page loaded it) and the older pages "Older" loads after
 * it (`load(next)`), as one list: `items`, with `next` while older pages remain. A reloaded first
 * page keeps the older pages (`following`).
 */
export function useOlder<T, C>(
  first: () => Page<T, C> | null,
  id: (t: T) => string,
  load: (before: C) => Promise<Page<T, C>>,
) {
  let older = $state.raw<Older<T, C> | null>(null);
  let paging = $state(false);
  const more = $derived(following(older, first(), id));
  const items = $derived.by(() => {
    const f = first();
    return f ? [...f.items, ...(more?.items ?? [])] : [];
  });
  const next = $derived(more ? more.next : (first()?.next ?? null));
  return {
    get items() {
      return items;
    },
    get next() {
      return next;
    },
    get paging() {
      return paging;
    },
    loadOlder() {
      const after = first();
      const before = next;
      if (after === null || before === null) return;
      const kept = more?.items ?? [];
      paging = true;
      load(before)
        .then((p) => {
          older = { after, items: [...kept, ...p.items], next: p.next };
        })
        .catch(() => {})
        .finally(() => {
          paging = false;
        });
    },
  };
}
