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
  type QuotaBackend,
  QuotaCounter,
  type QuotaNotice,
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

/** This month as the Account page reads it. */
async function month(s: S) {
  const a = (await (await s.app.request("/api/v1/account")).json()) as {
    month: {
      month: string;
      resets: string;
      writes: { used: number; limit: number };
      requests: { used: number; limit: number };
      storage: { used: number; limit: number };
    };
  };
  return a.month;
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
      writes_monthly: 100_000,
      requests_monthly: 10_000_000,
      storage_mb: 1024,
    });
    expect(limitsFrom('{"writes_monthly": 5, "storage_mb": -1}')).toMatchObject({
      writes_monthly: 5,
      requests_monthly: 10_000_000,
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
    const counters = new Map<string, QuotaCounter>();
    const counter = (id: string) => {
      let c = counters.get(id);
      if (!c) {
        c = new QuotaCounter(bunSqlHandle());
        counters.set(id, c);
      }
      return c;
    };
    const calls = { add: 0, account: 0 };
    const mails: string[] = [];
    const notices: QuotaNotice[] = [];
    let now = NOV;
    const account: QuotaAccount = {
      id: "user_ann",
      handle: "ann",
      email: "ann@example.com",
      limits: { ...DEFAULT_LIMITS, ...limits },
      storageBytes: 0,
    };
    const backend: QuotaBackend = {
      add: async (id, m, add: Counts) => {
        calls.add++;
        return counter(id).add(m, add);
      },
      mark: async (id, m, keys) => counter(id).mark(m, keys),
      account: async (handle) => {
        calls.account++;
        return handle === account.handle ? account : null;
      },
      accountById: async (id) => (id === account.id ? account : null),
      owner: async () => account,
      mail: async (m) => {
        mails.push(m.subject);
      },
      notice: async (_id, n) => {
        notices.push(n);
      },
    };
    const quota = new Quota(backend, { now: () => now, origin: ORIGIN });
    return {
      quota,
      backend,
      counter,
      calls,
      mails,
      notices,
      account,
      tick: (ms: number) => {
        now += ms;
      },
      at: (t: number) => {
        now = t;
      },
    };
  }

  /** A write as the guard makes it: checked, then counted once it went through. */
  const write = async (q: Quota, handle = "ann") => {
    await q.checkWrite(handle);
    await q.countWrite(handle);
  };

  test("counts in memory, flushing to the object at most every 5 s", async () => {
    const w = world();
    for (let i = 0; i < 50; i++) await w.quota.admitRequest("ann");
    // The first request flushed (and read the limits); the rest waited in memory.
    expect(w.calls).toEqual({ add: 1, account: 1 });
    expect(w.counter("user_ann").get("2026-11")).toEqual({ writes: 0, requests: 1 });
    w.tick(5_000);
    await w.quota.admitRequest("ann");
    expect(w.calls.add).toBe(2);
    expect(w.counter("user_ann").get("2026-11")).toEqual({ writes: 0, requests: 51 });
    // The limits are read again after a minute, not on every flush.
    expect(w.calls.account).toBe(1);
    w.tick(60_000);
    await w.quota.admitRequest("ann");
    expect(w.calls.account).toBe(2);
  });

  test("counts are kept by user id, so a new handle keeps the month", async () => {
    const w = world();
    await w.quota.admitRequest("ann");
    w.account.handle = "annie";
    await w.quota.admitRequest("annie");
    expect(w.counter("user_ann").get("2026-11").requests).toBe(2);
  });

  test("refuses writes at the month's writes, and never counts a refused one", async () => {
    const w = world({ writes_monthly: 3 });
    for (let i = 0; i < 3; i++) await write(w.quota);
    const err = await w.quota.checkWrite("ann").catch((e) => e);
    expect(err.status).toBe(403);
    expect(err.code).toBe("quota_reached");
    expect(err.extra).toEqual({
      quota: "writes",
      limit: 3,
      used: 3,
      resets: "2026-12-01T00:00:00.000Z",
      usage: `${ORIGIN}/account#usage`,
    });
    expect(err.message).toContain("monthly limit of 3 writes: 3 this month");
    expect(err.message).toContain("Reads still work");
    expect(err.message).toContain("1 December 2026");
    expect(err.message).toContain(`${ORIGIN}/account#usage`);
    expect(err.message).not.toContain("ask for more");
    await w.quota.checkWrite("ann").catch(() => {});
    w.tick(5_000);
    await w.quota.admitRequest("ann");
    expect(w.counter("user_ann").get("2026-11").writes).toBe(3);
  });

  test("the request ceiling refuses every request past it, reads included", async () => {
    const w = world({ requests_monthly: 3 });
    for (let i = 0; i < 3; i++) await w.quota.admitRequest("ann");
    const err = await w.quota.admitRequest("ann").catch((e) => e);
    expect(err.code).toBe("quota_reached");
    expect(err.extra).toMatchObject({ quota: "requests", limit: 3, used: 4 });
    expect(err.message).toContain("monthly limit of 3 tool calls and API requests");
    expect(err.message).toContain("Nothing more is answered");
    expect(err.message).toContain("reads included");
  });

  test("a new month starts again", async () => {
    const w = world({ writes_monthly: 1 });
    await write(w.quota);
    await expect(w.quota.checkWrite("ann")).rejects.toMatchObject({ code: "quota_reached" });
    w.at(DEC);
    await write(w.quota);
    w.tick(5_000);
    await w.quota.admitRequest("ann");
    expect(w.counter("user_ann").get("2026-12")).toEqual({ writes: 1, requests: 1 });
  });

  test("tells the person once at 80% and once at 100%, in the bell and by mail", async () => {
    const w = world({ writes_monthly: 10 });
    for (let i = 0; i < 8; i++) {
      await write(w.quota);
      w.tick(5_000);
    }
    expect(w.mails).toEqual(["Your Tempra account has used 80% of its monthly writes"]);
    expect(w.notices).toEqual([
      { quota: "writes", pct: 80, title: "Writes this month", excerpt: "80% used: 8 of 10" },
    ]);
    for (let i = 0; i < 2; i++) {
      await write(w.quota);
      w.tick(5_000);
    }
    expect(w.mails).toEqual([
      "Your Tempra account has used 80% of its monthly writes",
      "Your Tempra account has reached its monthly writes limit",
    ]);
    expect(w.notices[1]).toEqual({
      quota: "writes",
      pct: 100,
      title: "Writes this month",
      excerpt: "Limit reached: 10 of 10; writes start again on 1 December 2026",
    });
    // Another isolate crossing the same lines tells no one again: the object recorded them.
    const other = new Quota(w.backend, { now: () => NOV });
    await other.admitRequest("ann");
    expect(w.mails).toHaveLength(2);
    expect(w.notices).toHaveLength(2);

    // A jump past both lines tells the 100% one alone.
    const jump = world({ requests_monthly: 4 });
    for (let i = 0; i < 4; i++) await jump.quota.admitRequest("ann");
    jump.tick(5_000);
    await jump.quota.admitRequest("ann").catch(() => {});
    expect(jump.mails).toEqual([
      "Your Tempra account has reached its monthly tool calls and API requests limit",
    ]);
    expect(jump.notices.map((n) => n.pct)).toEqual([100]);
  });

  test("storage across the owner's libraries", async () => {
    const w = world({ storage_mb: 1 });
    await w.quota.checkStorage("lib");
    w.account.storageBytes = 1048576;
    w.tick(60_000);
    const err = await w.quota.checkStorage("lib").catch((e) => e);
    expect(err.code).toBe("quota_reached");
    expect(err.extra).toMatchObject({ quota: "storage", limit: 1, used: 1048576 });
    expect(err.message).toContain("limit of 1 MB of storage: 1 MB is used");
    expect(err.message).toContain("delete or move content");
    expect(w.mails).toEqual(["Your Tempra account has reached its storage limit"]);
    expect(w.notices[0]?.title).toBe("Storage");
  });
});

