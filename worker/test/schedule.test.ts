import { describe, expect, test } from "bun:test";
import {
  DEFAULT_RETENTION_DAYS,
  dailySlot,
  listExports,
  MAX_SLEEP_DAYS,
  MaintenanceSchedule,
  nextMaintenance,
  nextRun,
  runMaintenance,
  slotAtOrAfter,
} from "../src/maintain";
import { LibraryStore, type MaintenanceDue } from "../src/store/store";
import { memoryBlobs, memoryBucket } from "./harness";
import { bunSqlHandle } from "./sqlite";

const DAY = 86_400_000;
const md = (body: string, extra = "") => `---\ntype: Note\n${extra}---\n${body}`;
const iso = (t: number) => new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z");

/**
 * One library as its Durable Object runs it, on an injected clock: the alarm is a number, and
 * `until` moves time forward, running a pass whenever the alarm falls due (TEMPRA-82).
 */
async function library(id: string, start: string) {
  const clock = { t: Date.parse(start) };
  const store = new LibraryStore(bunSqlHandle(), { now: () => new Date(clock.t) });
  const bucket = memoryBucket();
  const blobs = memoryBlobs();
  const alarm = { at: null as number | null };
  const schedule = new MaintenanceSchedule(
    {
      getAlarm: async () => alarm.at,
      setAlarm: async (at) => {
        alarm.at = at.getTime();
      },
    },
    store,
    () => id,
    () => new Date(clock.t),
  );
  const passes: number[] = [];
  const exports: number[] = [];
  const hashes = new Map<string, string>();
  await schedule.ensure();
  return {
    clock,
    store,
    bucket,
    alarm,
    schedule,
    passes,
    exports,
    async until(t: number) {
      while (alarm.at !== null && alarm.at <= t) {
        clock.t = alarm.at;
        alarm.at = null;
        const r = await runMaintenance({
          store,
          blobs,
          bucket,
          libraryId: id,
          now: new Date(clock.t),
        });
        passes.push(clock.t);
        if ("key" in r.export) exports.push(clock.t);
        await schedule.afterPass();
      }
      clock.t = t;
    },
    async write(path: string, body: string, extra = "") {
      const before = store.headSeq();
      const res = store.apply({ actor: "claude-code/test", request_id: crypto.randomUUID() }, [
        { op: "write", path, content: md(body, extra), if_match: hashes.get(path) },
      ]);
      hashes.set(path, res.results[0]?.hash as string);
      if (store.headSeq() > before) await schedule.wake();
    },
  };
}

