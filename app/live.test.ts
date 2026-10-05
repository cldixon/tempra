import { describe, expect, test } from "bun:test";
import { type FeedEvent, LibraryFeed, type Message } from "./src/live";
import { Urls } from "./src/urls";

// The feed client (app/src/live.ts) without a browser: a fake socket and a fake ledger.

(globalThis as { location?: unknown }).location ??= { href: "http://localhost/ann/notes/" };
(globalThis as { WebSocket?: unknown }).WebSocket ??= { OPEN: 1 };

const ev = (seq: number, path = `p${seq}.md`): FeedEvent => ({
  seq,
  ts: "2026-10-05T00:00:00Z",
  actor: "claude-code/agent",
  request_id: `r${seq}`,
  op: "put",
  path,
  concept_id: `c${seq}`,
  hash: null,
  note: null,
  from_path: null,
});

/** A feed whose ledger holds events 1..head; `read` can be held to stage races. */
function harness() {
  const ledger: FeedEvent[] = [];
  const holds: (() => void)[] = [];
  let hold = false;
  let failNext = false;
  // A read sees the ledger as it was when the request was served (its start).
  const read = async (_urls: Urls, since: number) => {
    const served = ledger.filter((e) => e.seq > since);
    if (hold) await new Promise<void>((r) => holds.push(r));
    if (failNext) {
      failNext = false;
      throw new Error("offline");
    }
    return served;
  };
  const sockets: { onmessage?: unknown }[] = [];
  const feed = new LibraryFeed(
    new Urls("ann", "notes"),
    () => {
      const ws = {} as WebSocket;
      sockets.push(ws);
      return ws;
    },
    read,
  );
  const heard: number[] = [];
  let resets = 0;
  const sub = feed.subscribe({
    events: (events) => heard.push(...events.map((e) => e.seq)),
    reset: () => resets++,
  });
  const commit = (n: number) => {
    for (let i = 0; i < n; i++) ledger.push(ev(ledger.length + 1));
  };
  const send = (m: Message) => feed.receive(m);
  const tick = () => new Promise((r) => setTimeout(r, 0));
  return {
    feed,
    sub,
    heard,
    resets: () => resets,
    commit,
    send,
    tick,
    ledger,
    hold: (on: boolean) => {
      hold = on;
      if (!on) for (const r of holds.splice(0)) r();
    },
    failNext: () => {
      failNext = true;
    },
  };
}

describe("LibraryFeed", () => {
  test("events that committed while the page loaded are handed to it once it syncs", async () => {
    const h = harness();
    h.commit(12);
    // The page read the ledger at 10; the socket opened after 11 and 12 committed.
    h.send({ type: "hello", head: 12 });
    h.feed.sync(h.sub, 10);
    await h.tick();
    expect(h.heard).toEqual([11, 12]);
    // From then on, live, once each.
    h.commit(1);
    h.send({ type: "events", head: 13, events: [ev(13)] });
    expect(h.heard).toEqual([11, 12, 13]);
  });

  test("a page that syncs before the socket says hello still hears what it missed", async () => {
    const h = harness();
    h.commit(5);
    h.feed.sync(h.sub, 3);
    h.send({ type: "hello", head: 5 });
    await h.tick();
    expect(h.heard).toEqual([4, 5]);
  });

  test("events arriving during a replay follow it, in order, without duplicates", async () => {
    const h = harness();
    h.commit(10);
    h.send({ type: "hello", head: 10 });
    h.hold(true);
    h.feed.sync(h.sub, 8);
    h.commit(1);
    h.send({ type: "events", head: 11, events: [ev(11)] });
    expect(h.heard).toEqual([]);
    h.hold(false);
    await h.tick();
    expect(h.heard).toEqual([9, 10, 11]);
  });

  test("a gap seen during a catch-up runs it again, so the later event is not lost", async () => {
    const h = harness();
    h.commit(10);
    h.send({ type: "hello", head: 10 });
    h.commit(2);
    h.hold(true);
    // 11 and 12 committed; the socket missed them and says the head is 12: catch up.
    h.send({ type: "hello", head: 12 });
    // While that read is in flight (it will return 11 and 12), 14 arrives after 13 commits.
    h.commit(2);
    h.send({ type: "events", head: 14, events: [ev(14)] });
    h.hold(false);
    await h.tick();
    await h.tick();
    expect(h.heard).toEqual([11, 12, 13, 14]);
  });

  test("a failed catch-up is retried", async () => {
    const h = harness();
    h.commit(3);
    h.send({ type: "hello", head: 3 });
    h.commit(2);
    h.failNext();
    h.send({ type: "events", head: 5, events: [ev(5)] });
    await h.tick();
    expect(h.heard).toEqual([]);
    await new Promise((r) => setTimeout(r, 2100));
    expect(h.heard).toEqual([4, 5]);
  });

  test("a restore (the head goes back) resets the pages and follows the new head", async () => {
    const h = harness();
    h.commit(20);
    h.send({ type: "hello", head: 20 });
    // Restored to 12; the next write is 13.
    h.ledger.splice(12);
    h.send({ type: "hello", head: 12 });
    expect(h.resets()).toBe(1);
    h.commit(1);
    h.send({ type: "events", head: 13, events: [ev(13)] });
    expect(h.heard).toEqual([13]);
  });
});
