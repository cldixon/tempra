import { takeBoot } from "./boot";
import { PageCache } from "./cache";
import { touched } from "./wake";

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
 * Until when the server asked the app to hold back (ms since the epoch): a 429's `Retry-After`,
 * the browser session's per-minute limit (TEMPRA-80). Every call waits it out; prefetches skip.
 */
let holdUntil = 0;

/** Whether the app is holding back after a 429. */
export const holding = () => Date.now() < holdUntil;

/** Reads tried again after a 429 before the error reaches the page. */
const RETRIES_429 = 2;

/**
 * A JSON call to the REST API as the signed-in person (the session cookie). A lapsed session
 * goes back through sign-in to the same page. Over the session's limit, a read waits as long as
 * the server says and tries again, quietly; a write reports it.
 */
export async function api<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const read = (init.method ?? "GET") === "GET";
  // A call to a library wakes its object, so a wake is not needed for a while (TEMPRA-195); a
  // booted answer too: the shell's own call to it has just been made.
  touched(url);
  // The first page's answers came with the shell (TEMPRA-175): the first call to each is free.
  const booted = read ? takeBoot(url) : null;
  if (booted) return booted.data as T;
  let res: Response;
  for (let attempt = 0; ; attempt++) {
    const wait = holdUntil - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    res = await fetch(url, { ...init, headers, credentials: "same-origin" });
    if (res.status !== 429) break;
    const after = Number(res.headers.get("Retry-After"));
    holdUntil = Math.max(holdUntil, Date.now() + (after > 0 ? Math.min(after, 120) : 10) * 1000);
    if (!read || attempt >= RETRIES_429) break;
  }
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

/** A JSON write to the API (POST unless said otherwise), with its body as JSON. */
export const post = <T = unknown>(url: string, body?: unknown, method = "POST") =>
  api<T>(url, { method, body: body === undefined ? undefined : JSON.stringify(body) });

/** The value of a form field, trimmed. */
export const field = (form: HTMLFormElement, name: string) =>
  String(new FormData(form).get(name) ?? "").trim();

export type Loaded<T> =
  | { state: "loading" }
  | { state: "error"; error: ApiError }
  | { state: "ready"; data: T };

/** What each page loaded last (useLoad, load.svelte.ts), so a page seen before draws at once. */
export const cache = new PageCache();
/** Loads under way, so a prefetch and the page that follows share one request. */
const inflight = new Map<string, { started: number; promise: Promise<unknown> }>();

export function fetchOnce<T>(
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
  if (cache.fresh(key) || inflight.has(key) || holding()) return;
  const { started, promise } = fetchOnce(key, load);
  promise.then(
    (data) => cache.put(key, data, started, true),
    () => {},
  );
}