describe("maintenance schedule (TEMPRA-82)", () => {
  test("slots spread evenly over the 24 hours of the day", () => {
    const perHour = new Array(24).fill(0);
    for (let i = 0; i < 24_000; i++) {
      const slot = dailySlot(crypto.randomUUID());
      expect(slot).toBeGreaterThanOrEqual(0);
      expect(slot).toBeLessThan(DAY);
      expect(slot % 1000).toBe(0);
      perHour[Math.floor(slot / 3_600_000)]++;
    }
    // 1,000 an hour on average; every hour within 15% of it.
    for (const n of perHour) {
      expect(n).toBeGreaterThan(850);
      expect(n).toBeLessThan(1150);
    }
    // The old schedule put every library in one hour.
    const old = new Set(
      Array.from({ length: 100 }, (_, i) =>
        nextRun(new Date("2026-10-01T05:00:00Z"), `lib-${i}`).getUTCHours(),
      ),
    );
    expect([...old]).toEqual([3]);
  });

  test("a slot is the library's time of day, at or after the moment asked", () => {
    const slot = dailySlot("lib-a");
    const midnight = Date.parse("2026-10-01T00:00:00Z");
    expect(slotAtOrAfter(midnight, "lib-a").getTime()).toBe(midnight + slot);
    expect(slotAtOrAfter(midnight + slot, "lib-a").getTime()).toBe(midnight + slot);
    expect(slotAtOrAfter(midnight + slot + 1, "lib-a").getTime()).toBe(midnight + DAY + slot);
  });

  test("the next pass is the first slot with work, at most a week away", () => {
    const now = new Date("2026-10-01T12:00:00Z");
    const slot = (t: number) => slotAtOrAfter(t, "lib-a").getTime();
    const none: MaintenanceDue = {
      exportPending: false,
      exportExpiry: null,
      staleAt: null,
      usageExpiry: null,
    };
    const at = (due: Partial<MaintenanceDue>) =>
      nextMaintenance(now, "lib-a", { ...none, ...due }).getTime();
    // Idle: the heartbeat.
    expect(at({})).toBe(slot(now.getTime() + MAX_SLEEP_DAYS * DAY));
    // An export waiting: the next slot, within a day.
    expect(at({ exportPending: true })).toBe(slot(now.getTime() + 1));
    expect(at({ exportPending: true }) - now.getTime()).toBeLessThanOrEqual(DAY);
    // Something due in three days: that day's slot, or the next.
    const three = now.getTime() + 3 * DAY;
    expect(at({ staleAt: three })).toBe(slot(three));
    expect(at({ exportExpiry: three, usageExpiry: three + DAY })).toBe(slot(three));
    // Overdue: the next slot.
    expect(at({ usageExpiry: now.getTime() - DAY })).toBe(slot(now.getTime() + 1));
    // Further than the heartbeat: the heartbeat.
    expect(at({ staleAt: now.getTime() + 30 * DAY })).toBe(at({}));
  });

  test("first use sets the next slot; an alarm already set is kept", async () => {
    const lib = await library("lib-a", "2026-10-01T12:00:00Z");
    expect(lib.alarm.at).toBe(slotAtOrAfter(lib.clock.t + 1, "lib-a").getTime());
    expect(lib.store.stats().next_run).toBe(iso(lib.alarm.at as number));
    const set = lib.clock.t + 3 * DAY;
    lib.alarm.at = set;
    await lib.schedule.ensure();
    expect(lib.alarm.at).toBe(set);
  });

  test("a write moves a later alarm to the next slot, never an earlier one later", async () => {
    const lib = await library("lib-a", "2026-10-01T12:00:00Z");
    const next = slotAtOrAfter(lib.clock.t + 1, "lib-a").getTime();
    lib.alarm.at = lib.clock.t + 5 * DAY;
    await lib.schedule.ensure();
    await lib.write("a.md", "A\n");
    expect(lib.alarm.at).toBe(next);
    lib.alarm.at = lib.clock.t + 60_000;
    await lib.schedule.ensure();
    await lib.write("a.md", "A again\n");
    expect(lib.alarm.at).toBe(lib.clock.t + 60_000);
  });

  test("an idle library is not woken daily; a write later is exported within a day", async () => {
    const start = Date.parse("2026-10-01T12:00:00Z");
    const lib = await library("lib-idle", "2026-10-01T12:00:00Z");
    await lib.write("a.md", "A\n");
    await lib.until(start + 60 * DAY);
    // The first pass exports; then the library sleeps, waking for its heartbeat only.
    expect(lib.exports).toHaveLength(1);
    expect((lib.exports[0] as number) - start).toBeLessThanOrEqual(DAY);
    expect(lib.passes.length).toBeLessThanOrEqual(1 + Math.ceil(60 / MAX_SLEEP_DAYS));
    for (let i = 2; i < lib.passes.length; i++) {
      expect((lib.passes[i] as number) - (lib.passes[i - 1] as number)).toBeGreaterThan(
        (MAX_SLEEP_DAYS - 1) * DAY,
      );
    }
    // Every pass at the library's own time of day.
    for (const p of lib.passes) expect(p % DAY).toBe(dailySlot("lib-idle"));

    // Idle for weeks, then a write: exported at the next slot.
    const wrote = lib.clock.t;
    await lib.write("b.md", "B\n");
    await lib.until(wrote + DAY);
    expect(lib.exports).toHaveLength(2);
    expect((lib.exports[1] as number) - wrote).toBeLessThanOrEqual(DAY);
    expect(lib.store.stats().maintainers.export.lag).toBe(0);
  });

  test("an idle library is flagged stale soon and stale within a day of each date", async () => {
    const start = Date.parse("2026-10-01T12:00:00Z");
    const lib = await library("lib-stale", "2026-10-01T12:00:00Z");
    const staleAt = start + 40 * DAY;
    await lib.write("s.md", "S\n", `stale_after: ${iso(staleAt)}\n`);
    const soonAt = staleAt - 14 * DAY;
    const counts = () => lib.store.stats().maintainers.staleness;

    await lib.until(soonAt - 1);
    expect(counts()).toMatchObject({ stale: 0, stale_soon: 0 });
    await lib.until(soonAt + DAY);
    expect(counts()).toMatchObject({ stale: 0, stale_soon: 1 });
    expect(lib.store.work({ kind: "stale_soon" }).total).toBe(1);
    await lib.until(staleAt - 1);
    expect(counts()).toMatchObject({ stale: 0, stale_soon: 1 });
    await lib.until(staleAt + DAY);
    expect(counts()).toMatchObject({ stale: 1, stale_soon: 0 });
    expect(lib.store.health().counts.stale).toBe(1);
    // Two dates, a heartbeat a week: far fewer passes than days.
    expect(lib.passes.length).toBeLessThan(15);
  });

  test("an idle library's old exports and read counts are dropped on time", async () => {
    const start = Date.parse("2026-10-01T12:00:00Z");
    const lib = await library("lib-ret", "2026-10-01T12:00:00Z");
    for (let d = 0; d < 3; d++) {
      await lib.write("a.md", `A ${d}\n`);
      await lib.until(start + (d + 1) * DAY);
    }
    expect(lib.exports).toHaveLength(3);
    lib.store.read("a.md");
    expect(lib.store.maintenanceDue(new Date(lib.clock.t)).usageExpiry).not.toBeNull();

    const kept = async () => (await listExports(lib.bucket, "lib-ret")).length;
    expect(await kept()).toBe(3);
    // The first export goes the day after it passes retention, the second the day after that.
    const first = lib.exports[0] as number;
    const cutoff = (t: number) =>
      Date.parse(iso(t).slice(0, 10)) + (DEFAULT_RETENTION_DAYS + 1) * DAY;
    await lib.until(cutoff(first) + DAY);
    expect(await kept()).toBeLessThanOrEqual(2);
    await lib.until(cutoff(lib.exports[1] as number) + DAY);
    expect(await kept()).toBe(1);
    // The read count, from the third day, has left the 30-day window a day later.
    await lib.until(lib.clock.t + 2 * DAY);
    expect(lib.store.maintenanceDue(new Date(lib.clock.t)).usageExpiry).toBeNull();
    expect(lib.store.maintenanceDue(new Date(lib.clock.t)).exportExpiry).toBeNull();
  });

  test("an alarm the old schedule set at 03:MM still runs, then moves to the library's slot", async () => {
    const lib = await library("lib-old", "2026-10-01T12:00:00Z");
    await lib.write("a.md", "A\n");
    const old = nextRun(new Date(lib.clock.t), "lib-old").getTime();
    lib.alarm.at = old;
    await lib.until(old + 1);
    expect(lib.passes).toEqual([old]);
    expect(lib.exports).toEqual([old]);
    expect((lib.alarm.at as number) % DAY).toBe(dailySlot("lib-old"));
    expect(lib.store.stats().next_run).toBe(iso(lib.alarm.at as number));
  });

  test("a library that has never recorded its exports is due, so its first pass finds out", async () => {
    const lib = await library("lib-new", "2026-10-01T12:00:00Z");
    const now = new Date(lib.clock.t);
    expect(lib.store.maintenanceDue(now).exportExpiry).toBe(now.getTime());
    await lib.until(lib.clock.t + 2 * DAY);
    expect(lib.store.maintenanceDue(new Date(lib.clock.t)).exportExpiry).toBeNull();
  });
});