describe("storage per library in D1", () => {
  test("recorded by the library, summed per owner", async () => {
    const s = setup();
    const other = await s.accounts.createLibrary("other", await s.accounts.user(OWNER.email));
    s.db.run("UPDATE libraries SET storage_bytes = 300 WHERE id = ?", [LIB.id]);
    s.db.run("UPDATE libraries SET storage_bytes = 200 WHERE id = ?", [other.id]);
    const accounts = d1QuotaAccounts(s.d1);
    expect((await accounts.account(OWNER.handle))?.storageBytes).toBe(500);
    expect((await accounts.accountById(OWNER.id))?.handle).toBe(OWNER.handle);
    expect((await accounts.owner(other.id))?.id).toBe(OWNER.id);
    await recordStorage(s.d1, LIB.do_id, 1000);
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
  test("writes are refused at the month's writes; reads keep working", async () => {
    const s = setup();
    limit(s, { writes_monthly: 2 });
    expect((await put(s, "notes/a.md")).status).toBe(200);
    expect((await put(s, "notes/b.md")).status).toBe(200);
    const refused = await put(s, "notes/c.md");
    expect(refused.status).toBe(403);
    const body = (await refused.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ code: "quota_reached", quota: "writes", limit: 2, used: 2 });
    expect(typeof body.resets).toBe("string");
    expect(String(body.error)).toContain("monthly limit of 2 writes");
    expect((await s.req("/files/notes/c.md")).status).toBe(404);
    expect((await s.req("/files/notes/a.md")).status).toBe(200);
    expect((await s.req("/stats")).status).toBe(200);
    // The refused write was not counted.
    await put(s, "notes/d.md");
    expect((await month(s)).writes).toEqual({ used: 2, limit: 2 });
    // A person in the app is not held to the agents' monthly counts.
    const comment = await s.app.request(`${API}/comments`, {
      method: "POST",
      headers: { Origin: ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({ path: "notes/a.md", body: "Still here." }),
    });
    expect(comment.status).toBe(201);
  });

  test("past the request ceiling nothing is answered for agents; the browser still is", async () => {
    const s = setup();
    limit(s, { requests_monthly: 3 });
    expect((await put(s, "notes/a.md")).status).toBe(200);
    expect((await s.req("/files/notes/a.md")).status).toBe(200);
    expect((await s.req("/files/notes/a.md")).status).toBe(200);
    const read = await s.req("/files/notes/a.md");
    expect(read.status).toBe(403);
    const body = (await read.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ code: "quota_reached", quota: "requests", limit: 3 });
    expect((await s.req("/files/notes/a.md", { token: "reader" })).status).toBe(403);
    expect((await s.app.request(`${API}/files/notes/a.md`)).status).toBe(200);
  });

  test("the quotas take nothing from the per-minute limiters", async () => {
    // One limiter call per request and one per write, as before the quotas; a write the quota
    // refuses spends no more than any other request (the gate's scripted agents share 60 a minute).
    const s = setup();
    const spent: string[] = [];
    s.deps.rateLimit = async (kind) => {
      spent.push(kind);
      return true;
    };
    limit(s, { writes_monthly: 1 });
    expect((await put(s, "notes/a.md")).status).toBe(200);
    expect(spent).toEqual(["request", "write"]);
    spent.length = 0;
    expect((await put(s, "notes/b.md")).status).toBe(403);
    expect(spent).toEqual(["request", "write"]);
    spent.length = 0;
    expect((await s.req("/files/notes/a.md")).status).toBe(200);
    expect(spent).toEqual(["request"]);
  });

  test("the month resets", async () => {
    const s = setup();
    s.clock.now = () => NOV;
    limit(s, { writes_monthly: 1 });
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

  test("the person is told at 80% and at 100%, once each: the bell and mail", async () => {
    const s = setup();
    limit(s, { writes_monthly: 5 });
    for (let i = 0; i < 7; i++) await put(s, `notes/${i}.md`);
    const mails = s.outbox.filter((m) => m.subject.includes("monthly writes"));
    expect(mails.map((m) => m.to)).toEqual([OWNER.email, OWNER.email]);
    expect(mails.map((m) => m.subject)).toEqual([
      "Your Tempra account has used 80% of its monthly writes",
      "Your Tempra account has reached its monthly writes limit",
    ]);
    expect(mails[1]?.text).toContain(`${ORIGIN}/account#usage`);

    // The bell: two `quota` items, opening the Account page's usage, done once opened.
    const inbox = (await (await s.app.request("/api/v1/inbox")).json()) as {
      items: { id: string; kind: string; title: string; excerpt: string; href: string }[];
      open: number;
    };
    const quota = inbox.items.filter((i) => i.kind === "quota");
    expect(quota.map((i) => i.excerpt)).toEqual([
      expect.stringContaining("Limit reached: 5 of 5"),
      "80% used: 4 of 5",
    ]);
    expect(quota.every((i) => i.href === "/account#usage" && i.title === "Writes this month")).toBe(
      true,
    );
    const done = await s.app.request(`/api/v1/inbox/${quota[0]?.id}/done`, {
      method: "POST",
      headers: { Origin: ORIGIN, "Content-Type": "application/json" },
      body: "{}",
    });
    expect(done.status).toBeLessThan(300);
    const count = (await (await s.app.request("/api/v1/inbox/count")).json()) as { open: number };
    expect(count.open).toBe(inbox.open - 1);
  });

  test("the Account page shows the month against the quotas", async () => {
    const s = setup();
    await put(s, "notes/a.md");
    await s.req("/files/notes/a.md");
    s.db.run("UPDATE libraries SET storage_bytes = 4096 WHERE id = ?", [LIB.id]);
    const m = await month(s);
    expect(m.writes).toEqual({ used: 1, limit: 100_000 });
    expect(m.requests).toEqual({ used: 2, limit: 10_000_000 });
    expect(m.storage).toEqual({ used: 4096, limit: 1024 * 1048576 });
    expect(m.resets).toBe(monthResets(m.month).toISOString());
  });
});

describe("over MCP", () => {
  test("a write past the quota is a tool error naming it; reads keep working", async () => {
    const s = setup();
    limit(s, { writes_monthly: 1 });
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

  test("past the request ceiling the MCP endpoint answers 403 quota_reached", async () => {
    const s = setup();
    const call = await mcp(s);
    expect((await call("read", { path: "notes/none.md" })).text).toBeTruthy();
    limit(s, { requests_monthly: 1 });
    const r = await s.anon.request("/mcp", {
      method: "POST",
      headers: {
        Authorization: "Bearer writer",
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(r.status).toBe(403);
    expect(((await r.json()) as { code: string }).code).toBe("quota_reached");
  });
});
