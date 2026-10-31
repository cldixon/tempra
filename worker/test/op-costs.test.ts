import { describe, expect, test } from "bun:test";
import { costHeader, mcpOp, opName, recordCost, withCosts } from "../src/op-costs";
import { addCost, RowTally, writtenTable } from "../src/store/sql";
import { LibraryStore } from "../src/store/store";
import { bunSqlHandle } from "./sqlite";

describe("operation costs (TEMPRA-228)", () => {
  test("a write statement's table", () => {
    expect(writtenTable("INSERT INTO fts (a) VALUES (?)")).toBe("fts");
    expect(writtenTable("  insert or replace into fts_rows (a) values (1)")).toBe("fts_rows");
    expect(writtenTable("DELETE FROM fts WHERE rowid = 1")).toBe("fts");
    expect(writtenTable("UPDATE paths SET x = 1")).toBe("paths");
    expect(writtenTable("REPLACE INTO meta VALUES (1)")).toBe("meta");
    expect(writtenTable("SELECT * FROM fts")).toBeNull();
  });

  test("a tally counts what happened after its mark, by table", () => {
    const t = new RowTally();
    t.add("INSERT INTO events (x) VALUES (1)", 1, 3);
    const m = t.mark();
    t.add("SELECT 1", 5, 0);
    t.add("INSERT INTO fts (x) VALUES (1)", 0, 2);
    t.add("INSERT INTO events (x) VALUES (1)", 0, 1);
    expect(t.since(m)).toEqual({ rowsRead: 5, rowsWritten: 3, tables: { fts: 2, events: 1 } });
    expect(addCost(t.since(m), t.since(m)).tables).toEqual({ fts: 4, events: 2 });
  });

  test("an apply is named by what it applies", () => {
    expect(opName("apply", [{}, [{ op: "write" }]])).toBe("write");
    expect(opName("apply", [{}, [{ op: "edit" }, { op: "write" }]])).toBe("batch");
    expect(opName("comment", [])).toBe("comment");
    expect(mcpOp({ method: "tools/call", params: { name: "read" } })).toBe("mcp:read");
    expect(mcpOp([{ method: "initialize" }])).toBe("mcp:initialize");
  });

  test("a request's scope sums the DO calls made inside it, and only those", async () => {
    const rows = { rowsRead: 2, rowsWritten: 4, tables: { fts: 1, access_log: 1, paths: 2 } };
    recordCost("read", [], rows, 1); // outside any scope: dropped
    const { cost } = await withCosts(async () => {
      recordCost("apply", [{}, [{ op: "write" }]], rows, 5);
      await Promise.resolve();
      recordCost("read", [], rows, 3);
    });
    expect(cost).toMatchObject({
      calls: 2,
      rowsRead: 4,
      rowsWritten: 8,
      ftsRowsWritten: 2,
      readFlushRowsWritten: 2,
      ms: 8,
    });
    expect(JSON.parse(costHeader(cost)).ops.map((o: { op: string }) => o.op)).toEqual([
      "write",
      "read",
    ]);
  });

  test("the store's writes are counted through the SQL handle", () => {
    const rows = new RowTally();
    const store = new LibraryStore(bunSqlHandle(undefined, rows));
    const { cost } = rows.measure(() =>
      store.apply({ request_id: "r1", actor: "a/b", note: null }, [
        { op: "write", path: "a.md", content: "---\ntype: Note\n---\nSome words.\n" },
      ]),
    );
    expect(cost.rowsWritten).toBeGreaterThan(0);
    expect(cost.tables.fts).toBeGreaterThan(0);
    expect(cost.tables.fts_rows).toBe(1);
    expect(cost.tables.events).toBeGreaterThan(0);
  });
});
