import type { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import {
  BOOKMARK_COOKIE,
  carryBookmark,
  routedDb,
  sessionStart,
  withD1Session,
} from "../src/d1session";
import { bunD1 } from "./d1";
import { setup } from "./harness";

/**
 * D1 read replication through the Sessions API (TEMPRA-85): where a request's session starts, the
 * bookmark cookie a browser's write leaves, and read-your-writes against a replica that lags.
 */

const ORIGIN = "http://localhost";
const bm = (n: number) => `${n.toString(16).padStart(8, "0")}-00000000-00000000-${"0".repeat(32)}`;
const setCookie = (r: Response) =>
  (r.headers.get("Set-Cookie") ?? "")
    .split(/,\s*(?=[^;]+=)/)
    .find((c) => c.startsWith(`${BOOKMARK_COOKIE}=`)) ?? null;
const cookieValue = (c: string | null) =>
  c ? (c.split(";")[0] ?? "").split("=").slice(1).join("=") : null;

/**
 * D1 with one primary and one read replica that lags until asked to catch up, as D1 is with
 * replication on: writes go to the primary; a session's reads go to the replica once it is at
 * least as new as what the session has seen (its bookmark, or the primary for `first-primary`),
 * and as it is for `first-unconstrained`. `catchUp` replicates everything.
 */
function laggingD1() {
  const primary = bunD1();
  const replica = bunD1();
  /** Every write the primary took, in order; the replica has applied the first `applied`. */
  const log: { sql: string; params: unknown[] }[] = [];
  let applied = 0;
  const catchUp = (to: number) => {
    for (; applied < Math.min(to, log.length); applied++) {
      const w = log[applied] as { sql: string; params: unknown[] };
      replica.db.query(w.sql).run(...(w.params as never[]));
    }
  };
  const isWrite = (sql: string) => !/^\s*select\b/i.test(sql);

  const withSession = (start = "first-unconstrained") => {
    let seen =
      start === "first-primary"
        ? -1
        : start.startsWith("first-")
          ? 0
          : Number.parseInt(start.split("-")[0] ?? "", 16);
    let used = false;
    const on = (sql: string, params: unknown[] = []) => {
      const run = async <T>(go: (db: Database) => T): Promise<T> => {
        used = true;
        if (seen === -1) seen = log.length;
        if (isWrite(sql)) {
          const out = go(primary.db);
          log.push({ sql, params });
          seen = log.length;
          return out;
        }
        // A session ahead of the replica is answered no older than it has seen (D1 waits for the
        // replica; here the primary answers, so the replica stays behind for other sessions).
        if (seen > applied) return go(primary.db);
        seen = applied;
        return go(replica.db);
      };
      const args = params as never[];
      const stmt = {
        bind: (...p: unknown[]) => on(sql, p),
        first: <T>() => run((db) => (db.query(sql).get(...args) as T) ?? null),
        all: <T>() =>
          run((db) => ({ results: db.query(sql).all(...args) as T[], success: true, meta: {} })),
        run: () =>
          run((db) => ({
            results: [],
            success: true,
            meta: { changes: db.query(sql).run(...args).changes },
          })),
      };
      return stmt;
    };
    return {
      prepare: (sql: string) => on(sql),
      batch: async () => {
        throw new Error("not used here");
      },
      getBookmark: () => (used ? bm(seen) : null),
    };
  };
  const setup = (sql: string) => {
    primary.db.run(sql);
    replica.db.run(sql);
  };
  const d1 = {
    withSession,
    prepare: (sql: string) => withSession("first-primary").prepare(sql),
  } as unknown as D1Database;
  return { d1, setup, catchUp: () => catchUp(log.length), lag: () => log.length - applied };
}

const get = (cookie?: string, headers: Record<string, string> = {}) =>
  new Request(`${ORIGIN}/api/v1/me`, {
    headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}) },
  });
const post = (cookie?: string, headers: Record<string, string> = {}) =>
  new Request(`${ORIGIN}/api/v1/account`, {
    method: "PATCH",
    headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}) },
  });

describe("where a request's session starts", () => {
  test("a browser's read anywhere, or at its bookmark", () => {
    expect(sessionStart(get())).toBe("first-unconstrained");
    expect(sessionStart(get(`${BOOKMARK_COOKIE}=${bm(5)}`))).toBe(bm(5));
    expect(sessionStart(new Request(ORIGIN, { method: "HEAD" }))).toBe("first-unconstrained");
  });

  test("writes and tokens at the primary", () => {
    expect(sessionStart(post())).toBe("first-primary");
    expect(sessionStart(post(`${BOOKMARK_COOKIE}=${bm(5)}`))).toBe("first-primary");
    expect(sessionStart(get(undefined, { Authorization: "Bearer x" }))).toBe("first-primary");
  });

  test("a cookie that is not a bookmark is ignored", () => {
    for (const junk of ["", "x", "first-primary", "a;b", `${bm(1)}"`, "0".repeat(300)]) {
      expect(sessionStart(get(`${BOOKMARK_COOKIE}=${junk}`))).toBe("first-unconstrained");
    }
  });
});

