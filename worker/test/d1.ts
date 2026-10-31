import { Database, type SQLQueryBindings } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Enough of D1 over bun:sqlite for the account layer, with the real migrations applied, so tests
 * run the same SQL production does.
 */
export function bunD1(): { d1: D1Database; db: Database; sessions: string[] } {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  const dir = join(import.meta.dir, "../migrations");
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    // As D1 does: one migration is one transaction (its PRAGMA defer_foreign_keys needs that).
    const statements = readFileSync(join(dir, file), "utf8")
      .replace(/--.*$/gm, "")
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    db.transaction(() => {
      for (const s of statements) db.run(s);
    })();
  }

  const statement = (sql: string, params: unknown[] = []) => {
    const q = () => db.query(sql);
    const args = params as SQLQueryBindings[];
    const stmt = {
      bind: (...p: unknown[]) => statement(sql, p),
      async first<T>(col?: string) {
        const row = (q().get(...args) as Record<string, unknown> | null) ?? null;
        if (row && col) return row[col] as T;
        return row as T | null;
      },
      async all<T>() {
        return { results: q().all(...args) as T[], success: true, meta: {} };
      },
      async run() {
        const r = q().run(...args);
        return { results: [], success: true, meta: { changes: r.changes } };
      },
      async raw<T>() {
        return q().values(...args) as T[];
      },
      sync() {
        return q().run(...args);
      },
    };
    return stmt;
  };

  const d1 = {
    prepare: (sql: string) => statement(sql),
    async batch(stmts: ReturnType<typeof statement>[]) {
      return db.transaction(() =>
        stmts.map((s) => ({ results: [], success: true, meta: { changes: s.sync().changes } })),
      )();
    },
    async exec(sql: string) {
      db.run(sql);
      return { count: 1, duration: 0 };
    },
    /**
     * D1's Sessions API without replicas (TEMPRA-85): one database, so every session reads the
     * latest; the bookmark counts the changes made so far, shaped and ordered as D1's are.
     * Queries go through `d1.prepare` at call time, so a test that wraps it still sees them.
     */
    withSession(start = "first-unconstrained") {
      sessions.push(start);
      let used = false;
      return {
        prepare(sql: string) {
          used = true;
          return d1.prepare(sql);
        },
        batch(stmts: ReturnType<typeof statement>[]) {
          used = true;
          return d1.batch(stmts);
        },
        getBookmark: () => (used ? bunBookmark(db) : null),
      };
    },
  };
  /** Where each request's session started, in order. */
  const sessions: string[] = [];
  return { d1: d1 as unknown as D1Database, db, sessions };
}

/** A D1-shaped bookmark for the database's state: its total changes, so later sorts after. */
export function bunBookmark(db: Database): string {
  const n = (db.query("SELECT total_changes() AS n").get() as { n: number }).n;
  return `${n.toString(16).padStart(8, "0")}-00000000-00000000-${"0".repeat(32)}`;
}
