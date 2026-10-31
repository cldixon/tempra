import { describe, expect, test } from "bun:test";
import { FRESH_MS, PageCache, share } from "./src/cache";

describe("PageCache", () => {
  test("an older request never overwrites a newer answer", () => {
    const c = new PageCache();
    c.put("k", "new", 20);
    c.put("k", "old", 10);
    expect(c.get("k")).toBe("new");
    c.put("k", "newer", 30);
    expect(c.get("k")).toBe("newer");
  });

  test("an answer is fresh for a few seconds after it was asked for (TEMPRA-103)", () => {
    let now = 0;
    const c = new PageCache(100, () => now);
    expect(c.fresh("missing")).toBe(false);
    c.put("page", "loaded", 0);
    now = FRESH_MS - 1;
    expect(c.fresh("page")).toBe(true);
    now = FRESH_MS;
    expect(c.fresh("page")).toBe(false);
    // Seldom-changing data keeps longer.
    expect(c.fresh("page", 60_000)).toBe(true);
  });

  test("a write on the feed makes what was asked for before it stale", () => {
    let now = 0;
    const c = new PageCache(100, () => now);
    c.put("page", "before", 0);
    c.put("libraries", "the person's", 0);
    now = 100;
    c.wrote();
    expect(c.fresh("page")).toBe(false);
    // The person's libraries, their account and a library's members are not a library's writes.
    expect(c.fresh("libraries", FRESH_MS, false)).toBe(true);
    now = 200;
    c.put("page", "after", 150);
    expect(c.fresh("page")).toBe(true);
    // A request that started before the write but answered after it may have missed it.
    c.put("slow", "raced", 50);
    expect(c.fresh("slow")).toBe(false);
  });

  test("an entry told it changed is stale until answered by a later request", () => {
    let now = 0;
    const c = new PageCache(100, () => now);
    c.put("bell", "two items", 0);
    now = 10;
    c.stale("bell");
    expect(c.get("bell")).toBe("two items");
    expect(c.fresh("bell", 60_000, false)).toBe(false);
    // A request that started before the change answers late: still stale.
    c.put("bell", "two items, late", 5);
    expect(c.fresh("bell", 60_000, false)).toBe(false);
    c.put("bell", "one item", 20);
    expect(c.fresh("bell", 60_000, false)).toBe(true);
  });

  test("tells whoever watches a key of each newer answer, until they stop", () => {
    const c = new PageCache();
    const seen: unknown[] = [];
    const stop = c.watch("k", (d) => seen.push(d));
    c.put("k", "a", 2);
    c.put("k", "older", 1);
    c.put("other", "x", 3);
    stop();
    c.put("k", "b", 4);
    expect(seen).toEqual(["a"]);
  });

  test("keeps the most recently used entries", () => {
    const c = new PageCache(2);
    c.put("a", 1, 1);
    c.put("b", 2, 2);
    c.put("a", 3, 3);
    c.put("c", 4, 4);
    expect(c.has("a")).toBe(true);
    expect(c.has("b")).toBe(false);
    expect(c.has("c")).toBe(true);
  });
});

describe("share", () => {
  test("an unchanged answer is the old object itself", () => {
    const prev = { file: { path: "a.md", body: "x" }, head: 3, list: [1, 2] };
    expect(share(prev, JSON.parse(JSON.stringify(prev)))).toBe(prev);
  });

  test("a changed answer keeps the identity of its unchanged parts", () => {
    const prev = { file: { path: "a.md", body: "x" }, head: 3, history: [{ seq: 1 }] };
    const next = { file: { path: "a.md", body: "x" }, head: 4, history: [{ seq: 1 }, { seq: 4 }] };
    const out = share(prev, next);
    expect(out).not.toBe(prev);
    expect(out).toEqual(next);
    expect(out.file).toBe(prev.file);
    expect(out.history[0]).toBe(prev.history[0]);
  });

  test("added and removed keys count as changes", () => {
    expect(share({ a: 1 }, { a: 1, b: 2 })).toEqual({ a: 1, b: 2 });
    const prev = { a: 1, b: 2 };
    expect(share(prev, { a: 1 })).not.toBe(prev);
    expect(share(undefined, { a: 1 })).toEqual({ a: 1 });
  });
});
