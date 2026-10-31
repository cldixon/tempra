import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { DEFAULT_LIMITS, limitsFrom } from "../src/limits";
import {
  type Counts,
  d1QuotaAccounts,
  monthOf,
  monthResets,
  Quota,
  type QuotaAccount,
  QuotaCounter,
  recordStorage,
  StorageReport,
} from "../src/quota";
import { API, LIB, ORIGIN, OWNER, setup } from "./harness";
import { bunSqlHandle } from "./sqlite";

// Monthly quotas per account (TEMPRA-232; tempra-dev: v2/limits, Monthly quotas).

type S = ReturnType<typeof setup>;
type Text = { type: "text"; text: string };

const md = (body: string) => `---\ntype: Note\n---\n${body}\n`;

const put = (s: S, path: string, token = "writer") =>
  s.req(`/files/${path}`, {
    method: "PUT",
    token,
    headers: { "Content-Type": "text/markdown" },
    body: md(path),
  });

const limit = (s: S, limits: Record<string, number>) =>
  s.db.run("UPDATE users SET limits = ? WHERE id = ?", [JSON.stringify(limits), OWNER.id]);

async function mcp(s: S, token = "writer") {
  const transport = new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
    fetch: async (url, init) => s.app.request(url.toString(), init as RequestInit),
  });
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(transport);
  return async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args });
    return { text: (r.content as Text[]).map((c) => c.text).join("\n"), isError: !!r.isError };
  };
}

const NOV = Date.UTC(2026, 10, 14, 12);
const DEC = Date.UTC(2026, 11, 1, 0, 0, 1);

