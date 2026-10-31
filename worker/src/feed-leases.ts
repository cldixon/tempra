/**
 * The per-account cap on change-feed sockets (TEMPRA-80, tempra-dev: v2/limits). An account's
 * sockets live in many Library objects, so one small object per account (FeedLeases in
 * account-feeds.ts) keeps a lease per socket it let open. The library that held a socket releases
 * its lease when the socket closes (`release`, sent from its `webSocketClose`, off the close's
 * path); a lease whose release never came (a library evicted mid-close, a lost call) is found
 * when the leases reach the cap: it asks each library holding them which are still open (the
 * Library object reads them from `getWebSockets()`) and forgets the rest. So a page reloaded
 * again and again gives its place back at each reload, not a minute later, and the count it
 * refuses on is exact. Free of Worker APIs; tests run it on bun:sqlite.
 */
import type { SqlHandle } from "./store/sql";

/**
 * A lease this young is kept when its library does not list it: its socket may not be accepted
 * yet. Only that check waits for it; a release frees the place at once.
 */
export const LEASE_GRACE_MS = 60_000;

export interface Lease {
  id: string;
  /** The Library object (its DO name) that holds the socket. */
  doId: string;
}

/** The lease ids a library's open sockets carry; null when the library cannot answer (gone). */
export type LiveLeases = (doId: string) => Promise<string[] | null>;

export class FeedLeases {
  constructor(private readonly sql: SqlHandle) {
    sql.script(
      "CREATE TABLE IF NOT EXISTS leases (id TEXT PRIMARY KEY, do_id TEXT NOT NULL, at INTEGER NOT NULL)",
    );
  }

  count(): number {
    return this.sql.all<{ n: number }>("SELECT count(*) AS n FROM leases")[0]?.n ?? 0;
  }

  /**
   * Takes a lease for a new socket if the account is under `cap`; at the cap, first forgets the
   * leases whose sockets have closed. False: refuse the socket.
   */
  async acquire(lease: Lease, cap: number, live: LiveLeases, now = Date.now()): Promise<boolean> {
    if (this.count() >= cap) await this.reconcile(live, now);
    if (this.count() >= cap) return false;
    this.sql.run(
      "INSERT OR REPLACE INTO leases (id, do_id, at) VALUES (?, ?, ?)",
      lease.id,
      lease.doId,
      now,
    );
    return true;
  }

  /** Forgets the lease of a socket its library saw close. */
  release(id: string): void {
    this.sql.run("DELETE FROM leases WHERE id = ?", id);
  }

  /** Drops every lease older than the grace period whose socket its library no longer holds. */
  async reconcile(live: LiveLeases, now = Date.now()): Promise<void> {
    const settled = this.sql.all<{ id: string; do_id: string }>(
      "SELECT id, do_id FROM leases WHERE at <= ?",
      now - LEASE_GRACE_MS,
    );
    const byLibrary = new Map<string, string[]>();
    for (const r of settled) byLibrary.set(r.do_id, [...(byLibrary.get(r.do_id) ?? []), r.id]);
    for (const [doId, ids] of byLibrary) {
      let open: string[] | null;
      try {
        open = await live(doId);
      } catch {
        // Could not ask (the library is restarting): keep its leases; they are checked next time.
        continue;
      }
      const still = new Set(open ?? []);
      for (const id of ids) if (!still.has(id)) this.sql.run("DELETE FROM leases WHERE id = ?", id);
    }
  }
}
