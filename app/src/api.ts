import { useCallback, useEffect, useState } from "react";
import { PageCache, share } from "./cache";

/** An error answer from the API: `{ error, code }` with its HTTP status. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * A JSON call to the REST API as the signed-in person (the session cookie). A lapsed session
 * goes back through sign-in to the same page.
 */
export async function api<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(url, { ...init, headers, credentials: "same-origin" });
  if (res.status === 401) {
    location.assign(`/sign-in?next=${encodeURIComponent(location.pathname + location.search)}`);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
    throw new ApiError(res.status, body?.code ?? "error", body?.error ?? res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/**
 * A form's action: `run` calls it, `busy` is set meanwhile, and its error (an API answer, or a
 * check the page made itself) shows as `error` until the next run.
 */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, run, setError };
}

/** The value of a form field, trimmed. */
export const field = (form: HTMLFormElement, name: string) =>
  String(new FormData(form).get(name) ?? "").trim();

export type Loaded<T> =
  | { state: "loading" }
  | { state: "error"; error: ApiError }
  | { state: "ready"; data: T };

const cache = new PageCache();
/** Loads under way, so a prefetch and the page that follows share one request. */
const inflight = new Map<string, { started: number; promise: Promise<unknown> }>();

function fetchOnce<T>(
  key: string,
  load: () => Promise<T>,
): { started: number; promise: Promise<T> } {
  let f = inflight.get(key) as { started: number; promise: Promise<T> } | undefined;
  if (!f) {
    const started = performance.now();
    const promise = load().finally(() => inflight.delete(key));
    f = { started, promise };
    inflight.set(key, f as { started: number; promise: Promise<unknown> });
  }
  return f;
}

/**
 * Loads a page's data ahead of a likely visit (a link hovered or selected), so the page draws
 * from the cache when it opens. Does nothing when a fresh prefetch is here or one is on its way.
 */
export function prefetch<T>(key: string, load: () => Promise<T>) {
  if (cache.fresh(key) || inflight.has(key)) return;
  const { started, promise } = fetchOnce(key, load);
  promise.then(
    (data) => cache.put(key, data, started, true),
    () => {},
  );
}

/**
 * Loads data for a page and reloads it when `key` changes; `reload` fetches again in place. A
 * page seen before draws at once from what it loaded last time and is checked again in the
 * background (unless a prefetch has just loaded it); the new answer reuses every unchanged part
 * of what is shown, so the page's memos and the reader built on them survive. A response that
 * arrives after the page moved on is dropped.
 */
export function useLoad<T>(key: string, load: () => Promise<T>): Loaded<T> & { reload(): void } {
  const initial = (k: string): Loaded<T> =>
    cache.has(k) ? { state: "ready", data: cache.get(k) as T } : { state: "loading" };
  const [result, setResult] = useState<{ key: string; value: Loaded<T> }>(() => ({
    key,
    value: initial(key),
  }));
  const [tick, setTick] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` names everything `load` reads.
  useEffect(() => {
    let live = true;
    // What the page drew from the cache before this answer, if anything.
    const drawn = cache.get(key);
    // Just prefetched (a hover a moment ago): drawn from the cache, no need to ask again.
    if (tick === 0 && cache.takeFresh(key)) return;
    // An explicit reload (after an action, or a write on the feed) always asks afresh.
    const { started, promise } =
      tick === 0 ? fetchOnce(key, load) : { started: performance.now(), promise: load() };
    promise.then(
      (data) => {
        cache.put(key, data, started);
        if (!live) return;
        // Compared with what this page shows, not with the cache (a prefetch may have
        // refreshed the cache without the page).
        setResult((r) => {
          const shown = r.key === key && r.value.state === "ready" ? r.value.data : drawn;
          const next = share(shown, data);
          if (r.key === key && next === shown) return r;
          return { key, value: { state: "ready", data: next as T } };
        });
      },
      (e: unknown) => {
        if (!live) return;
        const error = e instanceof ApiError ? e : new ApiError(0, "network", String(e));
        // Offline: what was shown stays. An answer (gone, not allowed) replaces it.
        if (error.status === 0 && cache.has(key)) return;
        cache.drop(key);
        setResult({ key, value: { state: "error", error } });
      },
    );
    return () => {
      live = false;
    };
  }, [key, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const value: Loaded<T> = result.key === key ? result.value : initial(key);
  return { ...value, reload };
}
