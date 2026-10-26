import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createRawSnippet, flushSync } from "svelte";
import AccountFrame from "./src/AccountFrame.svelte";
import Tree from "./src/Tree.svelte";
import { buildDirs, type OutlineFile, rollUp } from "./src/tree";
import { Urls } from "./src/urls";
import { draw, settle } from "./test/dom";

/** The DOM's text without Svelte's comment anchors. */
const html = (el: Element) => el.innerHTML.replace(/<!---->/g, "");

const OUTLINE: OutlineFile[] = [
  { path: "b/z.md", kind: "concept", title: "Zebra", seq: 3 },
  { path: "b/a.md", kind: "concept", title: "Apple", seq: 4, comments: 2 },
  { path: "b/pic.png", kind: "attachment", seq: 5 },
  { path: "b/c/deep.md", kind: "concept", title: "Deep", seq: 6, stale: "stale" },
  { path: "a/one.md", kind: "concept", title: "One", seq: 7 },
  { path: "top.md", kind: "concept", title: "Top", seq: 8, stale: "stale_soon" },
];

class NoSocket {
  static OPEN = 1;
  readyState = 0;
  addEventListener() {}
  removeEventListener() {}
  close() {}
  send() {}
}

// Svelte asks whether an element is media when it sets some attributes; the shared DOM lacks it.
const g = globalThis as Record<string, unknown>;
g.HTMLMediaElement ??= (window as unknown as Record<string, unknown>).HTMLMediaElement;

const realFetch = globalThis.fetch;
const realSocket = globalThis.WebSocket;
beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  globalThis.WebSocket = NoSocket as unknown as typeof WebSocket;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.includes("/outline")
      ? { seq: 8, files: OUTLINE }
      : url.includes("/events")
        ? { events: [], seq: 8 }
        : url.includes("/inbox/count")
          ? { unread: 2 }
          : url.includes("/api/v1/libraries")
            ? {
                libraries: [
                  { owner: "dev", slug: "dev", title: "Dev" },
                  { owner: "ann", slug: "notes", title: "Notes", role: "read" },
                ],
              }
            : {};
    return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  globalThis.WebSocket = realSocket;
});

describe("the tree's rules (Tree.svelte, tree.ts)", () => {
  test("folders, then pages, then files, each by the name shown", () => {
    const dirs = buildDirs(OUTLINE);
    expect((dirs[""] ?? []).map((e) => e.path)).toEqual(["a", "b", "top.md"]);
    expect((dirs.b ?? []).map((e) => e.path)).toEqual(["b/c", "b/a.md", "b/z.md", "b/pic.png"]);
    expect(rollUp(OUTLINE.filter((f) => f.path.startsWith("b/")))).toEqual({
      comments: 2,
      stale: "stale",
    });
  });

  test("every folder starts open; a closed one rolls up its marks and is remembered", async () => {
    const urls = new Urls("dev", "dev");
    const t = draw(Tree, {
      urls,
      file: "b/a.md",
      dir: null,
      files: OUTLINE,
      failed: false,
      onRetry: () => {},
    });
    await settle(10);
    const rows = [...t.host.querySelectorAll(".tree-row")].map((r) => r.textContent);
    expect(rows).toEqual([
      "A, 1 page1",
      "One",
      "B, 3 pages3",
      "C, 1 page1",
      "Deepstale",
      "Apple22 open comments",
      "Zebra",
      "pic.png",
      "Topstale soon",
    ]);
    expect(t.host.querySelector('a[aria-current="page"]')?.getAttribute("data-path")).toBe(
      "b/a.md",
    );
    expect(html(t.host)).toContain('<div class="tree-row file"><span class="tree-leaf"><svg');
    expect(html(t.host)).not.toMatch(/> </);
    const b = t.host.querySelector<HTMLButtonElement>('button.tree-name[title="B"]');
    expect(b?.getAttribute("aria-expanded")).toBe("true");
    b?.click();
    flushSync();
    expect(b?.getAttribute("aria-expanded")).toBe("false");
    expect(b?.closest(".tree-row")?.textContent).toBe("B, 3 pages322 open commentsstale");
    expect(localStorage.getItem("tempra:tree-closed:dev/dev")).toBe('["b"]');
    t.destroy();
  });
});

describe("the account's frame (AccountFrame.svelte)", () => {
  test("the bar, the sidebar and the page", async () => {
    const children = createRawSnippet(() => ({ render: () => "<p>Page</p>" }));
    const f = draw(AccountFrame, { page: "libraries", me: null, children });
    await settle(10);
    const brand = f.host.querySelector(".topbar-brand");
    expect(brand?.textContent).toBe("TTempra");
    expect(brand?.querySelector("button.search-button")?.getAttribute("aria-label")).toBe("Search");
    expect(f.host.querySelector("main.ws-main")?.textContent?.trim()).toBe("Page");
    const rows = [...f.host.querySelectorAll(".nav-row")].map((r) => r.textContent);
    expect(rows).toEqual(["Libraries", "Inbox 2 unread", "DDev", "NNotes (@ann)"]);
    expect(f.host.querySelector("section.ws-sidebar")?.hasAttribute("hidden")).toBe(false);
    f.destroy();
  });
});
