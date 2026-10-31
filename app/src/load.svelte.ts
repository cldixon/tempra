import { untrack } from "svelte";
import { ApiError, cache, fetchOnce, type Loaded } from "./api";
import { FRESH_MS, share } from "./cache";

/** A page's data as useLoad keeps it: what is shown now, and a way to ask again. */
export interface Load<T> {
  /** What is shown: loading, an error, or the data (narrow on `current.state`). */
  readonly current: Loaded<T>;
  readonly state: Loaded<T>["state"];
  /** The data once ready, else undefined. */
  readonly data: T | undefined;
  readonly error: ApiError | undefined;
  /** Fetches again in place (after an action, or a write on the feed). */
  reload(): void;
}

/** How long an answer stays fresh for a page that mounts (`useLoad`'s last argument). */
export interface Freshness {
  /** In ms; FRESH_MS (a few seconds) unless the data changes seldom. */
  freshFor?: number;
  /**
   * Whether a write on a library's feed makes it stale (the default). False for what a
   * library's writes never change: the person's account, their libraries, a library's members.
   */
  staleOnWrite?: boolean;
}

/**
 * What the frame and many pages share and a library's writes never change (the person, their
 * libraries, a library's members and agents): asked for once a minute at most by parts that
 * mount, and refreshed sooner by their own events (`reloadOn`, an agent the list lacks).
 */
export const WORKSPACE_DATA: Freshness = { freshFor: 60_000, staleOnWrite: false };

/** The keys each `reloadOn` event makes stale, for whatever is not on screen when it fires. */
const staleOn = new Map<string, Set<string>>();

/**
 * Marks `key` stale whenever one of `events` fires, mounted or not: a panel closed when its data
 * changed (the bell's list after an item was opened) asks again when it next opens, however
 * fresh its answer was.
 */
function staleWhen(events: readonly string[], key: string) {
  for (const e of events) {
    let keys = staleOn.get(e);
    if (!keys) {
      const set = new Set<string>();
      keys = set;
      staleOn.set(e, set);
      window.addEventListener(e, () => {
        for (const k of set) cache.stale(k);
      });
    }
    keys.add(key);
  }
}

/**
 * Loads data for a page and reloads it when `key()` changes; `reload` fetches again in place. A
 * page seen before draws at once from what it loaded last time and is checked again in the
 * background, unless that answer is still fresh (asked for within `freshFor`, and after the
 * last write on a feed: a page, its panels and the frame mounting together ask once,
 * TEMPRA-103); the new answer reuses every unchanged part of what is shown (`share`), so what is
 * derived from it and the reader built on it survive. A response that arrives after the page
 * moved on is dropped; `reloadOn` names window events that make it ask again. Call it while a
 * component initialises; the data is kept raw (`$state.raw`), never proxied, so identities hold.
 */
export function useLoad<T>(
  key: () => string,
  load: () => Promise<T>,
  /** Window events that make it load again in place (`INBOX_EVENT`, `LIBRARIES_EVENT`, "focus"). */
  reloadOn: readonly string[] = [],
  { freshFor = FRESH_MS, staleOnWrite = true }: Freshness = {},
): Load<T> {
  const initial = (k: string): Loaded<T> =>
    cache.has(k) ? { state: "ready", data: cache.get(k) as T } : { state: "loading" };
  const first = untrack(key);
  let result = $state.raw<{ key: string; value: Loaded<T> }>({ key: first, value: initial(first) });
  let tick = $state(0);
  // The key as a string: a derived only says it changed when the string does, so the load runs
  // again for a new key, not whenever something the key is made from is redrawn.
  const current_key = $derived(key());
  /**
   * Shows an answer for `k`, reusing every unchanged part of what is shown: compared with what
   * this page shows (or `drawn`, what it drew from the cache), not with the cache (a prefetch
   * may have refreshed the cache without the page).
   */
  const show = (k: string, data: unknown, drawn: unknown) => {
    const r = result;
    const shown = r.key === k && r.value.state === "ready" ? r.value.data : drawn;
    const next = share(shown, data);
    if (r.key === k && next === shown && r.value.state === "ready") return;
    result = { key: k, value: { state: "ready", data: next as T } };
  };
  // A newer answer stored by another part showing this key (its reload, a prefetch): shown here
  // too, so a part that drew a fresh answer without asking is never left behind.
  $effect(() => {
    const k = current_key;
    const drawn = untrack(() => cache.get(k));
    return cache.watch(k, (data) => untrack(() => show(k, data, drawn)));
  });
  $effect(() => {
    const k = current_key;
    const t = tick;
    let live = true;
    if (reloadOn.length > 0) staleWhen(reloadOn, k);
    untrack(() => {
      // What the page drew from the cache before this answer, if anything.
      const drawn = cache.get(k);
      // Asked for a moment ago (a hover, the frame, another part of the page): drawn from the
      // cache, no need to ask again. An explicit reload (an action, the feed) always asks.
      if (t === 0 && cache.fresh(k, freshFor, staleOnWrite)) {
        if (result.key !== k) result = { key: k, value: initial(k) };
        return;
      }
      // An explicit reload always asks afresh.
      const { started, promise } =
        t === 0 ? fetchOnce(k, load) : { started: performance.now(), promise: load() };
      promise.then(
        (data) => {
          // Stored, and so shown by every part watching this key, this one too. When an answer
          // from a later request was stored first, that one is newer: it stays.
          cache.put(k, data, started);
          if (live) show(k, cache.has(k) ? cache.get(k) : data, drawn);
        },
        (e: unknown) => {
          if (!live) return;
          const error = e instanceof ApiError ? e : new ApiError(0, "network", String(e));
          // Offline, or still over the session's limit: what was shown stays. An answer (gone,
          // not allowed) replaces it.
          if ((error.status === 0 || error.status === 429) && cache.has(k)) return;
          cache.drop(k);
          result = { key: k, value: { state: "error", error } };
        },
      );
    });
    return () => {
      live = false;
    };
  });
  if (reloadOn.length > 0) {
    $effect(() => {
      const again = () => tick++;
      for (const e of reloadOn) window.addEventListener(e, again);
      return () => {
        for (const e of reloadOn) window.removeEventListener(e, again);
      };
    });
  }
  const current = $derived(result.key === current_key ? result.value : initial(current_key));
  return {
    get current() {
      return current;
    },
    get state() {
      return current.state;
    },
    get data() {
      return current.state === "ready" ? current.data : undefined;
    },
    get error() {
      return current.state === "error" ? current.error : undefined;
    },
    reload: () => {
      tick++;
    },
  };
}

/**
 * A form's action: `run` calls it, `busy` is set meanwhile, and its error (an API answer, or a
 * check the page made itself) shows as `error` until the next run.
 */
export function useAction() {
  let busy = $state(false);
  let error = $state<string | null>(null);
  return {
    get busy() {
      return busy;
    },
    get error() {
      return error;
    },
    setError(e: string | null) {
      error = e;
    },
    async run(fn: () => Promise<void>) {
      busy = true;
      error = null;
      try {
        await fn();
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      } finally {
        busy = false;
      }
    },
  };
}
