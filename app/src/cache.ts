/**
 * What each page loaded last (see useLoad in load.svelte.ts), so a page seen before draws at
 * once. Kept apart from the runes so its rules can be tested: newer answers win, and an answer
 * that is still fresh spares a page that mounts from asking again (TEMPRA-103).
 */
interface Entry {
  data: unknown;
  /** When the request that produced it started: an older request never overwrites a newer one. */
  started: number;
  /** When it was told it changed (`stale`): an answer asked for before then is not fresh. */
  staleAt?: number;
}

/**
 * How long an answer spares a page that mounts from asking again: opening a page, its panels and
 * the parts of the frame that share its keys within a few seconds ask once, not once each.
 */
export const FRESH_MS = 5000;

export class PageCache {
  private entries = new Map<string, Entry>();
  /** The parts on screen that show each key, told when a newer answer for it is stored. */
  private watchers = new Map<string, Set<(data: unknown) => void>>();
  /** When the last write arrived on a library's feed: what was asked for before it is stale. */
  private wroteAt = Number.NEGATIVE_INFINITY;

  constructor(
    private size = 100,
    private now: () => number = () => performance.now(),
  ) {}

  has(key: string) {
    return this.entries.has(key);
  }

  get(key: string): unknown {
    return this.entries.get(key)?.data;
  }

  /** Stores an answer, unless one from a later request is already here. */
  put(key: string, data: unknown, started: number) {
    const old = this.entries.get(key);
    if (old && old.started > started) return;
    this.entries.delete(key);
    this.entries.set(key, { data, started, staleAt: old?.staleAt });
    if (this.entries.size > this.size) {
      this.entries.delete(this.entries.keys().next().value as string);
    }
    for (const fn of this.watchers.get(key) ?? []) fn(data);
  }

  /**
   * Calls `fn` with each newer answer stored for `key` (by any part, a prefetch, a reload), until
   * the function it returns is called: every part showing a key shows the latest answer, so one
   * that skipped asking because the answer was fresh is never left behind by another's reload.
   */
  watch(key: string, fn: (data: unknown) => void): () => void {
    const set = this.watchers.get(key) ?? new Set();
    this.watchers.set(key, set);
    set.add(fn);
    return () => {
      set.delete(fn);
      if (set.size === 0 && this.watchers.get(key) === set) this.watchers.delete(key);
    };
  }

  /**
   * Whether a page may show its entry without asking again: asked for within `ms`, and (unless
   * `staleOnWrite` is false, for what a library's writes never change: the person's libraries,
   * their account, who is in a library) after the last write on a feed.
   */
  fresh(key: string, ms = FRESH_MS, staleOnWrite = true): boolean {
    const e = this.entries.get(key);
    if (!e || (e.staleAt !== undefined && e.started <= e.staleAt)) return false;
    if (staleOnWrite && e.started <= this.wroteAt) return false;
    return this.now() - e.started < ms;
  }

  /** A write arrived on a feed: answers asked for before it are no longer fresh. */
  wrote() {
    this.wroteAt = this.now();
  }

  /** Makes one entry stale, kept to draw from: the next part to show it asks again. */
  stale(key: string) {
    const e = this.entries.get(key);
    if (e) e.staleAt = this.now();
  }

  drop(key: string) {
    this.entries.delete(key);
  }
}

/**
 * `next`, reusing every part of `prev` with the same content (structural sharing, as TanStack Query's replaceEqualDeep does):
 * an unchanged answer comes back as `prev` itself, and a changed one keeps the identity of its
 * unchanged parts, so what a page derives from it, and the reader built on it, survive a refresh.
 */
export function share<T>(prev: unknown, next: T): T {
  if (Object.is(prev, next)) return prev as T;
  if (Array.isArray(prev) && Array.isArray(next)) {
    const out = next.map((v, i) => share(prev[i], v));
    return (out.length === prev.length && out.every((v, i) => v === prev[i]) ? prev : out) as T;
  }
  if (isPlain(prev) && isPlain(next)) {
    const keys = Object.keys(next);
    const out: Record<string, unknown> = {};
    let same = keys.length === Object.keys(prev).length;
    for (const k of keys) {
      out[k] = share(prev[k], next[k]);
      if (out[k] !== prev[k] || !(k in prev)) same = false;
    }
    return (same ? prev : out) as T;
  }
  return next;
}

function isPlain(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && Object.getPrototypeOf(v) === Object.prototype;
}
