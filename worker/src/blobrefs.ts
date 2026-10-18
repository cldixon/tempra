/**
 * Which attachment blobs are stored in R2 and which libraries reference them, kept in the account
 * D1 as they change (TEMPRA-81, TEMPRA-91; tempra-dev: v2/blob-sweep), so the daily sweep is an
 * indexed query that lists no bucket and wakes no library. Every choice here errs toward keeping
 * a blob: a reference recorded early, a recount that keeps rows it is unsure of, a library not
 * yet counted holding deletion back. Free of Worker APIs.
 */

/** A recount keeps rows added this recently even when its snapshot lacks them: a write records
 * its reference in D1 before it commits in the library, and a snapshot can fall in between. */
export const RECOUNT_MARGIN_MS = 10 * 60_000;

export interface BlobRefs {
  /** A blob is about to be put in R2: recorded, and an orphan (with a fresh clock) if unreferenced. */
  stored(hash: string, at: Date): Promise<void>;
  /** Blobs found by the one-time listing of the bucket. */
  storedFromListing(rows: { hash: string; created: string }[], at: Date): Promise<void>;
  /** A write is about to add these blobs to a library. */
  reference(library: string, hashes: string[], at: Date): Promise<void>;
  /** A restore is about to roll the library back: hold deletion until the recount with `token`. */
  pend(library: string, token: string): Promise<void>;
  /** Replaces a library's rows from its own list of hashes, taken at `takenAt`. */
  replace(
    library: string,
    hashes: string[],
    takenAt: Date,
    token?: string,
  ): Promise<{ added: number; removed: number }>;
  /** The library is gone: its references go, and blobs it was the last to reference are orphans. */
  forget(library: string, at: Date): Promise<number>;
  /** Whether a library (by do_id) still exists. */
  exists(library: string): Promise<boolean>;
  /** Gives each library a count-state row (uncounted) if it has none. */
  ensure(libraries: string[]): Promise<void>;
  /** Libraries by do_id after `after`, for a full recount, with any restore's pending token. */
  libraryPage(after: string, limit: number): Promise<{ library: string; pending: string | null }[]>;
  /** Count-state rows uncounted or pending after `after` (deleted libraries' included). */
  openPage(after: string, limit: number): Promise<{ library: string; pending: string | null }[]>;
  /** Existing libraries that hold deletion back: how many, and a few by path. */
  held(limit: number): Promise<{ count: number; paths: string[] }>;
  /** Orphans unreferenced since `cutoff` or earlier, oldest first. */
  expired(cutoff: string, limit: number): Promise<string[]>;
  /** Takes orphans for deletion: only those still expired and unreferenced now. */
  claim(hashes: string[], cutoff: string): Promise<{ hash: string; since: string }[]>;
  /** Gives back claimed orphans whose bytes could not be deleted. */
  unclaim(rows: { hash: string; since: string }[]): Promise<void>;
  /** The bytes are gone: drops their stored rows. */
  dropStored(hashes: string[]): Promise<void>;
  /** One page of the drift scan: stored blobs after `after` with no reference become orphans. */
  scan(after: string, limit: number, at: Date): Promise<{ last: string | null; marked: number }>;
  counts(): Promise<{ stored: number; referenced: number; waiting: number }>;
  state(key: SweepStateKey): Promise<{ value: string; updated: string } | null>;
  setState(key: SweepStateKey, value: string, at: Date): Promise<void>;
}

/**
 * full_at: when the last full recount was dispatched. full_dispatch: its paging cursor, or done.
 * ensured: set once, when a full dispatch first reached the last library, so every library has a
 * count-state row. listing: the one-time bucket listing's cursor, or done. scan: the drift scan's.
 */
export type SweepStateKey = "full_at" | "full_dispatch" | "ensured" | "listing" | "scan";

/** D1 binds at most 100 parameters per statement. */
const CHUNK = 90;

