import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { type LogRequest, renderLog } from "../src/okf/derived";
import { normalizeDir, underPrefix } from "../src/okf/paths";
import type { SqlHandle } from "../src/store/sql";
import { type EventRow, LibraryStore, type RequestContext } from "../src/store/store";
import { changes, library, md } from "./changes";
import { bunSqlHandle } from "./sqlite";

/**
 * TEMPRA-86: summary, health, stats, contributors and log.md read kept counts and narrower
 * queries instead of the whole ledger. Each is checked here against the long way round.
 */

describe("summary and health without the whole ledger (TEMPRA-86)", () => {
  test("they count what work() lists, after every kind of change", () => {
    const lib = library();
    for (const step of changes(lib)) {
      for (const store of [lib.store, lib.fresh()]) {
        const s = store.summary();
        const work = store.work({ limit: 500 });
        expect({ step, open: s.open_work }).toEqual({ step, open: work.total });
        expect({ step, soon: s.stale_soon }).toEqual({
          step,
          soon: store.work({ kind: "stale_soon" }).total,
        });
        // Types and counts, as a walk over every file reads them.
        const files = store.outline().files;
        const types: Record<string, number> = {};
        for (const f of files.filter((f) => f.kind === "concept")) {
          const v = store.read(f.path);
          const t = v.kind === "concept" ? String(v.frontmatter.type ?? "") || "(no type)" : "";
          types[t] = (types[t] ?? 0) + 1;
        }
        expect({ step, types: s.types }).toEqual({ step, types });
        expect(Object.keys(s.types)).toEqual(Object.keys(types));
        expect(s.concepts).toBe(files.filter((f) => f.kind === "concept").length);
        expect(s.open_comments).toBe(work.counts.comment ?? 0);
        // The health process's counts, worked out now.
        const h = store.maintainHealth();
        expect({ step, counts: h.counts }).toEqual({
          step,
          counts: {
            stale: work.counts.stale ?? 0,
            stale_soon: store.work({ kind: "stale_soon" }).total,
            broken_link: work.counts.broken_link ?? 0,
            lint: work.counts.lint ?? 0,
            structure: work.counts.structure ?? 0,
            comment: work.counts.comment ?? 0,
          },
        });
      }
    }
  });

  test("missing-heading lint kept across writes is what a fresh look finds", () => {
    const lib = library();
    let checked = 0;
    for (const step of changes(lib)) {
      // Warm the kept lint, then compare after the next change with a store that keeps nothing.
      const mine = lib.store.work({ kind: "lint", limit: 500 });
      const theirs = lib.fresh().work({ kind: "lint", limit: 500 });
      expect({ step, items: mine.items }).toEqual({ step, items: theirs.items });
      if (mine.total > 0) checked++;
    }
    expect(checked).toBeGreaterThan(5);
  });
});

describe("start, the library home and the list read no more of the ledger than its head", () => {
  test("summary, health, stats and contributors look events up by seq only", () => {
    const db = new Database(":memory:");
    const inner = bunSqlHandle(db);
    const sent: string[] = [];
    const sql: SqlHandle = {
      all: (q, ...p) => {
        sent.push(q.replace(/\s+/g, " "));
        return inner.all(q, ...p);
      },
      run: (q, ...p) => inner.run(q, ...p),
      script: (q) => inner.script(q),
      transaction: (fn) => inner.transaction(fn),
    };
    const store = new LibraryStore(sql, { now: () => new Date("2026-10-01T00:00:00Z") });
    const hashes = new Map<string, string>();
    for (let i = 0; i < 20; i++) {
      const path = `c${i % 4}.md`;
      const res = store.apply({ actor: "a/b", request_id: `r${i}`, by: { person: "p" } }, [
        { op: "write", path, content: md(`T ${i}`, `Body ${i}.\n`), if_match: hashes.get(path) },
      ]);
      hashes.set(path, res.results[0]?.hash as string);
    }
    let seen = 0;
    for (const read of [
      () => store.summary(),
      () => store.health(),
      () => store.maintainHealth(),
      () => store.stats(),
      () => store.contributors(),
    ]) {
      sent.length = 0;
      read();
      const ledger = sent.filter((q) => /\b(FROM|JOIN) events\b/.test(q));
      // The head (the primary key's last row) or one event by its seq; never a scan.
      for (const q of ledger) {
        expect(q).toMatch(/MAX\(seq\)|e\.seq = |WHERE seq = \?/);
      }
      seen += ledger.length;
    }
    expect(seen).toBeGreaterThan(5);
  });
});

