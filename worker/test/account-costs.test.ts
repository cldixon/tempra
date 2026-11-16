import { describe, expect, test } from "bun:test";
import { aeDataset, aeSql, aeString } from "../src/ae";
import {
  accountCosts,
  accountsText,
  type CostMeter,
  costReport,
  monthWindow,
  PRICES,
} from "../src/costs";

const rate = (k: keyof typeof PRICES) => PRICES[k].usd / PRICES[k].per;

const meter = (m: Partial<CostMeter> & Pick<CostMeter, "account" | "library">): CostMeter => ({
  points: 0,
  doCalls: 0,
  rowsRead: 0,
  rowsWritten: 0,
  ms: 0,
  ...m,
});

/** October 2026, whole: no projection, so so-far and projected agree. */
function october() {
  const w = monthWindow("2026-10", new Date("2026-11-16T12:00:00Z"));
  const report = costReport(
    "tempra",
    w,
    {
      "workers.requests": 12_000_000,
      "do.requests": 2_000_000,
      "do.rows_written": 60_000_000,
      "do.rows_read": 1_000_000_000,
      "do.duration_gbs": 100_000,
      "do.storage_gb_month": [8e9],
    },
    [
      { user: "u-bob", handle: "bob", micro: 3_000_000, calls: 5, turns: 2 },
      { user: "u-gone", handle: "?", micro: 500_000, calls: 1, turns: 1 },
    ],
  );
  const inputs = {
    meters: [
      meter({
        account: "ann",
        library: "L1",
        points: 100,
        doCalls: 150,
        rowsRead: 1e6,
        rowsWritten: 2e6,
        ms: 600,
      }),
      // The object's read flush: no account, owned through the library.
      meter({ account: "", library: "L1", points: 50, doCalls: 50, rowsWritten: 1e6 }),
      // A grant from before A1, metered under its library id.
      meter({ account: "L2", library: "L2", points: 10, doCalls: 10, rowsWritten: 1e6, ms: 200 }),
      // A flush for a library D1 no longer has.
      meter({ account: "", library: "L9", points: 5, doCalls: 5, rowsWritten: 5e5 }),
      meter({
        account: "cl",
        library: "L3",
        points: 1000,
        doCalls: 1000,
        rowsWritten: 1e7,
        ms: 200,
      }),
    ],
    requests: { ann: 100, L2: 10, cl: 1000 },
    owners: { L1: "ann", L2: "bob", L3: "cl", L4: "carol" },
    storage: { ann: 1e9, carol: 2e9 },
    agent: report.agent.accounts,
    operator: "cl",
  };
  return { w, report, inputs };
}

