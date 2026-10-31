import { cache, fetchOnce } from "./api";
import { type PageLoad, pageLoad } from "./prefetch";
import { match, pageKey } from "./router";

/**
 * Keeping the page on screen while the next one loads (TEMPRA-194; tempra-dev: app/workspace).
 * Most moves within a library take 100 to 300 ms, and drawing the next page's loading state at
 * once flashes an empty page before the content. So the page on screen stays (with its scroll)
 * until the next page's data is in the cache, or HOLD_MS have passed, whichever is first; past
 * that, the next page draws its loading state as before. The address and the tree's current row
 * follow the click at once (location.svelte.ts keeps both URLs).
 */
export const HOLD_MS = 300;

/**
 * What the next page waits for before it replaces the page on screen, or null to replace it at
 * once: only a move to another page of the same library, to a page that registered its load
 * (prefetch.ts), and only while that load is not in the cache (a page seen before draws from the
 * cache at once and is checked again in the background, as always).
 */
export function holdFor(shown: URL, next: URL): PageLoad | null {
  const from = match(shown);
  const to = match(next);
  if (!from || !to || !("owner" in from) || !("owner" in to)) return null;
  if (from.owner !== to.owner || from.slug !== to.slug) return null;
  if (pageKey(shown, from) === pageKey(next, to)) return null;
  const load = pageLoad(to);
  if (!load || cache.has(load.key)) return null;
  return load;
}

/**
 * Starts the next page's load, shared with the page once it mounts (`fetchOnce`) and kept as a
 * fresh answer, so the page draws from it without asking again. `ready` settles when the load does
 * (either way); `settled` says whether it has.
 */
export function startLoad(l: PageLoad): { ready: Promise<void>; settled: () => boolean } {
  const { started, promise } = fetchOnce(l.key, l.load);
  let done = false;
  const ready = promise.then(
    (data) => {
      cache.put(l.key, data, started);
      done = true;
    },
    () => {
      done = true;
    },
  );
  return { ready, settled: () => done };
}

/** Resolves when `p` settles or after `ms`, whichever comes first. */
export function within(p: Promise<void>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    p.then(() => {
      clearTimeout(t);
      resolve();
    });
  });
}
