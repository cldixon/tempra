import type { Accounts, ReachableLibrary, User } from "./accounts";

/**
 * Per-isolate caches of what authorization reads from D1 (TEMPRA-84, tempra-dev: v2/tenancy,
 * Caching): bearer tokens by hash, a session's person and its access to a library by name, and
 * an app connection's account and reachable libraries. Each entry lives at most 30 s; the
 * isolate that changes access (a member removed or re-roled, a library deleted, a sign-out, a
 * handle or account change) drops the entries it touches at once, by tag. Every other isolate
 * may serve an entry until its 30 s are up, never longer. Keys are secrets' hashes or grant
 * ids, so one account's entry is never another's.
 */

/** The longest any entry is served. */
export const AUTH_CACHE_MS = 30_000;
/** Entries per cache; past it the oldest go first. */
export const AUTH_CACHE_MAX = 1000;

/** Tags an entry carries, so a change can drop every entry that depends on it. */
export const userTag = (id: string) => `u:${id}`;
export const libraryTag = (id: string) => `l:${id}`;
export const sessionTag = (hash: string) => `s:${hash}`;
export const tokenTag = (id: string) => `t:${id}`;

interface Entry<V> {
  value: V;
  until: number;
  tags: readonly string[];
}

/** A size-capped map whose entries expire, evicting the oldest first, droppable by tag. */
export class TtlCache<V> {
  private entries = new Map<string, Entry<V>>();
  /**
   * How many drops there have been: a reader takes it before asking D1 and passes it to `set`,
   * so an answer read before a change made here is never kept after it.
   */
  drops = 0;
  constructor(
    private readonly max = AUTH_CACHE_MAX,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string): V | undefined {
    const e = this.entries.get(key);
    if (!e) return undefined;
    if (this.now() >= e.until) {
      this.entries.delete(key);
      return undefined;
    }
    return e.value;
  }

  /**
   * Keeps `value` for `ms` (nothing when `ms` is not positive, or when anything was dropped
   * since `since`, the `drops` its reader saw before asking D1).
   */
  set(key: string, value: V, ms: number, tags: readonly string[] = [], since = this.drops): void {
    if (!(ms > 0) || since !== this.drops) return;
    this.entries.delete(key);
    this.entries.set(key, { value, until: this.now() + ms, tags });
    while (this.entries.size > this.max) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  /** Drops every entry carrying any of these tags. */
  drop(tags: readonly string[]): void {
    if (tags.length === 0) return;
    this.drops++;
    const set = new Set(tags);
    for (const [key, e] of this.entries) {
      if (e.tags.some((t) => set.has(t))) this.entries.delete(key);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}

/** A session's live row and person, as `Sessions` found them. */
export interface CachedSession<R> {
  row: R;
  user: User;
}

/** An app connection's account and what it reaches, before the grant's own limits apply. */
export interface CachedGrant {
  user: User;
  /** The libraries a "selected" connection created (grant_libraries). */
  created: string[];
  reachable: ReachableLibrary[];
}

/** The isolate's caches, dropped together by tag. */
export class AuthCache {
  readonly tokens: TtlCache<unknown>;
  readonly sessions: TtlCache<unknown>;
  readonly grants: TtlCache<CachedGrant>;
  readonly ms: number;

  constructor(opts: { ms?: number; max?: number; now?: () => number } = {}) {
    this.ms = opts.ms ?? AUTH_CACHE_MS;
    this.tokens = new TtlCache(opts.max, opts.now);
    this.sessions = new TtlCache(opts.max, opts.now);
    this.grants = new TtlCache(opts.max, opts.now);
  }

  drop(...tags: string[]): void {
    this.tokens.drop(tags);
    this.sessions.drop(tags);
    this.grants.drop(tags);
  }
}

/**
 * Accounts that drop the cache's entries for what each change touches, after the change: so the
 * isolate that removes a member, changes a role, deletes a library or renames an account never
 * serves the old answer. Reads pass straight through.
 */
export function invalidatingAccounts(accounts: Accounts, cache: AuthCache): Accounts {
  const after = async <T>(work: Promise<T>, ...tags: string[]): Promise<T> => {
    try {
      return await work;
    } finally {
      cache.drop(...tags);
    }
  };
  return {
    ...accounts,
    share: (libraryId, userId, role, grantedBy) =>
      after(
        accounts.share(libraryId, userId, role, grantedBy),
        userTag(userId),
        libraryTag(libraryId),
      ),
    unshare: (libraryId, userId) =>
      after(accounts.unshare(libraryId, userId), userTag(userId), libraryTag(libraryId)),
    decideInvitation: (id, userId, accept) =>
      after(accounts.decideInvitation(id, userId, accept), userTag(userId)),
    createLibrary: (slug, owner, opts) =>
      after(accounts.createLibrary(slug, owner, opts), userTag(owner.id)),
    revokeToken: (id, userId) => after(accounts.revokeToken(id, userId), tokenTag(id)),
    setEmail: (userId, email) => after(accounts.setEmail(userId, email), userTag(userId)),
    setHandle: (userId, handle, opts) =>
      after(accounts.setHandle(userId, handle, opts), userTag(userId)),
    setTheme: (userId, theme) => after(accounts.setTheme(userId, theme), userTag(userId)),
    setName: (userId, name) => after(accounts.setName(userId, name), userTag(userId)),
    deleteLibrary: (libraryId) => after(accounts.deleteLibrary(libraryId), libraryTag(libraryId)),
    deleteUser: (user) => after(accounts.deleteUser(user), userTag(user.id)),
  };
}