describe("the bookmark cookie", () => {
  test("a browser's write carries a newer bookmark", () => {
    const r = carryBookmark(post(), new Response("ok"), bm(7));
    const c = setCookie(r);
    expect(c).toContain("HttpOnly");
    expect(c).toContain("Secure");
    expect(c).toContain("SameSite=Lax");
    expect(c).toContain("Path=/");
    expect(cookieValue(c)).toBe(bm(7));
  });

  test("never an older one, never on reads, never for tokens", () => {
    const older = carryBookmark(post(`${BOOKMARK_COOKIE}=${bm(9)}`), new Response(), bm(7));
    expect(setCookie(older)).toBeNull();
    expect(setCookie(carryBookmark(get(), new Response(), bm(7)))).toBeNull();
    expect(
      setCookie(
        carryBookmark(post(undefined, { Authorization: "Bearer x" }), new Response(), bm(7)),
      ),
    ).toBeNull();
    expect(setCookie(carryBookmark(post(), new Response(), null))).toBeNull();
  });

  test("a response with immutable headers is copied", async () => {
    const r = carryBookmark(post(), Response.redirect(`${ORIGIN}/x`, 303), bm(3));
    expect(r.status).toBe(303);
    expect(r.headers.get("Location")).toBe(`${ORIGIN}/x`);
    expect(cookieValue(setCookie(r))).toBe(bm(3));
  });
});

describe("read-your-writes against a lagging replica", () => {
  const scenario = () => {
    const d = laggingD1();
    d.setup("CREATE TABLE prefs (user TEXT PRIMARY KEY, theme TEXT)");
    const db = routedDb(d.d1);
    const theme = async () =>
      (await db.prepare("SELECT theme FROM prefs WHERE user = 'ann'").first<{ theme: string }>())
        ?.theme ?? null;
    const write = (cookie?: string) =>
      withD1Session(d.d1, post(cookie), async () => {
        await db.prepare("INSERT OR REPLACE INTO prefs VALUES ('ann', 'dark')").run();
        // The same session reads what it wrote, though the replica has not caught up.
        expect(await theme()).toBe("dark");
        return new Response("ok");
      });
    const read = async (cookie?: string) => {
      let seen = null as string | null;
      await withD1Session(d.d1, get(cookie), async () => {
        seen = await theme();
        return new Response("ok");
      });
      return seen;
    };
    return { d, write, read };
  };

  test("the next read with the write's bookmark sees it", async () => {
    const { d, write, read } = scenario();
    const res = await write();
    expect(d.lag()).toBe(1);
    const cookie = setCookie(res);
    expect(cookieValue(cookie)).toBe(bm(1));
    expect(await read(`${BOOKMARK_COOKIE}=${cookieValue(cookie)}`)).toBe("dark");
  });

  test("without it a read may see the replica before the write", async () => {
    const { d, write, read } = scenario();
    await write();
    expect(await read()).toBeNull();
    d.catchUp();
    expect(await read()).toBe("dark");
  });

  test("outside a request, queries reach the binding", async () => {
    const { d } = scenario();
    const db = routedDb(d.d1);
    await db.prepare("INSERT INTO prefs VALUES ('bo', 'light')").run();
    expect(
      await db.prepare("SELECT theme FROM prefs WHERE user = 'bo'").first<{ theme: string }>(),
    ).toEqual({ theme: "light" });
  });
});

describe("through the app", () => {
  test("a settings change hands back a bookmark that the next page starts at", async () => {
    const s = setup();
    const res = await s.app.request("/api/v1/account", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Origin: ORIGIN },
      body: JSON.stringify({ theme: "dark" }),
    });
    expect(res.status).toBe(200);
    const value = cookieValue(setCookie(res));
    expect(value).not.toBeNull();
    expect(s.d1Starts.at(-1)).toBe("first-primary");

    const me = await s.app.request("/api/v1/me", {
      headers: { Cookie: `${BOOKMARK_COOKIE}=${value}` },
    });
    expect(me.status).toBe(200);
    expect(s.d1Starts.at(-1)).toBe(value as unknown as string);
    expect(setCookie(me)).toBeNull();
    expect(((await me.json()) as { theme?: string }).theme).toBe("dark");
  });

  test("a page without one starts anywhere; a token at the primary", async () => {
    const s = setup();
    expect((await s.app.request("/api/v1/me")).status).toBe(200);
    expect(s.d1Starts.at(-1)).toBe("first-unconstrained");
    expect((await s.req("/stats")).status).toBe(200);
    expect(s.d1Starts.at(-1)).toBe("first-primary");
  });
});
