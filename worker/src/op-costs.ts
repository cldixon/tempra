import { AsyncLocalStorage } from "node:async_hooks";
import { FTS_TABLES, READ_FLUSH_TABLES, type RowCost, rowsTo } from "./store/sql";
import type { WriteOp } from "./store/store";

/**
 * What each operation costs (TEMPRA-228, tempra-dev v2/operation-costs; the price table and cost report are costs.ts): the rows each Library DO
 * call read and wrote (the Durable Object's own counts, `RowTally`) and its round trip from the
 * Worker, summed over one MCP tool call or REST request and metered under the tool's or route's
 * name. Free of Worker APIs.
 */

/** One Library DO call's cost, as the Worker saw it. */
export interface OpCost {
  /** The store method, or an `apply`'s kind: its one op (`write`, `edit`, …) or `batch`. */
  op: string;
  rowsRead: number;
  rowsWritten: number;
  /** Rows written to the search index (`fts`, `fts_rows`). */
  ftsRowsWritten: number;
  /** Rows written flushing read counts held in memory (`access_log`, `last_read`). */
  readFlushRowsWritten: number;
  /** Rows written by table. */
  tables: Record<string, number>;
  /** The round trip to the object, in ms. */
  ms: number;
}

/** A request's costs: every DO call it made, in order. */
export interface RequestCost {
  calls: number;
  rowsRead: number;
  rowsWritten: number;
  ftsRowsWritten: number;
  readFlushRowsWritten: number;
  /** Time spent waiting on the library's object, summed over its calls. */
  ms: number;
  ops: OpCost[];
}

/** A Library DO call's operation name: an `apply` by what it applies. */
export function opName(method: string, args: unknown[]): string {
  if (method !== "apply") return method;
  const ops = (args[1] ?? []) as Pick<WriteOp, "op">[];
  return ops.length === 1 && ops[0] ? ops[0].op : "batch";
}

/** One DO call's cost from its rows and round trip. */
export function opCost(op: string, rows: RowCost, ms: number): OpCost {
  return {
    op,
    rowsRead: rows.rowsRead,
    rowsWritten: rows.rowsWritten,
    ftsRowsWritten: rowsTo(rows, FTS_TABLES),
    readFlushRowsWritten: rowsTo(rows, READ_FLUSH_TABLES),
    tables: rows.tables,
    ms,
  };
}

/** Collects the DO calls a request makes. */
export class CostScope {
  readonly ops: OpCost[] = [];

  add(op: OpCost) {
    this.ops.push(op);
  }

  total(): RequestCost {
    const sum = (
      k: "rowsRead" | "rowsWritten" | "ftsRowsWritten" | "readFlushRowsWritten" | "ms",
    ) => this.ops.reduce((n, o) => n + o[k], 0);
    return {
      calls: this.ops.length,
      rowsRead: sum("rowsRead"),
      rowsWritten: sum("rowsWritten"),
      ftsRowsWritten: sum("ftsRowsWritten"),
      readFlushRowsWritten: sum("readFlushRowsWritten"),
      ms: sum("ms"),
      ops: this.ops,
    };
  }
}

const scopes = new AsyncLocalStorage<CostScope>();

/** Runs `fn` with a fresh scope; the DO calls made inside it are added to it. */
export async function withCosts<T>(fn: () => Promise<T>): Promise<{ value: T; cost: RequestCost }> {
  const scope = new CostScope();
  const value = await scopes.run(scope, fn);
  return { value, cost: scope.total() };
}

/** Adds a DO call's cost to the request making it, if it is measured. */
export function recordCost(method: string, args: unknown[], rows: RowCost | undefined, ms: number) {
  if (!rows) return;
  scopes.getStore()?.add(opCost(opName(method, args), rows, ms));
}

/**
 * The header a caller sends to have a request's cost returned (`bun run agents`), and the one the
 * answer carries it in, as JSON: the caller's own library, so nothing it may not see.
 */
export const COST_HEADER = "X-Tempra-Cost";

/** The cost header's value: the totals and each call, keys in snake case. */
export function costHeader(c: RequestCost): string {
  return JSON.stringify({
    calls: c.calls,
    rows_read: c.rowsRead,
    rows_written: c.rowsWritten,
    fts_rows_written: c.ftsRowsWritten,
    read_flush_rows_written: c.readFlushRowsWritten,
    ms: c.ms,
    ops: c.ops.map((o) => ({
      op: o.op,
      rows_read: o.rowsRead,
      rows_written: o.rowsWritten,
      fts_rows_written: o.ftsRowsWritten,
      read_flush_rows_written: o.readFlushRowsWritten,
      tables: o.tables,
      ms: o.ms,
    })),
  });
}

/** A response with the cost header added, when the request asked for it. */
export function withCostHeader(req: Request, res: Response, c: RequestCost): Response {
  if (req.headers.get(COST_HEADER) !== "1") return res;
  const out = new Response(res.body, res);
  out.headers.set(COST_HEADER, costHeader(c));
  return out;
}

/** The tool an MCP request calls (a batch's first), or the method of one that calls none. */
export function mcpOp(body: unknown): string {
  const msgs = Array.isArray(body) ? body : [body];
  const call = msgs.find((m) => (m as { method?: string })?.method === "tools/call") as
    | { params?: { name?: unknown } }
    | undefined;
  if (call) return `mcp:${String(call.params?.name ?? "")}`;
  const first = msgs[0] as { method?: unknown } | undefined;
  return `mcp:${String(first?.method ?? "")}`;
}
