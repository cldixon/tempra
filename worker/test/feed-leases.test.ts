import { describe, expect, test } from "bun:test";
import { FeedLeases, LEASE_GRACE_MS, type LiveLeases } from "../src/feed-leases";
import { bunSqlHandle } from "./sqlite";

// The per-account cap on change-feed sockets (TEMPRA-80): leases, checked against the libraries
// only when the cap is reached.
describe("FeedLeases", () => {
  const T0 = 1_000_000;
  const later = T0 + LEASE_GRACE_MS + 1;

  test("leases up to the cap without asking any library", async () => {
    const leases = new FeedLeases(bunSqlHandle());
    let asked = 0;
    const live: LiveLeases = async () => {
      asked++;
      return [];
    };
    for (let i = 0; i < 3; i++) {
      expect(await leases.acquire({ id: `l${i}`, doId: "a" }, 3, live, T0)).toBe(true);
    }
    expect(asked).toBe(0);
    expect(leases.count()).toBe(3);
  });

  test("at the cap, forgets the leases whose sockets closed, and refuses while all are open", async () => {
    const leases = new FeedLeases(bunSqlHandle());
    const open = new Map([
      ["a", new Set(["l0", "l1"])],
      ["b", new Set(["l2"])],
    ]);
    const asked: string[] = [];
    const live: LiveLeases = async (doId) => {
      asked.push(doId);
      return [...(open.get(doId) ?? [])];
    };
    await leases.acquire({ id: "l0", doId: "a" }, 3, live, T0);
    await leases.acquire({ id: "l1", doId: "a" }, 3, live, T0);
    await leases.acquire({ id: "l2", doId: "b" }, 3, live, T0);
    // All three open: refused, and each library asked once.
    expect(await leases.acquire({ id: "l3", doId: "b" }, 3, live, later)).toBe(false);
    expect(asked.sort()).toEqual(["a", "b"]);
    // One closes: the next connect takes its place.
    open.get("a")?.delete("l1");
    expect(await leases.acquire({ id: "l4", doId: "b" }, 3, live, later)).toBe(true);
    expect(leases.count()).toBe(3);
  });

  test("a lease younger than the grace period is kept: its socket may not be accepted yet", async () => {
    const leases = new FeedLeases(bunSqlHandle());
    const live: LiveLeases = async () => [];
    await leases.acquire({ id: "old", doId: "a" }, 2, live, T0);
    await leases.acquire({ id: "new", doId: "a" }, 2, live, later - 10);
    expect(await leases.acquire({ id: "x", doId: "a" }, 2, live, later)).toBe(true);
    // "old" was forgotten; "new" stays.
    expect(leases.count()).toBe(2);
    expect(await leases.acquire({ id: "y", doId: "a" }, 2, live, later)).toBe(false);
  });

  test("a library that cannot answer keeps its leases; one that is gone frees them", async () => {
    const leases = new FeedLeases(bunSqlHandle());
    await leases.acquire({ id: "l0", doId: "flaky" }, 2, async () => [], T0);
    await leases.acquire({ id: "l1", doId: "gone" }, 2, async () => [], T0);
    const live: LiveLeases = async (doId) => {
      if (doId === "flaky") throw new Error("restarting");
      return null;
    };
    expect(await leases.acquire({ id: "l2", doId: "gone" }, 2, live, later)).toBe(true);
    expect(await leases.acquire({ id: "l3", doId: "gone" }, 2, live, later)).toBe(false);
  });
});