describe("the month", () => {
  test("is the UTC calendar month, and resets on the first at 00:00 UTC", () => {
    expect(monthOf(NOV)).toBe("2026-11");
    expect(monthOf(Date.UTC(2026, 10, 30, 23, 59, 59))).toBe("2026-11");
    expect(monthOf(DEC)).toBe("2026-12");
    expect(monthResets("2026-11").toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(monthResets("2026-12").toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  test("the quotas are limits like the others, with defaults and overrides", () => {
    expect(DEFAULT_LIMITS).toMatchObject({
      writes_month: 100_000,
      requests_month: 1_000_000,
      storage_mb: 1024,
    });
    expect(limitsFrom('{"writes_month": 5, "storage_mb": -1}')).toMatchObject({
      writes_month: 5,
      requests_month: 1_000_000,
      storage_mb: 1024,
    });
  });
});

describe("QuotaCounter (the account's object)", () => {
  test("adds tallies to the month and answers its totals; a new month starts at zero", () => {
    const c = new QuotaCounter(bunSqlHandle());
    expect(c.get("2026-11")).toEqual({ writes: 0, requests: 0 });
    expect(c.add("2026-11", { writes: 2, requests: 5 })).toEqual({ writes: 2, requests: 5 });
    expect(c.add("2026-11", { writes: 1, requests: 1 })).toEqual({ writes: 3, requests: 6 });
    expect(c.add("2026-12", { writes: 1, requests: 1 })).toEqual({ writes: 1, requests: 1 });
    // The month before stays; older ones go once a new month starts.
    expect(c.get("2026-11").writes).toBe(3);
    c.add("2027-01", { writes: 1, requests: 1 });
    expect(c.get("2026-11").writes).toBe(0);
  });

  test("records each notice once a month", () => {
    const c = new QuotaCounter(bunSqlHandle());
    expect(c.mark("2026-11", ["writes:80"])).toEqual(["writes:80"]);
    expect(c.mark("2026-11", ["writes:80", "writes:100"])).toEqual(["writes:100"]);
    expect(c.mark("2026-12", ["writes:80"])).toEqual(["writes:80"]);
  });
});

describe("Quota (the isolate's tally)", () => {
  function world(limits: Partial<QuotaAccount["limits"]> = {}) {
    const counter = new QuotaCounter(bunSqlHandle());
    const calls = { add: 0, account: 0 };
    const mails: string[] = [];
    let now = NOV;
    const account: QuotaAccount = {
      handle: "ann",
      email: "ann@example.com",
      limits: { ...DEFAULT_LIMITS, ...limits },
      storageBytes: 0,
    };
    const quota = new Quota(
      {
        add: async (_a, month, add: Counts) => {
          calls.add++;
          return counter.add(month, add);
        },
        mark: async (_a, month, keys) => counter.mark(month, keys),
        account: async () => {
          calls.account++;
          return account;
        },
        owner: async () => account,
        mail: async (m) => {
          mails.push(m.subject);
        },
      },
      { now: () => now, origin: ORIGIN },
    );
    return {
      quota,
      counter,
      calls,
      mails,
      account,
      tick: (ms: number) => {
        now += ms;
      },
      at: (t: number) => {
        now = t;
      },
    };
  }

  test("counts in memory, flushing to the object at most every 5 s", async () => {
    const w = world();
    for (let i = 0; i < 50; i++) await w.quota.count("ann", i % 2 === 0);
    // The first request flushed (and read the limits); the rest waited in memory.
    expect(w.calls).toEqual({ add: 1, account: 1 });
    expect(w.counter.get("2026-11")).toEqual({ writes: 1, requests: 1 });
    w.tick(5_000);
    await w.quota.count("ann", false);
    expect(w.calls.add).toBe(2);
    expect(w.counter.get("2026-11")).toEqual({ writes: 25, requests: 51 });
    // The limits are read again after a minute, not on every flush.
    expect(w.calls.account).toBe(1);
    w.tick(60_000);
    await w.quota.count("ann", false);
    expect(w.calls.account).toBe(2);
  });

  test("refuses writes past the month's writes, counting what is not flushed yet", async () => {
    const w = world({ writes_month: 3 });
    for (let i = 0; i < 3; i++) {
      await w.quota.count("ann", true);
      await w.quota.checkWrite("ann");
    }
    await w.quota.count("ann", true);
    const err = await w.quota.checkWrite("ann").catch((e) => e);
    expect(err.status).toBe(403);
    expect(err.code).toBe("quota_reached");
    expect(err.extra).toEqual({ quota: "writes", limit: 3, resets: "2026-12-01T00:00:00.000Z" });
    expect(err.message).toContain("monthly limit of 3 writes");
    expect(err.message).toContain("1 December 2026");
  });

  test("a new month starts again", async () => {
    const w = world({ writes_month: 1 });
    await w.quota.count("ann", true);
    await w.quota.count("ann", true);
    await expect(w.quota.checkWrite("ann")).rejects.toMatchObject({ code: "quota_reached" });
    w.at(DEC);
    await w.quota.count("ann", true);
    await w.quota.checkWrite("ann");
    expect(w.counter.get("2026-12")).toEqual({ writes: 1, requests: 1 });
  });

  test("tells the person once at 80% and once at 100%, the highest crossed only", async () => {
    const w = world({ writes_month: 10 });
    for (let i = 0; i < 8; i++) {
      await w.quota.count("ann", true);
      w.tick(5_000);
    }
    expect(w.mails).toEqual(["Your Tempra account has used 80% of its monthly writes"]);
    for (let i = 0; i < 5; i++) {
      await w.quota.count("ann", true);
      w.tick(5_000);
    }
    expect(w.mails).toEqual([
      "Your Tempra account has used 80% of its monthly writes",
      "Your Tempra account has reached its monthly writes limit",
    ]);
    // Another isolate crossing the same lines sends nothing: the object recorded them.
    const other = new Quota(
      {
        add: async (_a, month, add) => w.counter.add(month, add),
        mark: async (_a, month, keys) => w.counter.mark(month, keys),
        account: async () => w.account,
        owner: async () => w.account,
        mail: async (m) => {
          w.mails.push(m.subject);
        },
      },
      { now: () => NOV },
    );
    await other.count("ann", true);
    expect(w.mails).toHaveLength(2);

    // A jump past both lines mails the 100% one alone.
    const jump = world({ requests_month: 4 });
    for (let i = 0; i < 4; i++) await jump.quota.count("ann", false);
    jump.tick(5_000);
    await jump.quota.count("ann", false);
    expect(jump.mails).toEqual([
      "Your Tempra account has reached its monthly tool calls and API requests limit",
    ]);
  });

  test("storage across the owner's libraries", async () => {
    const w = world({ storage_mb: 1 });
    await w.quota.checkStorage("lib");
    w.account.storageBytes = 1048576;
    w.tick(60_000);
    const err = await w.quota.checkStorage("lib").catch((e) => e);
    expect(err.code).toBe("quota_reached");
    expect(err.extra).toEqual({ quota: "storage", limit: 1 });
    expect(err.message).toContain("limit of 1 MB of storage");
    expect(w.mails).toEqual(["Your Tempra account has reached its storage limit"]);
  });
});

describe("storage per library in D1", () => {
  test("recorded by the library, summed per owner", async () => {
    const s = setup();
    const other = await s.accounts.createLibrary("other", await s.accounts.user(OWNER.email));
    s.db.run("UPDATE libraries SET storage_bytes = 300 WHERE id = ?", [LIB.id]);
    s.db.run("UPDATE libraries SET storage_bytes = 200 WHERE id = ?", [other.id]);
    const accounts = d1QuotaAccounts(d1Of(s));
    expect((await accounts.account(OWNER.handle))?.storageBytes).toBe(500);
    expect((await accounts.owner(other.id))?.handle).toBe(OWNER.handle);
    await recordStorage(d1Of(s), LIB.do_id, 1000);
    expect((await accounts.owner(LIB.id))?.storageBytes).toBe(1200);
  });

  test("a library reports at once, then at most once a minute", async () => {
    const recorded: number[] = [];
    let now = 1_000_000;
    const report = new StorageReport(
      async (b) => {
        recorded.push(b);
      },
      () => now,
    );
    report.changed(() => 1);
    await Bun.sleep(5);
    expect(recorded).toEqual([1]);
    now += 1_000;
    report.changed(() => 2);
    report.changed(() => 3);
    await Bun.sleep(5);
    // Held until a minute after the last report.
    expect(recorded).toEqual([1]);
  });
});

describe("over REST", () => {
  test("writes are refused past the month's writes; reads keep working", async () => {
    const s = setup();
    limit(s, { writes_month: 2 });
    expect((await put(s, "notes/a.md")).status).toBe(200);
    expect((await put(s, "notes/b.md")).status).toBe(200);
    const refused = await put(s, "notes/c.md");
    expect(refused.status).toBe(403);
    const body = (await refused.json()) as Record<string, unknown>;
    expect(body.code).toBe("quota_reached");
    expect(body.quota).toBe("writes");
    expect(body.limit).toBe(2);
    expect(typeof body.resets).toBe("string");
    expect(String(body.error)).toContain("monthly limit of 2 writes");
    expect((await s.req("/files/notes/c.md")).status).toBe(404);
    expect((await s.req("/files/notes/a.md")).status).toBe(200);
    expect((await s.req("/stats")).status).toBe(200);
    // A person in the app is not held to the agents' monthly counts.
    const comment = await s.app.request(`${API}/comments`, {
      method: "POST",
      headers: { Origin: ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({ path: "notes/a.md", body: "Still here." }),
    });
    expect(comment.status).toBe(201);
  });

  test("past the month's requests, writes are refused and reads answered", async () => {
    const s = setup();
    limit(s, { requests_month: 3 });
    expect((await put(s, "notes/a.md")).status).toBe(200);
    expect((await s.req("/files/notes/a.md")).status).toBe(200);
    expect((await s.req("/files/notes/a.md")).status).toBe(200);
    const refused = (await (await put(s, "notes/b.md")).json()) as Record<string, unknown>;
    expect(refused.code).toBe("quota_reached");
    expect(refused.quota).toBe("requests");
    expect((await s.req("/files/notes/a.md")).status).toBe(200);
  });

  test("the month resets", async () => {
    const s = setup();
    s.clock.now = () => NOV;
    limit(s, { writes_month: 1 });
    expect((await put(s, "notes/a.md")).status).toBe(200);
    expect((await put(s, "notes/b.md")).status).toBe(403);
    s.clock.now = () => DEC;
    expect((await put(s, "notes/b.md")).status).toBe(200);
  });

  test("storage across the owner's libraries refuses what adds, not deletes", async () => {
    const s = setup();
    expect((await put(s, "notes/a.md")).status).toBe(200);
    limit(s, { storage_mb: 1 });
    s.db.run("UPDATE libraries SET storage_bytes = ? WHERE id = ?", [2 * 1048576, LIB.id]);
    const refused = await put(s, "notes/b.md");
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { quota: string }).quota).toBe("storage");
    const head = (await (
      await s.req("/files/notes/a.md", { headers: { Accept: "application/json" } })
    ).json()) as { hash: string };
    const del = await s.req("/files/notes/a.md", {
      method: "DELETE",
      headers: { "If-Match": head.hash },
    });
    expect(del.status).toBe(200);
  });

  test("the person is mailed at 80% and at 100%, once each", async () => {
    const s = setup();
    limit(s, { writes_month: 5 });
    for (let i = 0; i < 7; i++) await put(s, `notes/${i}.md`);
    const quota = s.outbox.filter((m) => m.subject.includes("monthly writes"));
    expect(quota.map((m) => m.to)).toEqual([OWNER.email, OWNER.email]);
    expect(quota.map((m) => m.subject)).toEqual([
      "Your Tempra account has used 80% of its monthly writes",
      "Your Tempra account has reached its monthly writes limit",
    ]);
    expect(quota[1]?.text).toContain(`${ORIGIN}/account#usage`);
  });

  test("the Account page shows the month against the quotas", async () => {
    const s = setup();
    await put(s, "notes/a.md");
    await s.req("/files/notes/a.md");
    s.db.run("UPDATE libraries SET storage_bytes = 4096 WHERE id = ?", [LIB.id]);
    const account = (await (await s.app.request("/api/v1/account")).json()) as {
      month: {
        month: string;
        resets: string;
        writes: { used: number; limit: number };
        requests: { used: number; limit: number };
        storage: { used: number; limit: number };
      };
    };
    expect(account.month.writes).toEqual({ used: 1, limit: 100_000 });
    expect(account.month.requests).toEqual({ used: 2, limit: 1_000_000 });
    expect(account.month.storage).toEqual({ used: 4096, limit: 1024 * 1048576 });
    expect(account.month.resets).toBe(monthResets(account.month.month).toISOString());
  });
});

describe("over MCP", () => {
  test("a write past the quota is a tool error naming it; reads keep working", async () => {
    const s = setup();
    limit(s, { writes_month: 1 });
    const call = await mcp(s);
    expect((await call("write", { path: "notes/a.md", content: md("A.") })).isError).toBe(false);
    const refused = await call("write", { path: "notes/b.md", content: md("B.") });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("Error 403 quota_reached");
    expect(refused.text).toContain("monthly limit of 1 writes");
    const read = await call("read", { path: "notes/a.md" });
    expect(read.isError).toBe(false);
    expect(read.text).toContain("A.");
  });
});

const d1Of = (s: S): D1Database => s.d1;
