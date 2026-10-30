import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { flushSync } from "svelte";
import { actorView } from "./src/agents";
import Byline from "./src/concept/Byline.svelte";
import type { Concept, HistoryEvent } from "./src/concept/data";
import { type FeedEvent, feedOf, LibraryFeed } from "./src/live";
import { activeFolders, type PresenceMessage, PresenceStore } from "./src/presence";
import Tree from "./src/Tree.svelte";
import type { OutlineFile } from "./src/tree";
import { Urls } from "./src/urls";
import { draw, settle } from "./test/dom";

// Agents' presence (TEMPRA-219): what an agent reads, searches and writes now, from the feed, in
// the tree and the byline, fading after a few seconds.

const reading = (paths: string[], actor = "claude-code/dev"): PresenceMessage => ({
  type: "presence",
  kind: "reading",
  actor,
  by: { person: "u1", agent: "agt_1" },
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
});

describe("the presence store (presence.ts)", () => {
  test("the most recent per file; people never; folders above a marked file", () => {
    let now = 1000;
    const p = new PresenceStore(() => now, 8000);
    p.add(reading(["a/b/one.md", "two.md"]));
    p.add(reading(["three.md"], "human:dev"));
    expect([...p.active().keys()]).toEqual(["a/b/one.md", "two.md"]);
    now = 2000;
    p.add({ ...reading(["two.md"]), kind: "searching" });
    expect(p.active().get("two.md")).toMatchObject({ kind: "searching", at: 2000 });
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
beforeEach(() => {
  globalThis.WebSocket = NoSocket as unknown as typeof WebSocket;
  localStorage.clear();
});
afterEach(() => {
  globalThis.WebSocket = realSocket;
});

const OUTLINE: OutlineFile[] = [
  { path: "guides/start.md", kind: "concept", title: "Start", seq: 1 },
  { path: "guides/deep/more.md", kind: "concept", title: "More", seq: 2 },
  { path: "top.md", kind: "concept", title: "Top", seq: 3 },
];

describe("the tree shows presence (Tree.svelte)", () => {
  test("a marked file's name shimmers; a closed folder holding one shows the quieter mark", async () => {
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
    expect(row?.closest(".tree-row")?.textContent).toBe("Morean agent is reading");
    expect(t.host.querySelector('a[data-path="top.md"]')?.classList.contains("presence")).toBe(
      false,
    );
    // Open folders leave it to their rows; closed, a folder says something is going on inside.
    expect(t.host.querySelector(".presence-mark")).toBeNull();
    t.host.querySelector<HTMLButtonElement>('button.tree-name[title="Guides"]')?.click();
    flushSync();
    const guides = t.host.querySelector('button.tree-name[title="Guides"]')?.closest(".tree-row");
    expect(guides?.querySelector(".presence-mark")).not.toBeNull();
    t.destroy();
  });
});

const concept = {
  kind: "concept",
  path: "top.md",
  hash: "h2",
  seq: 2,
  markdown: "",
  frontmatter: {},
  stale: false,
} as unknown as Concept;
const history: HistoryEvent[] = [
  {
    seq: 2,
    ts: "2026-10-01T00:00:00Z",
    actor: "human:dev",
    op: "put",
    path: "top.md",
    hash: "h2",
    meta: null,
  },
];
const name = (actor: string, by?: { person: string; agent?: string } | null) =>
  actorView(actor, by ?? null, {}, null);

describe("the byline shows an agent reading (Byline.svelte)", () => {
  test("named, then reading now; only on the latest version", () => {
    const props = { concept, history, name, live: null, current: true };
    const b = draw(Byline, { ...props, reading: { actor: "claude-code/dev", by: null } });
    const clause = b.host.querySelector(".byline-presence");
    expect(clause?.textContent).toBe("Claude Code is reading now");
    expect(clause?.querySelector(".presence-text")?.textContent).toBe("is reading now");
    b.destroy();
    const old = draw(Byline, {
      ...props,
      current: false,
      reading: { actor: "claude-code/dev", by: null },
    });
    expect(old.host.querySelector(".byline-presence")).toBeNull();
    old.destroy();
    const none = draw(Byline, { ...props, reading: null });
    expect(none.host.querySelector(".byline-presence")).toBeNull();
    none.destroy();
  });

  test("the agent that wrote the version on screen is named once", () => {
    const own: HistoryEvent[] = [
      { ...(history[0] as HistoryEvent), actor: "claude-code/dev", ts: "2026-10-01T00:00:00Z" },
    ];
    const b = draw(Byline, {
      concept,
      history: own,
      name,
      live: null,
      current: true,
      reading: { actor: "claude-code/dev", by: null },
    });
    expect(b.host.querySelector(".byline-presence")?.textContent).toBe("reading now");
    b.destroy();
  });
});
