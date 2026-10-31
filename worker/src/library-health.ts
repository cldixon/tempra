import type { LibraryHealth } from "./store/store";

/**
 * Library health rows (TEMPRA-92; tempra-dev: v2/library-maintenance, Health rows). Each library
 * works out its own problems at the end of its maintenance pass and keeps one row in D1
 * `library_health`: what is wrong (an export failing or over two days behind, storage over 80%, the
 * pass itself failing), its open work from the health summary (TEMPRA-66) and when its next pass
 * is due. The operator digest reads only these rows, with indexed queries bounded by what it
 * lists, so it costs the same with 100 libraries or 1,000,000 and wakes none of them (the rule:
 * tempra-dev decisions/no-loops-over-every-library). A library whose alarm stopped is found by its
 * `next_run` passing. Free of Worker APIs.
 */

const DAY_MS = 86_400_000;
const MB = 1048576;

/** Storage at or above this share of the library's cap is a problem. */
export const STORAGE_WARN = 0.8;
/** How many libraries the digest names in each list; the rest are counted. */
export const DIGEST_LIBRARIES = 50;
/** How many libraries' open work the digest lists. */
export const DIGEST_HEALTH_LIBRARIES = 20;
/** The digest counts each list up to this many, so a count never reads every row. */
export const DIGEST_COUNT_CAP = 10_000;

export type HealthCounts = LibraryHealth["counts"];

/** What a library knows about itself after a pass, for its row. */
export interface HealthInput {
  export: { lag: number; last_run: string | null };
  bytes: number;
  limitBytes: number;
  counts: HealthCounts | null;
  /** When its next pass is due (the alarm the pass just set). */
  nextRun: string | null;
  /** Why the pass failed, when it did. */
  failure?: string | null;
  now: Date;
}

/** One library's row, as written. */
export interface HealthRow {
  problems: string[] | null;
  open: number;
  counts: HealthCounts | null;
  nextRun: string | null;
}

/** Open work in a health summary; stale soon looks ahead and is not counted. */
export const openWork = (c: HealthCounts) =>
  c.stale + c.broken_link + c.lint + (c.external_image ?? 0) + c.structure + c.comment;

/** What the operator should look at in one library, as sentences without its path. */
export function libraryProblems(i: HealthInput): string[] {
  const out: string[] = [];
  if (i.failure) out.push(`maintenance failed: ${i.failure.slice(0, 200)}`);
  const exp = i.export;
  if (exp.lag > 0 && exp.last_run && Date.parse(exp.last_run) < i.now.getTime() - 2 * DAY_MS) {
    out.push(`last export ${exp.last_run}, ${exp.lag} events behind`);
  }
  if (i.bytes >= STORAGE_WARN * i.limitBytes) {
    out.push(`${Math.round(i.bytes / MB)} MB of ${Math.round(i.limitBytes / MB)} MB`);
  }
  return out;
}

export function healthRow(i: HealthInput): HealthRow {
  const problems = libraryProblems(i);
  const open = i.counts ? openWork(i.counts) : 0;
  return {
    problems: problems.length > 0 ? problems : null,
    open,
    counts: open > 0 && i.counts ? i.counts : null,
    nextRun: i.nextRun,
  };
}

/** The counts as JSON with a fixed key order, so an unchanged summary compares equal. */
function countsJson(c: HealthCounts | null): string | null {
  if (!c) return null;
  return JSON.stringify({
    stale: c.stale,
    stale_soon: c.stale_soon,
    broken_link: c.broken_link,
    lint: c.lint,
    structure: c.structure,
    comment: c.comment,
    request: c.request ?? 0,
    external_image: c.external_image ?? 0,
  });
}

/**
 * Writes a library's row when anything in it changed (an upsert whose update is skipped when
 * nothing differs, so an unchanged report writes no row), and records its storage for the
 * account's quota (TEMPRA-232) in the same batch, likewise only when it changed.
 */
export async function writeHealth(
  db: D1Database,
  library: string,
  row: HealthRow,
  now: Date,
  bytes?: number,
): Promise<void> {
  const problems = row.problems ? JSON.stringify(row.problems) : null;
  const statements = [
    db
      .prepare(
        `INSERT INTO library_health (library, problems, open_work, counts, next_run, checked_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT (library) DO UPDATE SET problems = excluded.problems,
           open_work = excluded.open_work, counts = excluded.counts,
           next_run = excluded.next_run, checked_at = excluded.checked_at
         WHERE library_health.problems IS NOT excluded.problems
            OR library_health.open_work IS NOT excluded.open_work
            OR library_health.counts IS NOT excluded.counts
            OR library_health.next_run IS NOT excluded.next_run`,
      )
      .bind(library, problems, row.open, countsJson(row.counts), row.nextRun, now.toISOString()),
  ];
  if (bytes !== undefined) {
    const b = Math.max(0, Math.round(bytes));
    statements.push(
      db
        .prepare("UPDATE libraries SET storage_bytes = ?1 WHERE do_id = ?2 AND storage_bytes != ?1")
        .bind(b, library),
    );
  }
  await db.batch(statements);
}

/** The parts of a LibraryStore a report reads. */
export interface ReportingStore {
  stats(): {
    next_run: string | null;
    maintainers: { export: { lag: number; last_run: string | null } };
  };
  storageBytes(): number;
  health(): LibraryHealth;
}

