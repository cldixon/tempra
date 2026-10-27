import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { flushSync } from "svelte";
import { api } from "./src/api";
import { Urls } from "./src/urls";
import { due, libraryOf, touched, WAKE_AFTER_MS } from "./src/wake";
import { rootWake } from "./test/runes.svelte.ts";

/*
 * Waking a library before the person clicks (TEMPRA-195, wake.ts and wake.svelte.ts): which calls
 * count as the library being awake, and when the hook sends its one cheap call.
 */

let n = 0;
/** A library no other test has touched. */
const fresh = () => new Urls("ann", `wake-${++n}`);

let asked: string[] = [];
const realFetch = globalThis.fetch;
beforeEach(() => {
  asked = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    asked.push(new URL(String(input), location.origin).pathname);
    return new Response('{"seq":1}', { headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  Object.defineProperty(document, "hidden", { value: false, configurable: true });
});

const stats = () => asked.filter((p) => p.endsWith("/stats"));
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("wake.ts", () => {
  test("a library API URL's library, relative or not; nothing else is one", () => {
    expect(libraryOf("/api/v1/libraries/ann/notes/page/a.md?at=2")).toBe(
      "/api/v1/libraries/ann/notes/",
    );
    expect(libraryOf("https://app.tempra.dev/api/v1/libraries/ann/notes/stats")).toBe(
      "/api/v1/libraries/ann/notes/",
    );
    expect(libraryOf("/api/v1/libraries")).toBeNull();
    expect(libraryOf("/api/v1/me")).toBeNull();
  });

  test("due until asked, then not for a minute", () => {
    const lib = libraryOf(fresh().api("stats")) as string;
    expect(due(lib, 1_000)).toBe(true);
    touched(`${lib}outline`, 1_000);
    expect(due(lib, 1_000 + WAKE_AFTER_MS - 1)).toBe(false);
    expect(due(lib, 1_000 + WAKE_AFTER_MS)).toBe(true);
  });

  test("any call to a library through api() counts", async () => {
    const urls = fresh();
    await api(urls.api("outline"));
    expect(due(libraryOf(urls.api("stats")) as string)).toBe(false);
  });
});

describe("useWake", () => {
  test("the first sign of the person after a quiet spell sends one call, not one per move", async () => {
    const urls = fresh();
    const stop = rootWake(urls);
    flushSync();
    for (let i = 0; i < 5; i++) document.dispatchEvent(new Event("pointermove"));
    document.dispatchEvent(new Event("keydown"));
    await settle();
    expect(stats()).toEqual([urls.api("stats")]);
    stop();
  });

  test("a library just asked for something is left alone", async () => {
    const urls = fresh();
    await api(urls.api("outline"));
    const stop = rootWake(urls);
    flushSync();
    document.dispatchEvent(new Event("pointermove"));
    await settle();
    expect(stats()).toEqual([]);
    stop();
  });

  test("nothing while the tab is hidden; the tab shown again wakes it", async () => {
    const urls = fresh();
    const stop = rootWake(urls);
    flushSync();
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    document.dispatchEvent(new Event("pointermove"));
    document.dispatchEvent(new Event("visibilitychange"));
    await settle();
    expect(stats()).toEqual([]);
    Object.defineProperty(document, "hidden", { value: false, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    await settle();
    expect(stats()).toEqual([urls.api("stats")]);
    stop();
  });

  test("gone with the frame", async () => {
    const stop = rootWake(fresh());
    flushSync();
    stop();
    document.dispatchEvent(new Event("pointermove"));
    await settle();
    expect(stats()).toEqual([]);
  });
});
