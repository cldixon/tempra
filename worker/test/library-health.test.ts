import { describe, expect, test } from "bun:test";
import { d1Accounts } from "../src/accounts";
import {
  DIGEST_HEALTH_LIBRARIES,
  DIGEST_LIBRARIES,
  DIGEST_QUERIES,
  ensureHealthRow,
  type HealthCounts,
  type HealthInput,
  healthDigest,
  healthRow,
  libraryProblems,
  openWork,
  reportHealth,
  writeHealth,
} from "../src/library-health";
import { runMaintenance } from "../src/maintain";
import { LibraryStore } from "../src/store/store";
import { bunD1 } from "./d1";
import { memoryBucket } from "./harness";
import { bunSqlHandle } from "./sqlite";

const DAY = 86_400_000;
const MB = 1048576;
const NOW = new Date("2026-10-31T04:30:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

const counts = (over: Partial<HealthCounts> = {}): HealthCounts => ({
  stale: 0,
  stale_soon: 0,
  broken_link: 0,
  lint: 0,
  structure: 0,
  comment: 0,
  ...over,
});

const input = (over: Partial<HealthInput> = {}): HealthInput => ({
  export: { lag: 0, last_run: ago(0.5) },
  bytes: MB,
  limitBytes: 100 * MB,
  counts: counts(),
  nextRun: ago(-1),
  now: NOW,
  ...over,
});

/** An account D1 with one owner and these libraries (id = do_id = slug). */
function world(ids: string[] = []) {
  const { d1, db } = bunD1();
  db.run(
    "INSERT INTO users (id, email, actor, handle, created) VALUES ('u', 'u@x', 'human:o', 'o', '')",
  );
  const add = (id: string) =>
    db.run(
      "INSERT INTO libraries (id, slug, owner, visibility, created, do_id) VALUES (?, ?, 'u', 'private', '', ?)",
      [id, id, id],
    );
  for (const id of ids) add(id);
  const row = (id: string) =>
    db.query("SELECT * FROM library_health WHERE library = ?").get(id) as {
      problems: string | null;
      open_work: number;
      counts: string | null;
      next_run: string | null;
      checked_at: string;
    } | null;
  return { d1, db, add, row };
}

describe("a library's problems (TEMPRA-92)", () => {
  test("a healthy library has none", () => {
    expect(libraryProblems(input())).toEqual([]);
    expect(healthRow(input())).toEqual({ problems: null, open: 0, counts: null, nextRun: ago(-1) });
  });

  test("an export over two days behind, storage over 80%, a failed pass", () => {
    expect(
      libraryProblems(
        input({
          export: { lag: 4, last_run: "2026-10-25T03:00:00Z" },
          bytes: 90 * MB,
          failure: "R2 unavailable",
        }),
      ),
    ).toEqual([
      "maintenance failed: R2 unavailable",
      "last export 2026-10-25T03:00:00Z, 4 events behind",
      "90 MB of 100 MB",
    ]);
    // Behind, but exported within two days: not yet a problem.
    expect(libraryProblems(input({ export: { lag: 4, last_run: ago(1) } }))).toEqual([]);
  });

  test("open work comes from the health summary; stale soon is not counted", () => {
    const c = counts({ lint: 2, structure: 3, stale_soon: 5 });
    expect(healthRow(input({ counts: c }))).toMatchObject({ open: 5, counts: c });
    expect(healthRow(input({ counts: counts({ stale_soon: 5 }) }))).toMatchObject({
      open: 0,
      counts: null,
    });
  });
});

describe("health rows in D1 (TEMPRA-92)", () => {
  test("written when something is wrong, cleared when it is fixed", async () => {
    const w = world(["a"]);
    const full = healthRow(input({ bytes: 95 * MB, counts: counts({ lint: 1 }) }));
    await writeHealth(w.d1, "a", full, NOW, 95 * MB);
    expect(w.row("a")).toMatchObject({
      problems: JSON.stringify(["95 MB of 100 MB"]),
      open_work: 1,
      checked_at: NOW.toISOString(),
    });
    expect(JSON.parse(w.row("a")?.counts ?? "null")).toMatchObject({ lint: 1 });
    expect(w.db.query("SELECT storage_bytes FROM libraries WHERE id = 'a'").get()).toEqual({
      storage_bytes: 95 * MB,
    });

    // Fixed: the problems and the open work go; the row stays, for its next pass.
    const later = new Date(NOW.getTime() + DAY);
    await writeHealth(w.d1, "a", healthRow(input()), later, MB);
    expect(w.row("a")).toMatchObject({
      problems: null,
      open_work: 0,
      counts: null,
      checked_at: later.toISOString(),
    });
  });

  test("an unchanged report writes nothing", async () => {
    const w = world(["a"]);
    const row = healthRow(input({ counts: counts({ comment: 2 }) }));
    await writeHealth(w.d1, "a", row, NOW, MB);
    const changes = () => (w.db.query("SELECT total_changes() AS n").get() as { n: number }).n;
    const before = changes();
    await writeHealth(w.d1, "a", row, new Date(NOW.getTime() + DAY), MB);
    expect(changes()).toBe(before);
    expect(w.row("a")?.checked_at).toBe(NOW.toISOString());
    // The next pass moving is a change: the row says when the library is next due.
    await writeHealth(w.d1, "a", { ...row, nextRun: ago(-2) }, new Date(NOW.getTime() + DAY), MB);
    expect(w.row("a")?.next_run).toBe(ago(-2));
  });

  test("a first use makes a row with only the next pass, and never overwrites one", async () => {
    const w = world(["a"]);
    await ensureHealthRow(w.d1, "a", ago(-1), NOW);
    expect(w.row("a")).toMatchObject({ problems: null, open_work: 0, next_run: ago(-1) });
    await writeHealth(w.d1, "a", healthRow(input({ bytes: 99 * MB })), NOW);
    await ensureHealthRow(w.d1, "a", ago(-3), NOW);
    expect(w.row("a")).toMatchObject({ next_run: ago(-1) });
    expect(w.row("a")?.problems).toContain("99 MB of 100 MB");
  });

  test("a pass reports from the library's own state", async () => {
    const w = world(["lib"]);
    const store = new LibraryStore(bunSqlHandle(), { now: () => NOW });
    store.apply({ actor: "claude-code/test", request_id: "r" }, [
      { op: "write", path: "a.md", content: "---\ntype: Note\n---\nSee [x](/missing.md).\n" },
    ]);
    await runMaintenance({ store, bucket: memoryBucket(), libraryId: "lib", now: NOW });
    store.setMaintenance({ next_run: ago(-1) });
    const row = await reportHealth(w.d1, "lib", store, { limitBytes: 100 * MB, now: NOW });
    expect(row.problems).toBeNull();
    expect(row.open).toBe(openWork(store.health().counts));
    expect(row.open).toBeGreaterThan(0);
    expect(w.row("lib")).toMatchObject({ open_work: row.open, next_run: ago(-1) });

    // A pass that failed says so.
    await reportHealth(w.d1, "lib", store, { limitBytes: 100 * MB, failure: "boom", now: NOW });
    expect(w.row("lib")?.problems).toBe(JSON.stringify(["maintenance failed: boom"]));
  });

  test("deleting a library deletes its row", async () => {
    const w = world(["a", "b"]);
    await ensureHealthRow(w.d1, "a", ago(-1), NOW);
    await ensureHealthRow(w.d1, "b", ago(-1), NOW);
    await d1Accounts(w.d1).deleteLibrary("a");
    expect(w.row("a")).toBeNull();
    expect(w.row("b")).not.toBeNull();
  });
});

describe("the digest reads the health rows (TEMPRA-92)", () => {
  test("problems, overdue passes and open work, by path", async () => {
    const w = world(["ok", "full", "late", "busy", "quiet"]);
    await writeHealth(w.d1, "ok", healthRow(input()), NOW);
    await writeHealth(w.d1, "full", healthRow(input({ bytes: 90 * MB })), NOW);
    // Its alarm stopped: the next pass was due two days ago. Due within the day is not late.
    await writeHealth(w.d1, "late", healthRow(input({ nextRun: ago(2) })), NOW);
    await writeHealth(w.d1, "quiet", healthRow(input({ nextRun: ago(0.5) })), NOW);
    await writeHealth(
      w.d1,
      "busy",
      healthRow(input({ counts: counts({ lint: 2, structure: 3 }) })),
      NOW,
    );
    // A row whose library is gone is not reported.
    await writeHealth(w.d1, "gone", healthRow(input({ bytes: 99 * MB })), NOW);

    const d = await healthDigest(w.d1, NOW);
    expect(d.libraries).toBe(5);
    expect(d.attention).toEqual([
      "o/full: 90 MB of 100 MB",
      `o/late: daily maintenance overdue since ${ago(2)}`,
    ]);
    expect(d.health).toEqual([
      {
        path: "o/busy",
        counts: { ...counts({ lint: 2, structure: 3 }), request: 0, external_image: 0 },
      },
    ]);
    expect(d.healthTotal).toBe(1);
  });

  test("its lists are bounded; the rest are counted", async () => {
    const n = DIGEST_LIBRARIES + 5;
    const ids = Array.from({ length: n }, (_, i) => `l${String(i).padStart(3, "0")}`);
    const w = world(ids);
    for (const [i, id] of ids.entries()) {
      const row = healthRow(
        input({ bytes: 90 * MB, nextRun: ago(3), counts: counts({ lint: i + 1 }) }),
      );
      await writeHealth(w.d1, id, row, NOW);
    }
    const d = await healthDigest(w.d1, NOW);
    expect(d.attention.filter((a) => a.endsWith("90 MB of 100 MB"))).toHaveLength(DIGEST_LIBRARIES);
    expect(d.attention).toContain("and 5 more libraries with problems");
    expect(d.attention).toContain("and 5 more libraries with maintenance overdue");
    expect(d.health).toHaveLength(DIGEST_HEALTH_LIBRARIES);
    expect(d.health[0]?.path).toBe(`o/${ids.at(-1)}`);
    expect(d.healthTotal).toBe(n);
  });

  test("costs the same however many libraries there are", async () => {
    const statements = async (libraries: number) => {
      const ids = Array.from({ length: libraries }, (_, i) => `l${i}`);
      const w = world(ids);
      for (const id of ids) {
        await writeHealth(w.d1, id, healthRow(input({ counts: counts({ lint: 1 }) })), NOW);
      }
      let n = 0;
      const counting = new Proxy(w.d1, {
        get(target, key) {
          if (key === "prepare") {
            return (sql: string) => {
              n++;
              return target.prepare(sql);
            };
          }
          return Reflect.get(target, key);
        },
      });
      await healthDigest(counting, NOW);
      return n;
    };
    expect(await statements(300)).toBe(await statements(30));
  });

  test("its queries use their indexes", () => {
    const { db } = bunD1();
    const plan = (sql: string) =>
      (db.query(`EXPLAIN QUERY PLAN ${sql}`).all() as { detail: string }[]).map((r) => r.detail);
    const scans = (lines: string[]) =>
      lines.filter((l) => /^SCAN /.test(l) && !/USING|CONSTANT|\(subquery/.test(l));
    const { libraries: _all, ...bounded } = DIGEST_QUERIES;
    for (const sql of Object.values(bounded)) expect(scans(plan(sql))).toEqual([]);
    expect(plan(DIGEST_QUERIES.overdue).join()).toContain("library_health_next_run");
    expect(plan(DIGEST_QUERIES.problems).join()).toContain("library_health_problems");
    expect(plan(DIGEST_QUERIES.open).join()).toContain("library_health_open");
    // Sorted by the index, not afterwards.
    expect(plan(DIGEST_QUERIES.open).join()).not.toContain("TEMP B-TREE");
  });
});