/**
 * A library's report after a pass (the Library DO's alarm and "Export now"): works out its row
 * from its own state and writes it, with its storage. Returns the row.
 */
export async function reportHealth(
  db: D1Database,
  library: string,
  store: ReportingStore,
  o: { limitBytes: number; failure?: string | null; now: Date },
): Promise<HealthRow> {
  const stats = store.stats();
  const bytes = store.storageBytes();
  const row = healthRow({
    export: stats.maintainers.export,
    bytes,
    limitBytes: o.limitBytes,
    counts: store.health().counts,
    nextRun: stats.next_run,
    failure: o.failure ?? null,
    now: o.now,
  });
  await writeHealth(db, library, row, o.now, bytes);
  return row;
}

/**
 * On a library's first use after the deploy: a row with only its next pass, if it has none yet,
 * so a library whose first alarm never fires is still found. Its first pass fills it in.
 */
export async function ensureHealthRow(
  db: D1Database,
  library: string,
  nextRun: string | null,
  now: Date,
): Promise<void> {
  await db
    .prepare(
      "INSERT OR IGNORE INTO library_health (library, next_run, checked_at) VALUES (?1, ?2, ?3)",
    )
    .bind(library, nextRun, now.toISOString())
    .run();
}

/** What the digest takes from the health rows. */
export interface HealthDigest {
  /** Every library, from D1. */
  libraries: number;
  /** Lines for the operator: each library's problems, and libraries whose pass is overdue. */
  attention: string[];
  /** The libraries with the most open work, the most first. */
  health: { path: string; counts: HealthCounts }[];
  /** How many libraries have open work (counted up to DIGEST_COUNT_CAP). */
  healthTotal: number;
}

const PATH = `COALESCE(u.handle, '?') || '/' || l.slug AS path`;
const JOINED = `library_health h JOIN libraries l ON l.do_id = h.library LEFT JOIN users u ON u.id = l.owner`;

/** The digest's queries over `library_health`, each bounded by what it lists or counts. */
export const DIGEST_QUERIES = {
  problems: `SELECT ${PATH}, h.problems FROM ${JOINED}
    WHERE h.problems IS NOT NULL ORDER BY h.library LIMIT ?1`,
  problemCount: `SELECT COUNT(*) AS n FROM (SELECT 1 FROM library_health
    WHERE problems IS NOT NULL LIMIT ?1)`,
  overdue: `SELECT ${PATH}, h.next_run FROM ${JOINED}
    WHERE h.next_run < ?1 ORDER BY h.next_run LIMIT ?2`,
  overdueCount: `SELECT COUNT(*) AS n FROM (SELECT 1 FROM library_health
    WHERE next_run < ?1 LIMIT ?2)`,
  open: `SELECT ${PATH}, h.counts FROM ${JOINED}
    WHERE h.open_work > 0 ORDER BY h.open_work DESC, h.library DESC LIMIT ?1`,
  openCount: `SELECT COUNT(*) AS n FROM (SELECT 1 FROM library_health
    WHERE open_work > 0 LIMIT ?1)`,
  libraries: "SELECT COUNT(*) AS n FROM libraries",
};

const more = (n: number, shown: number, what: string) =>
  n > shown
    ? [`and ${n >= DIGEST_COUNT_CAP ? `${DIGEST_COUNT_CAP}+` : n - shown} more ${what}`]
    : [];

/** Reads the health rows for the digest. A pass overdue by over a day means its alarm stopped. */
export async function healthDigest(db: D1Database, now: Date): Promise<HealthDigest> {
  const q = DIGEST_QUERIES;
  const n = async (sql: string, ...args: unknown[]) =>
    (
      await db
        .prepare(sql)
        .bind(...args)
        .first<{ n: number }>()
    )?.n ?? 0;
  const overdueBefore = new Date(now.getTime() - DAY_MS).toISOString();

  const problems = (
    await db.prepare(q.problems).bind(DIGEST_LIBRARIES).all<{ path: string; problems: string }>()
  ).results;
  const overdue = (
    await db
      .prepare(q.overdue)
      .bind(overdueBefore, DIGEST_LIBRARIES)
      .all<{ path: string; next_run: string }>()
  ).results;
  const open = (
    await db.prepare(q.open).bind(DIGEST_HEALTH_LIBRARIES).all<{ path: string; counts: string }>()
  ).results;

  const attention: string[] = [];
  for (const r of problems) {
    for (const p of JSON.parse(r.problems) as string[]) attention.push(`${r.path}: ${p}`);
  }
  if (problems.length === DIGEST_LIBRARIES) {
    attention.push(
      ...more(
        await n(q.problemCount, DIGEST_COUNT_CAP),
        problems.length,
        "libraries with problems",
      ),
    );
  }
  for (const r of overdue) {
    attention.push(`${r.path}: daily maintenance overdue since ${r.next_run}`);
  }
  if (overdue.length === DIGEST_LIBRARIES) {
    attention.push(
      ...more(
        await n(q.overdueCount, overdueBefore, DIGEST_COUNT_CAP),
        overdue.length,
        "libraries with maintenance overdue",
      ),
    );
  }
  const health = open.map((r) => ({ path: r.path, counts: JSON.parse(r.counts) as HealthCounts }));
  const healthTotal =
    open.length === DIGEST_HEALTH_LIBRARIES ? await n(q.openCount, DIGEST_COUNT_CAP) : open.length;
  return { libraries: await n(q.libraries), attention, health, healthTotal };
}
