import { describe, expect, test } from "bun:test";
import {
  agentSpendThisMonth,
  amount,
  costOf,
  costReport,
  dateChunks,
  monthWindow,
  PRICES,
  projected,
  r2Class,
  reportText,
  usd,
} from "../src/costs";
import { agentSpendLine, digestText } from "../src/sweep";
import { bunD1 } from "./d1";

describe("cost report (TEMPRA-233)", () => {
  test("a month's window: the current one so far, an ended one whole", () => {
    const now = new Date("2026-10-16T12:00:00Z");
    expect(monthWindow("2026-10", now)).toEqual({
      month: "2026-10",
      from: "2026-10-01",
      to: "2026-10-16",
      days: 31,
      elapsed: 15.5,
      complete: false,
    });
    expect(monthWindow("2026-09", now)).toMatchObject({
      from: "2026-09-01",
      to: "2026-09-30",
      days: 30,
      elapsed: 30,
      complete: true,
    });
    expect(monthWindow("2024-02", now).days).toBe(29);
    expect(() => monthWindow("2026-11", now)).toThrow("not started");
    expect(() => monthWindow("2026-13", now)).toThrow("Not a month");
    expect(() => monthWindow("October", now)).toThrow("Not a month");
  });

  test("the month is queried in ranges the Analytics API accepts", () => {
    expect(dateChunks("2026-10-01", "2026-10-31")).toEqual([
      ["2026-10-01", "2026-10-10"],
      ["2026-10-11", "2026-10-20"],
      ["2026-10-21", "2026-10-30"],
      ["2026-10-31", "2026-10-31"],
    ]);
    expect(dateChunks("2026-10-01", "2026-10-03")).toEqual([["2026-10-01", "2026-10-03"]]);
  });

  test("a projection scales what has been used to the whole month", () => {
    const half = monthWindow("2026-10", new Date("2026-10-16T12:00:00Z"));
    expect(projected(10, half)).toBe(20);
    const done = monthWindow("2026-09", new Date("2026-10-16T12:00:00Z"));
    expect(projected(10, done)).toBe(10);
  });

  test("included amounts come off before the rate applies", () => {
    const p = PRICES["workers.requests"];
    expect(costOf(p, 5_000_000)).toEqual({ cost: 0, list: 1.5 });
    expect(costOf(p, 12_000_000).cost).toBeCloseTo(0.6, 10);
    const rows = PRICES["d1.rows_written"];
    expect(costOf(rows, 51_000_000).cost).toBeCloseTo(1, 10);
    const images = PRICES["images.transformations"];
    expect(costOf(images, 7000).cost).toBeCloseTo(1, 10);
  });

  test("every price names its page and a positive rate", () => {
    for (const p of Object.values(PRICES)) {
      expect(p.url).toStartWith("https://developers.cloudflare.com/");
      expect(p.usd).toBeGreaterThan(0);
      expect(p.per).toBeGreaterThan(0);
    }
  });

  test("R2 operations by class; deletes are free", () => {
    expect(r2Class("PutObject")).toBe("a");
    expect(r2Class("ListObjects")).toBe("a");
    expect(r2Class("GetObject")).toBe("b");
    expect(r2Class("HeadBucket")).toBe("b");
    expect(r2Class("DeleteObject")).toBe("free");
    expect(r2Class("DeleteObjects")).toBe("free");
    // An operation the price page does not name is counted at the dearer rate.
    expect(r2Class("SomethingNew")).toBe("a");
  });

  test("storage is the average of daily peaks, and the month so far is its share", () => {
    const w = monthWindow("2026-10", new Date("2026-10-16T12:00:00Z"));
    const r = costReport("tempra", w, { "r2.storage_gb_month": [10e9, 30e9] }, []);
    const line = r.lines.find((l) => l.key === "r2.storage_gb_month");
    expect(line?.projectedUsage).toBe(20);
    expect(line?.usage).toBeCloseTo(10, 10);
    // 20 GB-months past 10 included at $0.015.
    expect(line?.projectedCost).toBeCloseTo(0.15, 10);
    expect(line?.cost).toBe(0);
  });

  test("the report adds up Cloudflare and @tempra, leaving out what is not billed or not ours", () => {
    const w = monthWindow("2026-09", new Date("2026-10-16T12:00:00Z"));
    const r = costReport(
      "tempra",
      w,
      {
        "workers.requests": 20_000_000,
        "ae.data_points": 50_000_000,
        "browser.hours": 100,
      },
      [
        { user: "u1", handle: "ann", micro: 250_000, calls: 4, turns: 1 },
        { user: "u2", handle: "bob", micro: 1_750_000, calls: 9, turns: 3 },
      ],
    );
    expect(r.cloudflare.projected).toBeCloseTo(3, 10);
    expect(r.cloudflare.projectedList).toBeCloseTo(6, 10);
    expect(r.agent).toMatchObject({ usd: 2, projected: 2, calls: 13, turns: 4 });
    expect(r.agent.accounts.map((a) => a.handle)).toEqual(["bob", "ann"]);
    expect(r.projectedTotal).toBeCloseTo(5, 10);
    const text = reportText(r);
    expect(text).toContain("tempra, 2026-09 (whole month)");
    expect(text).toContain(
      "Cloudflare: $3.00 so far, $3.00 projected ($6.00 with nothing included).",
    );
    expect(text).toContain("@tempra: $2.00 so far, $2.00 projected (4 turns, 13 model calls).");
    expect(text).toContain("@bob: $1.75");
    expect(text).toContain("not billed yet; not in totals");
    expect(text).toContain("Projected month: $5.00, plus the account's $5.00 Workers Paid plan");
  });

  test("numbers read short", () => {
    expect(usd(0)).toBe("$0.00");
    expect(usd(0.0046)).toBe("$0.0046");
    expect(usd(12.345)).toBe("$12.35");
    expect(amount(0.125)).toBe("0.125");
    expect(amount(8965.4)).toBe("8,965");
    expect(amount(39_300)).toBe("39.3k");
    expect(amount(1_610_000)).toBe("1.61M");
    expect(amount(25e9)).toBe("25.00B");
  });

  test("the digest's @tempra line reads this month's agent_usage", async () => {
    const { d1, db } = bunD1();
    const add = db.prepare(
      "INSERT INTO agent_usage (user, day, micro_usd, calls, turns) VALUES (?, ?, ?, ?, ?)",
    );
    add.run("u1", "2026-09-30", 9_000_000, 9, 9);
    add.run("u1", "2026-10-02", 1_000_000, 3, 1);
    add.run("u2", "2026-10-15", 500_000, 2, 1);
    const spend = await agentSpendThisMonth(d1, new Date("2026-10-16T12:00:00Z"));
    expect(spend).toEqual({ usd: 1.5, projected: 3, turns: 2, accounts: 2 });
    expect(agentSpendLine(spend)).toBe(
      "@tempra this month: $1.50 so far, about $3.00 projected (2 turns, 2 accounts).",
    );
    const day = {
      libraries: 1,
      stored: 0,
      referenced: 0,
      orphaned: 0,
      deleted: 0,
      recount: "open" as const,
      attention: [],
      health: [],
    };
    expect(digestText({ ...day, agentSpend: spend })).toContain(agentSpendLine(spend));
    expect(digestText(day)).not.toContain("@tempra");
  });
});
