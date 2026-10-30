import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { flushSync } from "svelte";
import { type FeedEvent, feedOf, LibraryFeed } from "./src/live";
import { activeFolders, type PresenceMessage, PresenceStore } from "./src/presence";
import Tree from "./src/Tree.svelte";
import type { OutlineFile } from "./src/tree";
import { Urls } from "./src/urls";
import { draw, settle } from "./test/dom";

// Agents' presence (TEMPRA-219): what an agent reads and writes now, from the feed, as a shimmer
// on the tree's rows (no words beside it; a hover names the agent), fading after a few seconds.

const BY = { person: "u1", agent: "agt_1" };

const reading = (paths: string[], actor = "claude-code/dev"): PresenceMessage => ({
  type: "presence",
  kind: "reading",
  actor,
  by: BY,
  paths,
});

const write = (seq: number, path: string, actor = "claude-code/dev"): FeedEvent => ({
  seq,
  ts: "2026-10-30T00:00:00Z",
  actor,
  request_id: `r${seq}`,
  op: "put",
  path,
  concept_id: `c${seq}`,
  hash: "h",
  note: null,
  from_path: null,
  by: BY,
});

describe("the presence store (presence.ts)", () => {
  test("the most recent per file; people never; folders above a marked file", () => {
    let now = 1000;
    const p = new PresenceStore(() => now, 8000);
    p.add(reading(["a/b/one.md", "two.md"]));
    p.add(reading(["three.md"], "human:dev"));
    expect([...p.active().keys()]).toEqual(["a/b/one.md", "two.md"]);
    now = 2000;
    p.events([write(1, "two.md")]);
    expect(p.active().get("two.md")).toMatchObject({ kind: "writing", at: 2000 });
    now = 3000;
    p.add(reading(["two.md"]));
    expect(p.active().get("two.md")).toMatchObject({ kind: "reading", at: 3000 });
    expect([...activeFolders(p.active())].sort()).toEqual(["a", "a/b"]);
  });

  test("an agent's write is writing; a person's, a comment or a delete is not", () => {
    const p = new PresenceStore(() => 0, 8000);
    p.events([
      write(1, "a.md"),
      write(2, "b.md", "human:dev"),
      { ...write(3, "c.md"), op: "comment" },
      { ...write(4, "d.md"), op: "delete" },
      { ...write(5, "e.md"), op: "move", from_path: "two.md" },
    ]);
    expect([...p.active().entries()].map(([k, v]) => [k, v.kind])).toEqual([
      ["a.md", "writing"],
      ["e.md", "writing"],
    ]);
  });

  test("a mark fades after its time, and the watchers hear it go", async () => {
    const p = new PresenceStore(Date.now, 30);
    let heard = 0;
    p.watch(() => heard++);
    p.add(reading(["a.md"]));
    expect(heard).toBe(1);
    expect(p.active().has("a.md")).toBe(true);
    await new Promise((r) => setTimeout(r, 120));
    expect(heard).toBe(2);
    expect(p.active().size).toBe(0);
  });

  test("the feed keeps presence apart from the ledger: no cursor moves, no listener hears it", () => {
    (globalThis as { location?: unknown }).location ??= { href: "http://localhost/" };
    const feed = new LibraryFeed(new Urls("ann", "presence"), () => ({}) as WebSocket);
    const heard: number[] = [];
    feed.subscribe({ events: (e) => heard.push(...e.map((x) => x.seq)), reset: () => {} });
    feed.receive({ type: "hello", head: 3 });
    feed.receive(reading(["x.md"]));
    expect(feed.presence.active().get("x.md")?.kind).toBe("reading");
    feed.receive({ type: "events", head: 4, events: [write(4, "y.md")] });
    expect(heard).toEqual([4]);
    expect(feed.presence.active().get("y.md")?.kind).toBe("writing");
  });
});

class NoSocket {
  static OPEN = 1;
  readyState = 0;
  addEventListener() {}
  removeEventListener() {}
  close() {}
  send() {}
}
const realSocket = globalThis.WebSocket;
const realFetch = globalThis.fetch;
beforeEach(() => {
  globalThis.WebSocket = NoSocket as unknown as typeof WebSocket;
  localStorage.clear();
  // The library's agents, so a hover names the agent for its person.
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const body = String(input).includes("/agents")
      ? {
          contributors: [
            {
              person: "dev",
              agent: { id: "agt_1", name: "Claude Code", platform: null, client: null },
              actor: "claude-code/dev",
              requests: 1,
              last_ts: "2026-10-30T00:00:00Z",
            },
          ],
        }
      : {};
    return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.WebSocket = realSocket;
  globalThis.fetch = realFetch;
});

const OUTLINE: OutlineFile[] = [
  { path: "guides/start.md", kind: "concept", title: "Start", seq: 1 },
  { path: "guides/deep/more.md", kind: "concept", title: "More", seq: 2 },
  { path: "top.md", kind: "concept", title: "Top", seq: 3 },
];

describe("the tree shows presence (Tree.svelte)", () => {
  test("a marked name shimmers with no words shown; a hover names the agent", async () => {
    const urls = new Urls("dev", "presence-tree");
    const t = draw(Tree, {
      urls,
      file: null,
      dir: null,
      files: OUTLINE,
      failed: false,
      onRetry: () => {},
    });
    await settle(10);
    expect(t.host.querySelector("a.presence")).toBeNull();
    feedOf(urls).receive(reading(["guides/deep/more.md"]));
    flushSync();
    const row = t.host.querySelector<HTMLAnchorElement>('a[data-path="guides/deep/more.md"]');
    expect(row?.classList.contains("presence")).toBe(true);
    expect(row?.dataset.presence).toBe("reading");
    // The name alone is shown; the words are for screen readers only.
    expect(row?.textContent).toBe("More");
    const hidden = row?.closest(".tree-row")?.querySelector(".visually-hidden");
    expect(hidden?.textContent).toBe("an agent is reading");
    expect(row?.getAttribute("title")).toBe("More: Claude Code for @dev is reading");
    const top = t.host.querySelector<HTMLAnchorElement>('a[data-path="top.md"]');
    expect(top?.classList.contains("presence")).toBe(false);
    expect(top?.getAttribute("title")).toBe("Top");
    // A write shimmers too, and says so on hover.
    feedOf(urls).receive({ type: "events", head: 9, events: [write(9, "top.md")] });
    flushSync();
    expect(top?.dataset.presence).toBe("writing");
    expect(top?.getAttribute("title")).toBe("Top: Claude Code for @dev is writing");
    t.destroy();
  });

  test("a closed folder holding a marked file shows the quieter mark; an open one does not", async () => {
    const urls = new Urls("dev", "presence-folder");
    const t = draw(Tree, {
      urls,
      file: null,
      dir: null,
      files: OUTLINE,
      failed: false,
      onRetry: () => {},
    });
    await settle(10);
    feedOf(urls).receive(reading(["guides/deep/more.md"]));
    flushSync();
    expect(t.host.querySelector(".presence-mark")).toBeNull();
    t.host.querySelector<HTMLButtonElement>('button.tree-name[title="Guides"]')?.click();
    flushSync();
    const guides = t.host.querySelector('button.tree-name[title="Guides"]')?.closest(".tree-row");
    expect(guides?.querySelector(".presence-mark")).not.toBeNull();
    t.destroy();
  });
});