describe("ledger counts kept by triggers (TEMPRA-86)", () => {
  const counted = (db: Database): Record<string, unknown> => ({
    events: (db.query("SELECT COUNT(*) AS n FROM events").get() as { n: number }).n,
    requests: (
      db.query("SELECT COUNT(DISTINCT request_id) AS n FROM events").get() as { n: number }
    ).n,
    contributors: db
      .query(
        `SELECT json_extract(meta, '$.by.person') AS person, json_extract(meta, '$.by.agent') AS agent,
                COUNT(DISTINCT request_id) AS requests, MIN(seq) AS first_seq, MAX(seq) AS last_seq
         FROM events WHERE meta IS NOT NULL AND json_extract(meta, '$.by.person') IS NOT NULL
         GROUP BY person, agent ORDER BY last_seq DESC LIMIT 500`,
      )
      .all(),
  });
  const kept = (store: LibraryStore): Record<string, unknown> => {
    const stats = store.stats();
    return {
      events: stats.events,
      requests: stats.requests,
      contributors: store.contributors().map(({ actor: _a, last_ts: _t, ...r }) => r),
    };
  };

  test("stats and contributors equal the counts over the ledger, after every change", () => {
    const lib = library();
    for (const step of changes(lib)) {
      expect({ step, ...kept(lib.store) }).toEqual({ step, ...counted(lib.db) });
    }
    // A request id seen again in a later transaction is still one request.
    const again: RequestContext = {
      actor: "x/y",
      request_id: "req-1",
      by: { person: "u-ann", agent: "claude.ai" },
    };
    lib.store.apply(again, [{ op: "write", path: "z.md", content: md("T z", "z\n") }]);
    expect(kept(lib.store)).toEqual(counted(lib.db));
    expect(lib.store.contributors()[0]).toMatchObject({ person: "u-ann", agent: "claude.ai" });
  });

  test("a library from before the counts gets them once, filled from its ledger", () => {
    const lib = library();
    for (const _ of changes(lib)) {
      // Every change, so the ledger has every kind of event.
    }
    // As stored before TEMPRA-86: no tables, no triggers, no marker.
    lib.db.run("DROP TRIGGER events_counted");
    lib.db.run("DROP TABLE ledger_counts");
    lib.db.run("DROP TABLE contributors");
    lib.db.run("DELETE FROM meta WHERE key = 'ledger_counts'");
    const before = counted(lib.db);
    const reopened = lib.fresh();
    expect(kept(reopened)).toEqual(before);
    // And counts from then on.
    reopened.apply(lib.ctx({ person: "u-cat" }), [
      { op: "write", path: "y.md", content: md("T y", "y\n") },
    ]);
    expect(kept(reopened)).toEqual(counted(lib.db));
    expect(kept(reopened).events).toBe((before.events as number) + 1);
  });
});

describe("log.md (TEMPRA-86)", () => {
  /** log.md the way it was built before: every event read and grouped in memory. */
  function oldLog(store: LibraryStore, at: number, prefixIn = ""): string {
    const prefix = normalizeDir(prefixIn);
    const all: EventRow[] = [];
    for (let since = 0; ; ) {
      const page = store.events({ since, limit: 1000 });
      all.push(...page.events);
      if (page.next === null) break;
      since = page.next;
    }
    const byReq = new Map<string, EventRow[]>();
    for (const e of all.filter((e) => e.seq <= at).reverse()) {
      if (e.op === "comment" || !underPrefix(e.path, prefix)) continue;
      byReq.set(e.request_id, [...(byReq.get(e.request_id) ?? []), e]);
    }
    // Where each concept is as of `at`: its last content event, unless that removed it.
    const last = new Map<string, EventRow>();
    for (const e of all) if (e.seq <= at && e.op !== "comment") last.set(e.concept_id, e);
    const now = new Map([...last].map(([id, e]) => [id, e.hash === null ? null : e.path]));
    const out: LogRequest[] = [...byReq.values()].map((evs) => {
      evs.reverse();
      const first = evs[0] as EventRow;
      return {
        ts: first.ts,
        actor: first.actor,
        note: (first.meta?.note as string | undefined) ?? null,
        events: evs.map((e) => ({
          op: e.op,
          path: e.path,
          created: e.prev_hash === null,
          fromPath: typeof e.meta?.from_path === "string" ? e.meta.from_path : null,
          current: now.get(e.concept_id) ?? null,
        })),
      };
    });
    return renderLog(out, prefix ? `Log: ${prefix}` : "Library log");
  }

  test("reads the same as before: whole library, a directory, an earlier seq", () => {
    const lib = library();
    const seqs: number[] = [];
    for (const _ of changes(lib)) seqs.push(lib.store.headSeq());
    for (const at of seqs) {
      for (const prefix of ["", "a", "b", "d"]) {
        expect({ at, prefix, log: lib.store.log({ at, prefix }) }).toEqual({
          at,
          prefix,
          log: oldLog(lib.store, at, prefix),
        });
      }
    }
    expect(lib.store.log()).toContain("Move");
  });
});