function chunks<T>(xs: T[], n = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

const marks = (n: number) => Array.from({ length: n }, () => "?").join(", ");

export function d1BlobRefs(db: D1Database): BlobRefs {
  const orphanIfUnreferenced = (hashes: string[], since: string) =>
    chunks(hashes).map((c) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO blob_orphans (hash, since)
           SELECT s.hash, ? FROM blobs_stored s
           WHERE s.hash IN (${marks(c.length)})
             AND NOT EXISTS (SELECT 1 FROM blob_refs r WHERE r.hash = s.hash)`,
        )
        .bind(since, ...c),
    );
  const clearOrphans = (hashes: string[]) =>
    chunks(hashes).map((c) =>
      db.prepare(`DELETE FROM blob_orphans WHERE hash IN (${marks(c.length)})`).bind(...c),
    );

  return {
    async stored(hash, at) {
      const now = at.toISOString();
      await db.batch([
        db
          .prepare("INSERT OR IGNORE INTO blobs_stored (hash, created) VALUES (?, ?)")
          .bind(hash, now),
        // A re-upload of a blob nobody references starts its 31 days again, so bytes uploaded to
        // be attached are not deleted under the upload.
        db
          .prepare(
            `INSERT INTO blob_orphans (hash, since)
             SELECT ?1, ?2 WHERE NOT EXISTS (SELECT 1 FROM blob_refs WHERE hash = ?1)
             ON CONFLICT (hash) DO UPDATE SET since = excluded.since`,
          )
          .bind(hash, now),
      ]);
    },

    async storedFromListing(rows, at) {
      if (rows.length === 0) return;
      const stmts = chunks(rows, 45).map((c) =>
        db
          .prepare(
            `INSERT OR IGNORE INTO blobs_stored (hash, created) VALUES ${c.map(() => "(?, ?)").join(", ")}`,
          )
          .bind(...c.flatMap((r) => [r.hash, r.created])),
      );
      await db.batch([
        ...stmts,
        ...orphanIfUnreferenced(
          rows.map((r) => r.hash),
          at.toISOString(),
        ),
      ]);
    },

    async reference(library, hashes, at) {
      const unique = [...new Set(hashes)];
      if (unique.length === 0) return;
      const now = at.toISOString();
      await db.batch([
        // `added` moves to now, so a recount running beside this write keeps the row.
        ...chunks(unique, 30).map((c) =>
          db
            .prepare(
              `INSERT INTO blob_refs (hash, library, added) VALUES ${c.map(() => "(?, ?, ?)").join(", ")}
               ON CONFLICT (hash, library) DO UPDATE SET added = excluded.added`,
            )
            .bind(...c.flatMap((h) => [h, library, now])),
        ),
        ...clearOrphans(unique),
        // A library with no count-state row (made before this was tracked) is uncounted.
        db.prepare("INSERT OR IGNORE INTO blob_ref_libraries (library) VALUES (?)").bind(library),
      ]);
    },

    async pend(library, token) {
      await db
        .prepare(
          `INSERT INTO blob_ref_libraries (library, pending) VALUES (?1, ?2)
           ON CONFLICT (library) DO UPDATE SET pending = ?2`,
        )
        .bind(library, token)
        .run();
    },

    async replace(library, hashes, takenAt, token) {
      const snapshot = new Set(hashes);
      const existing = (
        await db
          .prepare("SELECT hash, added FROM blob_refs WHERE library = ?")
          .bind(library)
          .all<{ hash: string; added: string }>()
      ).results;
      const have = new Set(existing.map((r) => r.hash));
      const keepAfter = new Date(takenAt.getTime() - RECOUNT_MARGIN_MS).toISOString();
      const added = [...snapshot].filter((h) => !have.has(h));
      const removed = existing
        .filter((r) => !snapshot.has(r.hash) && r.added < keepAfter)
        .map((r) => r.hash);
      const now = takenAt.toISOString();
      await db.batch([
        ...chunks(added, 30).map((c) =>
          db
            .prepare(
              `INSERT OR IGNORE INTO blob_refs (hash, library, added) VALUES ${c.map(() => "(?, ?, ?)").join(", ")}`,
            )
            .bind(...c.flatMap((h) => [h, library, now])),
        ),
        // A referenced blob is no orphan (rows from before the library was first counted).
        ...clearOrphans([...snapshot]),
        ...chunks(removed).map((c) =>
          db
            .prepare(
              `DELETE FROM blob_refs WHERE library = ? AND added < ? AND hash IN (${marks(c.length)})`,
            )
            .bind(library, keepAfter, ...c),
        ),
        ...orphanIfUnreferenced(removed, now),
        db
          .prepare(
            `INSERT INTO blob_ref_libraries (library, counted) VALUES (?1, ?2)
             ON CONFLICT (library) DO UPDATE SET counted = ?2,
               pending = CASE WHEN pending = ?3 THEN NULL ELSE pending END`,
          )
          .bind(library, now, token ?? null),
      ]);
      return { added: added.length, removed: removed.length };
    },

    async forget(library, at) {
      const hashes = (
        await db
          .prepare("SELECT hash FROM blob_refs WHERE library = ?")
          .bind(library)
          .all<{ hash: string }>()
      ).results.map((r) => r.hash);
      await db.batch([
        db.prepare("DELETE FROM blob_refs WHERE library = ?").bind(library),
        ...orphanIfUnreferenced(hashes, at.toISOString()),
        db.prepare("DELETE FROM blob_ref_libraries WHERE library = ?").bind(library),
      ]);
      return hashes.length;
    },

    async exists(library) {
      return (
        (await db
          .prepare("SELECT 1 AS ok FROM libraries WHERE do_id = ?")
          .bind(library)
          .first()) !== null
      );
    },

    async ensure(libraries) {
      if (libraries.length === 0) return;
      await db.batch(
        chunks(libraries).map((c) =>
          db
            .prepare(
              `INSERT OR IGNORE INTO blob_ref_libraries (library) VALUES ${c.map(() => "(?)").join(", ")}`,
            )
            .bind(...c),
        ),
      );
    },

    async libraryPage(after, limit) {
      return (
        await db
          .prepare(
            `SELECT l.do_id AS library, s.pending FROM libraries l
             LEFT JOIN blob_ref_libraries s ON s.library = l.do_id
             WHERE l.do_id > ? ORDER BY l.do_id LIMIT ?`,
          )
          .bind(after, limit)
          .all<{ library: string; pending: string | null }>()
      ).results;
    },

    async openPage(after, limit) {
      return (
        await db
          .prepare(
            `SELECT library, pending FROM blob_ref_libraries
             WHERE (counted IS NULL OR pending IS NOT NULL) AND library > ?
             ORDER BY library LIMIT ?`,
          )
          .bind(after, limit)
          .all<{ library: string; pending: string | null }>()
      ).results;
    },

    async held(limit) {
      // A library with no count-state row at all is caught by the full day's dispatch, which
      // gives every library one before any of them is counted.
      const from = `FROM blob_ref_libraries s JOIN libraries l ON l.do_id = s.library
        WHERE s.counted IS NULL OR s.pending IS NOT NULL`;
      const count =
        (await db.prepare(`SELECT COUNT(*) AS n ${from}`).first<{ n: number }>())?.n ?? 0;
      if (count === 0) return { count, paths: [] };
      const paths = (
        await db
          .prepare(
            `SELECT COALESCE(u.handle, '?') || '/' || l.slug AS path
             FROM blob_ref_libraries s JOIN libraries l ON l.do_id = s.library
             LEFT JOIN users u ON u.id = l.owner
             WHERE s.counted IS NULL OR s.pending IS NOT NULL
             ORDER BY s.library LIMIT ?`,
          )
          .bind(limit)
          .all<{ path: string }>()
      ).results.map((r) => r.path);
      return { count, paths };
    },

    async expired(cutoff, limit) {
      return (
        await db
          .prepare(
            `SELECT o.hash FROM blob_orphans o
             WHERE o.since <= ? AND NOT EXISTS (SELECT 1 FROM blob_refs r WHERE r.hash = o.hash)
             ORDER BY o.since LIMIT ?`,
          )
          .bind(cutoff, limit)
          .all<{ hash: string }>()
      ).results.map((r) => r.hash);
    },

    async claim(hashes, cutoff) {
      const out: { hash: string; since: string }[] = [];
      for (const c of chunks(hashes)) {
        const r = await db
          .prepare(
            `DELETE FROM blob_orphans
             WHERE since <= ? AND hash IN (${marks(c.length)})
               AND NOT EXISTS (SELECT 1 FROM blob_refs r WHERE r.hash = blob_orphans.hash)
             RETURNING hash, since`,
          )
          .bind(cutoff, ...c)
          .all<{ hash: string; since: string }>();
        out.push(...r.results);
      }
      return out;
    },

    async unclaim(rows) {
      if (rows.length === 0) return;
      await db.batch(
        chunks(rows, 45).map((c) =>
          db
            .prepare(
              `INSERT OR IGNORE INTO blob_orphans (hash, since) VALUES ${c.map(() => "(?, ?)").join(", ")}`,
            )
            .bind(...c.flatMap((r) => [r.hash, r.since])),
        ),
      );
    },

    async dropStored(hashes) {
      if (hashes.length === 0) return;
      // Not one uploaded again since it was claimed: that one is an orphan again, or referenced.
      await db.batch(
        chunks(hashes).map((c) =>
          db
            .prepare(
              `DELETE FROM blobs_stored WHERE hash IN (${marks(c.length)})
               AND NOT EXISTS (SELECT 1 FROM blob_orphans o WHERE o.hash = blobs_stored.hash)
               AND NOT EXISTS (SELECT 1 FROM blob_refs r WHERE r.hash = blobs_stored.hash)`,
            )
            .bind(...c),
        ),
      );
    },

    async scan(after, limit, at) {
      const page = (
        await db
          .prepare("SELECT hash FROM blobs_stored WHERE hash > ? ORDER BY hash LIMIT ?")
          .bind(after, limit)
          .all<{ hash: string }>()
      ).results;
      const last = page.length === limit ? (page[page.length - 1]?.hash ?? null) : null;
      if (page.length === 0) return { last: null, marked: 0 };
      const upTo = page[page.length - 1]?.hash ?? after;
      const r = await db
        .prepare(
          `INSERT OR IGNORE INTO blob_orphans (hash, since)
           SELECT s.hash, ? FROM blobs_stored s
           WHERE s.hash > ? AND s.hash <= ?
             AND NOT EXISTS (SELECT 1 FROM blob_refs r WHERE r.hash = s.hash)`,
        )
        .bind(at.toISOString(), after, upTo)
        .run();
      return { last, marked: r.meta.changes ?? 0 };
    },

    async counts() {
      const one = async (sql: string) => (await db.prepare(sql).first<{ n: number }>())?.n ?? 0;
      return {
        stored: await one("SELECT COUNT(*) AS n FROM blobs_stored"),
        referenced: await one("SELECT COUNT(DISTINCT hash) AS n FROM blob_refs"),
        waiting: await one("SELECT COUNT(*) AS n FROM blob_orphans"),
      };
    },

    async state(key) {
      return db
        .prepare("SELECT value, updated FROM sweep_state WHERE key = ?")
        .bind(key)
        .first<{ value: string; updated: string }>();
    },

    async setState(key, value, at) {
      await db
        .prepare(
          `INSERT INTO sweep_state (key, value, updated) VALUES (?1, ?2, ?3)
           ON CONFLICT (key) DO UPDATE SET value = ?2, updated = ?3`,
        )
        .bind(key, value, at.toISOString())
        .run();
    },
  };
}
