import { Database } from "bun:sqlite";
import { type RowTally, type SqlHandle, type SqlValue, writtenTable } from "../src/store/sql";

/**
 * bun:sqlite standing in for the Durable Object's SQLite handle. With `tally`, each statement's
 * rows are counted as the DO counts them, as near as bun:sqlite tells (TEMPRA-228): rows read are
 * the rows returned, rows written SQLite's own change count (triggers included, FTS5's shadow
 * tables and index rows not), so tests can check the plumbing but not production's numbers.
 */
export function bunSqlHandle(db = new Database(":memory:"), tally?: RowTally): SqlHandle {
  const bind = (params: SqlValue[]) => params as (string | number | null | Uint8Array)[];
  const changes = () =>
    (db.query("SELECT total_changes() AS n").get() as { n: number } | null)?.n ?? 0;
  return {
    all: <T>(query: string, ...params: SqlValue[]) => {
      if (!tally) return db.query(query).all(...bind(params)) as T[];
      const before = writtenTable(query) ? changes() : 0;
      const rows = db.query(query).all(...bind(params)) as T[];
      tally.add(query, rows.length, writtenTable(query) ? changes() - before : 0);
      return rows;
    },
    run: (query, ...params) => {
      if (!tally) {
        db.query(query).run(...bind(params));
        return;
      }
      const before = changes();
      db.query(query).run(...bind(params));
      tally.add(query, 0, changes() - before);
    },
    script: (sql) => {
      db.run(sql);
    },
    transaction: (fn) => db.transaction(fn)(),
  };
}
