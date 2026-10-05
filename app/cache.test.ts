import { describe, expect, test } from "bun:test";
import { PageCache, share } from "./src/cache";

describe("PageCache", () => {
  test("an older request never overwrites a newer answer", () => {
    const c = new PageCache();
    c.put("k", "new", 20);
    c.put("k", "old", 10);
    expect(c.get("k")).toBe("new");
    c.put("k", "newer", 30);
    expect(c.get("k")).toBe("newer");
  });

  test("only a fresh prefetch spares the page from asking again, and only once", () => {
    let now = 0;
    const c = new PageCache(100, 5000, () => now);
    c.put("own", "loaded by the page", 0);
    expect(c.takeFresh("own")).toBe(false);
    c.put("hovered", "prefetched", 0, true);
    expect(c.fresh("hovered")).toBe(true);
    expect(c.takeFresh("hovered")).toBe(true);
    expect(c.takeFresh("hovered")).toBe(false);
    c.put("late", "prefetched", 0, true);
    now = 6000;
    expect(c.takeFresh("late")).toBe(false);
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
