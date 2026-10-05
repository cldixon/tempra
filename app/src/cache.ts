/**
 * What each page loaded last (see useLoad in api.ts), so a page seen before draws at once. Kept
 * apart from React so its rules can be tested: newer answers win, and only a prefetch spares
 * the page from asking again.
 */
interface Entry {
  data: unknown;
  /** When the request that produced it started: an older request never overwrites a newer one. */
  started: number;
  /** When it arrived. */
  at: number;
  /** Loaded ahead of a visit (a hover); the visit that uses it need not ask again. */
  prefetched: boolean;
}

export class PageCache {
  private entries = new Map<string, Entry>();

  constructor(
    private size = 100,
    private freshMs = 5000,
    private now: () => number = () => performance.now(),
  ) {}

  has(key: string) {
    return this.entries.has(key);
  }

  get(key: string): unknown {
    return this.entries.get(key)?.data;
  }

  /** Stores an answer, unless one from a later request is already here. */
  put(key: string, data: unknown, started: number, prefetched = false) {
    const old = this.entries.get(key);
    if (old && old.started > started) return;
    this.entries.delete(key);
    this.entries.set(key, { data, started, at: this.now(), prefetched });
    if (this.entries.size > this.size) {
      this.entries.delete(this.entries.keys().next().value as string);
    }
  }

  /**
   * Whether a page may show its entry without asking again: only a prefetch that just arrived,
   * and only once (the next visit asks as usual).
   */
  takeFresh(key: string): boolean {
    const e = this.entries.get(key);
    if (!e?.prefetched) return false;
    e.prefetched = false;
    return this.now() - e.at < this.freshMs;
  }

  /** Whether a prefetch is pointless: a fresh prefetched answer is already here. */
  fresh(key: string): boolean {
    const e = this.entries.get(key);
    return !!e?.prefetched && this.now() - e.at < this.freshMs;
  }

  drop(key: string) {
    this.entries.delete(key);
  }
}

/**
 * `next`, reusing every part of `prev` with the same content (React Query's replaceEqualDeep):
 * an unchanged answer comes back as `prev` itself, and a changed one keeps the identity of its
 * unchanged parts, so a page's memos and the reader built on them survive a refresh.
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