describe("cost per account (TEMPRA-236)", () => {
  test("calls go to the account they were metered under; flushes and old grants to the owner", () => {
    const { report, inputs } = october();
    const a = accountCosts(inputs, report);
    const by = Object.fromEntries(a.accounts.map((x) => [x.handle, x]));
    expect(Object.keys(by).sort()).toEqual(["ann", "bob", "carol", "cl"]);
    expect(by.ann).toMatchObject({ calls: 100, doCalls: 150, rowsRead: 1e6, rowsWritten: 3e6 });
    expect(by.ann?.requests).toBe(100);
    expect(by.bob).toMatchObject({ calls: 10, doCalls: 10, rowsWritten: 1e6, requests: 10 });
    expect(by.bob?.agentUsd).toBeCloseTo(3, 10);
    expect(by.carol).toMatchObject({ calls: 0, storageBytes: 2e9, active: false });
    expect(by.cl).toMatchObject({ operator: true, active: true });
  });

  test("an account's list cost: its rows, requests, share of DO time, storage and @tempra", () => {
    const { report, inputs } = october();
    const ann = accountCosts(inputs, report).accounts.find((x) => x.handle === "ann");
    // 600 of the 1,000 ms metered: 60% of the namespace's 100,000 GB-s.
    expect(ann?.durationGbs).toBeCloseTo(60_000, 6);
    const expected =
      3e6 * rate("do.rows_written") +
      1e6 * rate("do.rows_read") +
      150 * rate("do.requests") +
      100 * rate("workers.requests") +
      60_000 * rate("do.duration_gbs") +
      1 * rate("do.storage_gb_month");
    expect(ann?.cloudflareList).toBeCloseTo(expected, 10);
    expect(ann?.projected).toBeCloseTo(expected, 10);
  });

  test("shares of the bill and the unattributed rest add up to the report", () => {
    const { report, inputs } = october();
    const a = accountCosts(inputs, report);
    const shares = a.accounts.reduce((t, x) => t + x.shareOfBill, 0) + a.unattributed.shareOfBill;
    expect(shares).toBeCloseTo(report.cloudflare.projected + report.agent.projected, 10);
    const lists = a.accounts.reduce((t, x) => t + x.cloudflareProjected, 0);
    expect(lists + a.unattributed.cloudflareProjectedList).toBeCloseTo(
      report.cloudflare.projectedList,
      10,
    );
    expect(a.unattributed.cloudflareProjectedList).toBeGreaterThan(0);
  });

  test("most expensive first; cost per active account leaves the operator out", () => {
    const { report, inputs } = october();
    const a = accountCosts(inputs, report);
    expect(a.accounts[0]?.handle).toBe("cl");
    const projected = a.accounts.map((x) => x.projected);
    expect(projected).toEqual([...projected].sort((x, y) => y - x));
    expect(a.active).toBe(2);
    const others = a.accounts.filter((x) => x.handle !== "cl");
    expect(a.perActive).toBeCloseTo(others.reduce((t, x) => t + x.projected, 0) / 2, 10);
    expect(accountCosts({ ...inputs, operator: undefined }, report).active).toBe(3);
    expect(accountCosts({ ...inputs, meters: [], requests: {} }, report).perActive).toBeNull();
  });

  test("a month under way projects counts and keeps storage at its level", () => {
    const w = monthWindow("2026-11", new Date("2026-11-16T00:00:00Z"));
    const report = costReport("tempra", w, { "do.rows_written": 1e6, "do.duration_gbs": 0 }, []);
    const a = accountCosts(
      {
        meters: [meter({ account: "ann", library: "L1", points: 1, rowsWritten: 1e6 })],
        requests: { ann: 1 },
        owners: { L1: "ann" },
        storage: { ann: 1e9 },
        agent: [],
      },
      report,
    );
    const ann = a.accounts[0];
    const rows = 1e6 * rate("do.rows_written") + rate("workers.requests");
    const gbMonth = rate("do.storage_gb_month");
    expect(ann?.cloudflareList).toBeCloseTo(rows + (gbMonth * 15) / 30, 10);
    expect(ann?.cloudflareProjected).toBeCloseTo(rows * 2 + gbMonth, 10);
  });

  test("the table reads most expensive first, with the rest and cost per active account", () => {
    const { report, inputs } = october();
    const text = accountsText(accountCosts(inputs, report));
    expect(text).toContain("share of bill");
    expect(text).toContain("@cl (operator)");
    expect(text.indexOf("@cl")).toBeLessThan(text.indexOf("@ann"));
    expect(text).toContain("Unattributed (cron, sweep, mail, R2, KV and the rest):");
    expect(text).toMatch(
      /Cost per active account: \$[\d.]+ at list, \$[\d.]+ of the bill \(2 active/,
    );
    expect(accountsText(accountCosts(inputs, report), 2)).toContain("… 2 more");
  });
});

describe("Analytics Engine SQL", () => {
  test("posts the query as JSON to the account's endpoint and returns its rows", async () => {
    const seen: { url: string; body: string; auth: string }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      seen.push({
        url,
        body: String(init.body),
        auth: String((init.headers as Record<string, string>).Authorization),
      });
      return Response.json({ data: [{ kind: "request", n: "3" }] });
    }) as unknown as typeof fetch;
    const rows = await aeSql({ accountId: "acc", token: "t" }, "SELECT 1", fake);
    expect(rows).toEqual([{ kind: "request", n: "3" }]);
    expect(seen[0]).toEqual({
      url: "https://api.cloudflare.com/client/v4/accounts/acc/analytics_engine/sql",
      body: "SELECT 1\nFORMAT JSON",
      auth: "Bearer t",
    });
  });

  test("a failed query throws with its status", async () => {
    const fake = (async () => new Response("nope", { status: 403 })) as unknown as typeof fetch;
    await expect(aeSql({ accountId: "a", token: "t" }, "SELECT 1", fake)).rejects.toThrow("403");
  });

  test("names and strings are checked and quoted", () => {
    expect(aeDataset("tempra_usage_staging")).toBe("tempra_usage_staging");
    expect(() => aeDataset("x; DROP")).toThrow("Not a dataset name");
    expect(aeString("o'brien")).toBe("'o''brien'");
  });
});
