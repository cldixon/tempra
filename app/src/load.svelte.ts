import { untrack } from "svelte";
import { ApiError, cache, fetchOnce, type Loaded } from "./api";
import { share } from "./cache";

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

/**
 * Loads data for a page and reloads it when `key()` changes; `reload` fetches again in place. A
 * page seen before draws at once from what it loaded last time and is checked again in the
 * background (unless a prefetch has just loaded it); the new answer reuses every unchanged part
 * of what is shown (`share`), so what is derived from it and the reader built on it survive. A
 * response that arrives after the page moved on is dropped; `reloadOn` names window events that
 * make it ask again. Call it while a component
 * initialises; the data is kept raw (`$state.raw`), never proxied, so identities hold.
 */
export function useLoad<T>(
  key: () => string,
  load: () => Promise<T>,
  /** Window events that make it load again in place (`INBOX_EVENT`, `LIBRARIES_EVENT`, "focus"). */
  reloadOn: readonly string[] = [],
): Load<T> {
  const initial = (k: string): Loaded<T> =>
    cache.has(k) ? { state: "ready", data: cache.get(k) as T } : { state: "loading" };
  const first = untrack(key);
  let result = $state.raw<{ key: string; value: Loaded<T> }>({ key: first, value: initial(first) });
  let tick = $state(0);
  // The key as a string: a derived only says it changed when the string does, so the load runs
  // again for a new key, not whenever something the key is made from is redrawn.
  const current_key = $derived(key());
  $effect(() => {
    const k = current_key;
    const t = tick;
    let live = true;
    untrack(() => {
      // What the page drew from the cache before this answer, if anything.
      const drawn = cache.get(k);
      // Just prefetched (a hover a moment ago): drawn from the cache, no need to ask again.
      if (t === 0 && cache.takeFresh(k)) {
        if (result.key !== k) result = { key: k, value: initial(k) };
        return;
      }
      // An explicit reload always asks afresh.
      const { started, promise } =
        t === 0 ? fetchOnce(k, load) : { started: performance.now(), promise: load() };
      promise.then(
        (data) => {
          cache.put(k, data, started);
          if (!live) return;
          // Compared with what this page shows, not with the cache (a prefetch may have
          // refreshed the cache without the page).
          const r = result;
          const shown = r.key === k && r.value.state === "ready" ? r.value.data : drawn;
          const next = share(shown, data);
          if (r.key === k && next === shown && r.value.state === "ready") return;
          result = { key: k, value: { state: "ready", data: next as T } };
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
