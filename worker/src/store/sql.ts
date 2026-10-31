export type SqlValue = string | number | null | ArrayBuffer | Uint8Array;
export type Row = Record<string, SqlValue>;

/**
 * The plain SQLite handle the store is written against. The Library DO adapts
 * `ctx.storage.sql`; tests adapt `bun:sqlite`. Everything is synchronous so a write runs as one
 * transaction with no awaits inside it.
 */
export interface SqlHandle {
  /** Runs one statement and returns its rows. */
  all<T = Row>(query: string, ...params: SqlValue[]): T[];
  /** Runs one statement, ignoring rows. */
  run(query: string, ...params: SqlValue[]): void;
  /** Runs a script of several statements with no parameters (DDL). */
  script(sql: string): void;
  /** Runs `fn` in a transaction; a throw rolls everything back. */
  transaction<T>(fn: () => T): T;
}

/**
 * What some SQL cost (TEMPRA-228): the rows SQLite read and wrote, as Durable Objects bill them
 * (each cursor's `rowsRead` and `rowsWritten`, a trigger's rows and index rows included), and the
 * rows written split by the table each statement writes (`fts`, `fts_rows`, `access_log`, …).
 */
export interface RowCost {
  rowsRead: number;
  rowsWritten: number;
  /** Rows written by the table a statement writes; a trigger's rows count to its statement's. */
  tables: Record<string, number>;
}

export const NO_COST: RowCost = { rowsRead: 0, rowsWritten: 0, tables: {} };

/** The table a write statement writes, or null for a read. */
export function writtenTable(query: string): string | null {
  const m =
    /^\s*(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|REPLACE\s+INTO|DELETE\s+FROM|UPDATE(?:\s+OR\s+\w+)?)\s+["`]?(\w+)/i.exec(
      query,
    );
  return m?.[1]?.toLowerCase() ?? null;
}

/** The search index: the FTS5 table and its rowid map (schema.ts). */
export const FTS_TABLES: ReadonlySet<string> = new Set(["fts", "fts_rows"]);
/** Read counts flushed from memory (TEMPRA-87, TEMPRA-220). */
export const READ_FLUSH_TABLES: ReadonlySet<string> = new Set(["access_log", "last_read"]);

/** Rows a cost wrote to the given tables. */
export const rowsTo = (cost: RowCost, tables: ReadonlySet<string>) =>
  Object.entries(cost.tables).reduce((n, [t, rows]) => n + (tables.has(t) ? rows : 0), 0);

/** Two costs added up. */
export function addCost(a: RowCost, b: RowCost): RowCost {
  const tables = { ...a.tables };
  for (const [t, n] of Object.entries(b.tables)) tables[t] = (tables[t] ?? 0) + n;
  return { rowsRead: a.rowsRead + b.rowsRead, rowsWritten: a.rowsWritten + b.rowsWritten, tables };
}

/**
 * Sums each statement's rows as it runs (TEMPRA-228). The store is synchronous, so a cost taken
 * from `mark()` to `since()` around a call's synchronous part is that call's alone, whatever
 * other calls the object interleaves across its awaits.
 */
export class RowTally {
  private total: RowCost = { rowsRead: 0, rowsWritten: 0, tables: {} };

  add(query: string, rowsRead: number, rowsWritten: number) {
    this.total.rowsRead += rowsRead;
    this.total.rowsWritten += rowsWritten;
    if (rowsWritten > 0) {
      const t = writtenTable(query) ?? "other";
      this.total.tables[t] = (this.total.tables[t] ?? 0) + rowsWritten;
    }
  }

  /** Where the tally stands now. */
  mark(): RowCost {
    return { ...this.total, tables: { ...this.total.tables } };
  }

  /** What was counted after `mark`. */
  since(mark: RowCost): RowCost {
    const tables: Record<string, number> = {};
    for (const [t, n] of Object.entries(this.total.tables)) {
      const d = n - (mark.tables[t] ?? 0);
      if (d > 0) tables[t] = d;
    }
    return {
      rowsRead: this.total.rowsRead - mark.rowsRead,
      rowsWritten: this.total.rowsWritten - mark.rowsWritten,
      tables,
    };
  }

  /** Runs `fn` and returns what its statements cost beside its result. */
  measure<T>(fn: () => T): { value: T; cost: RowCost } {
    const m = this.mark();
    const value = fn();
    return { value, cost: this.since(m) };
  }
}

/**
 * Adapts a Durable Object's `ctx.storage` to SqlHandle; with `tally`, each statement's rows are
 * counted into it (TEMPRA-228).
 */
export function doSqlHandle(storage: DurableObjectStorage, tally?: RowTally): SqlHandle {
  const sql = storage.sql;
  const exec = (query: string, params: SqlValue[]) => {
    const cursor = sql.exec(query, ...params);
    const rows = cursor.toArray();
    tally?.add(query, cursor.rowsRead, cursor.rowsWritten);
    return rows;
  };
  return {
    all: <T>(query: string, ...params: SqlValue[]) => exec(query, params) as unknown as T[],
    run: (query, ...params) => {
      exec(query, params);
    },
    script: (s) => {
      sql.exec(s);
    },
    transaction: (fn) => storage.transactionSync(fn),
  };
}
