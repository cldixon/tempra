import { afterEach, describe, expect, mock, test } from "bun:test";
import { flushSync } from "svelte";
import { ApiError, cache } from "./src/api";
import { LibraryFeed } from "./src/live";
import { here } from "./src/location.svelte.ts";
import { lastNavigation, navigate } from "./src/router";
import { Urls } from "./src/urls";
import { settle } from "./test/dom";
import { box, rootFeed, rootLoad } from "./test/runes.svelte.ts";

/*
 * The rune foundations the pages stand on (load.svelte.ts, live.svelte.ts, location.svelte.ts):
 * when a load runs and when it must not, what a page keeps showing, and the feed's one
 * subscription per library. The gate drives them through the pages; these pin the rules.
 */

let n = 0;
/** A key no other test has used, so the shared page cache starts empty for it. */
const fresh = (name: string) => `test ${name} ${++n}`;

/** A load whose answers the test releases one by one. */
function loader<T>() {
  const calls: { resolve(v: T): void; reject(e: unknown): void }[] = [];
  const load = mock(
    () =>
      new Promise<T>((resolve, reject) => {
        calls.push({ resolve, reject });
      }),
  );
  return { load, calls };
}

const stops: (() => void)[] = [];
afterEach(() => {
  for (const s of stops.splice(0)) s();
});

describe("useLoad", () => {
  test("loads once, then shows the answer", async () => {
    const { load, calls } = loader<{ a: number }>();
    const r = rootLoad(() => fresh("once"), load);
    stops.push(r.stop);
    expect(r.loaded.state).toBe("loading");
    await settle();
    expect(load).toHaveBeenCalledTimes(1);
    calls[0]?.resolve({ a: 1 });
    await settle();
    expect(r.loaded.state).toBe("ready");
    expect(r.loaded.data).toEqual({ a: 1 });
  });

  test("a new object behind the same key does not load again", async () => {
    // The tree reloaded the outline on every page change while its Urls came from a derived
    // that made a new object each time (the gate's request budget caught it).
    const { load, calls } = loader<number>();
    const key = fresh("same");
    const owner = box({ key });
    const r = rootLoad(() => owner.v.key, load);
    stops.push(r.stop);
    await settle();
    calls[0]?.resolve(1);
    await settle();
    owner.v = { key };
    owner.v = { key };
    await settle();
    expect(load).toHaveBeenCalledTimes(1);
  });

  test("a new key loads afresh and an answer for the old key is dropped", async () => {
    const { load, calls } = loader<string>();
    const key = box(fresh("a"));
    const r = rootLoad(() => key.v, load);
    stops.push(r.stop);
    await settle();
    key.v = fresh("b");
    await settle();
    expect(load).toHaveBeenCalledTimes(2);
    expect(r.loaded.state).toBe("loading");
    calls[0]?.resolve("old");
    await settle();
    expect(r.loaded.state).toBe("loading");
    calls[1]?.resolve("new");
    await settle();
    expect(r.loaded.data).toBe("new");
  });

  test("reload asks again, and an unchanged answer keeps what is shown", async () => {
    const { load, calls } = loader<{ list: number[] }>();
    const r = rootLoad(() => fresh("reload"), load);
    stops.push(r.stop);
    await settle();
    calls[0]?.resolve({ list: [1, 2] });
    await settle();
    const shown = r.loaded.data;
    r.loaded.reload();
    await settle();
    expect(load).toHaveBeenCalledTimes(2);
    calls[1]?.resolve({ list: [1, 2] });
    await settle();
    expect(r.loaded.data).toBe(shown);
  });

  test("a page seen before draws at once from the cache, then checks again", async () => {
    const key = fresh("seen");
    const first = loader<string>();
    const a = rootLoad(() => key, first.load);
    await settle();
    first.calls[0]?.resolve("cached");
    await settle();
    a.stop();
    const again = loader<string>();
    const b = rootLoad(() => key, again.load);
    stops.push(b.stop);
    expect(b.loaded.data).toBe("cached");
    await settle();
    expect(again.load).toHaveBeenCalledTimes(1);
  });

  test("an answer is an error; over the limit, what was shown stays", async () => {
    const gone = loader<string>();
    const a = rootLoad(() => fresh("gone"), gone.load);
    stops.push(a.stop);
    await settle();
    gone.calls[0]?.reject(new ApiError(404, "not_found", "Not found"));
    await settle();
    expect(a.loaded.state).toBe("error");
    expect(a.loaded.error?.status).toBe(404);

    const key = fresh("limit");
    cache.put(key, "shown", 0);
    const busy = loader<string>();
    const b = rootLoad(() => key, busy.load);
    stops.push(b.stop);
    await settle();
    busy.calls[0]?.reject(new ApiError(429, "rate_limited", "Slow down"));
    await settle();
    expect(b.loaded.data).toBe("shown");
  });

  test("an answer after the page went away changes nothing", async () => {
    const key = fresh("away");
    const { load, calls } = loader<string>();
    const r = rootLoad(() => key, load);
    await settle();
    r.stop();
    calls[0]?.resolve("late");
    await settle();
    // Still cached for the next visit.
    expect(cache.get(key)).toBe("late");
  });
});

describe("useFeed", () => {
  test("one subscription per library; a new position syncs it", async () => {
    const subscribe = mock(
      () => ({ close: () => {} }) as unknown as ReturnType<LibraryFeed["subscribe"]>,
    );
    const sync = mock(() => {});
    const original = {
      subscribe: LibraryFeed.prototype.subscribe,
      sync: LibraryFeed.prototype.sync,
    };
    LibraryFeed.prototype.subscribe = subscribe as unknown as LibraryFeed["subscribe"];
    LibraryFeed.prototype.sync = sync as unknown as LibraryFeed["sync"];
    try {
      const urls = new Urls("ann", `feed-${++n}`);
      const holder = box({ urls });
      const from = box<number | null>(null);
      const r = rootFeed(
        () => holder.v.urls,
        () => from.v,
      );
      stops.push(r.stop);
      flushSync();
      expect(subscribe).toHaveBeenCalledTimes(1);
      expect(sync).toHaveBeenCalledTimes(0);
      from.v = 4;
      flushSync();
      expect(sync).toHaveBeenCalledTimes(1);
      // The page redrawn with the same library: no new subscription.
      holder.v = { urls };
      flushSync();
      expect(subscribe).toHaveBeenCalledTimes(1);
    } finally {
      LibraryFeed.prototype.subscribe = original.subscribe;
      LibraryFeed.prototype.sync = original.sync;
    }
  });
});

describe("the location", () => {
  // The address moves at once; the page's URL can wait for the next page's data (hold.test.ts).
  test("navigate moves here.address; back and forward are told apart", () => {
    navigate("/ann/notes/a.md");
    expect(here.address.pathname).toBe("/ann/notes/a.md");
    expect(lastNavigation()).toBe("push");
    history.pushState(null, "", "/ann/notes/b.md");
    window.dispatchEvent(new Event("popstate"));
    expect(here.address.pathname).toBe("/ann/notes/b.md");
    expect(lastNavigation()).toBe("pop");
  });
});
