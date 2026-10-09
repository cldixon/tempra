import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { Urls } from "./urls";

/** One committed ledger event, as the change feed sends it (worker/src/feed.ts). */
export interface FeedEvent {
  seq: number;
  ts: string;
  actor: string;
  request_id: string;
  op: string;
  path: string;
  concept_id: string;
  hash: string | null;
  note: string | null;
  from_path: string | null;
}

export type Message =
  | { type: "hello"; head: number }
  | { type: "events"; head: number; events: FeedEvent[] };

/** What a page hears: new events in order, or that the ledger was rolled back (a restore). */
export interface Listener {
  events(events: FeedEvent[]): void;
  /** The ledger is behind what the page saw (a point-in-time restore): reload everything. */
  reset(): void;
}

interface Subscription {
  listener: Listener;
  /** The ledger sequence the page's data reflects, until the events after it are replayed. */
  from: number | null;
  /** Events that arrive during a replay, handed on after it. */
  pending: FeedEvent[];
}

/** The close code the server uses to have a socket reconnect, authorized afresh. */
const REAUTHORIZE = 4001;

/**
 * The change feed of one library (tempra-dev: app/live): one WebSocket shared by every page of
 * the library that listens. It reconnects with backoff and, after any gap, catches up from
 * `GET /events?since=` so no event is missed; listeners see each event once, in order. A page
 * says which sequence its data reflects (`sync`), and hears every event after it, including
 * any that arrived while it was loading.
 */
export class LibraryFeed {
  private socket: WebSocket | null = null;
  private subs = new Set<Subscription>();
  /** The last sequence handed to listeners. */
  private last: number | null = null;
  private retry = 0;
  private ping: ReturnType<typeof setInterval> | undefined;
  private idle: ReturnType<typeof setTimeout> | undefined;
  private catching: Promise<void> | null = null;
  /** A gap was seen while a catch-up was running: run it again when it ends. */
  private again = false;

  constructor(
    private urls: Urls,
    private open: (url: URL) => WebSocket = (url) => new WebSocket(url),
    private read: typeof readEvents = readEvents,
  ) {}

  subscribe(listener: Listener): Subscription & { close(): void } {
    const sub: Subscription = { listener, from: null, pending: [] };
    this.subs.add(sub);
    clearTimeout(this.idle);
    if (!this.socket) this.connect();
    return Object.assign(sub, {
      close: () => {
        this.subs.delete(sub);
        // Moving between pages of the same library keeps the socket.
        if (this.subs.size === 0) this.idle = setTimeout(() => this.close(), 10_000);
      },
    });
  }

  /** The page's data reflects the ledger up to `seq`: hand it whatever came after. */
  sync(sub: Subscription, seq: number) {
    sub.from = seq;
    void this.replay(sub);
  }

  private connect() {
    const url = new URL(this.urls.api("feed"), location.href);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const ws = this.open(url);
    this.socket = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.ping = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send("ping"), 30_000);
    };
    ws.onmessage = (e) => {
      if (typeof e.data !== "string" || e.data === "pong") return;
      this.receive(JSON.parse(e.data) as Message);
    };
    ws.onclose = (e) => {
      clearInterval(this.ping);
      if (this.socket !== ws) return;
      this.socket = null;
      if (this.subs.size === 0) return;
      // Asked to reconnect (the server re-checks access): at once; otherwise back off.
      const wait = e.code === REAUTHORIZE ? 0 : Math.min(30_000, 1000 * 2 ** this.retry++);
      setTimeout(() => this.subs.size && !this.socket && this.connect(), wait);
    };
  }

  /** A message from the socket. */
  receive(m: Message) {
    if (this.last !== null && m.head < this.last) {
      // The ledger went back (a restore): start again from where it is now.
      this.last = m.head;
      for (const sub of this.subs) {
        sub.from = null;
        sub.pending = [];
        sub.listener.reset();
      }
      if (m.type === "hello") return;
    }
    if (m.type === "hello") {
      if (this.last === null) this.last = m.head;
      else if (m.head > this.last) void this.catchUp();
      for (const sub of this.subs) void this.replay(sub);
      return;
    }
    const first = m.events[0]?.seq ?? m.head;
    if (this.last !== null && first > this.last + 1) {
      void this.catchUp();
      return;
    }
    this.deliver(m.events);
    if (this.last !== null && m.head > this.last) void this.catchUp();
  }

  private deliver(events: FeedEvent[]) {
    const fresh = events.filter((e) => this.last === null || e.seq > this.last);
    if (fresh.length === 0) return;
    this.last = fresh[fresh.length - 1]?.seq ?? this.last;
    for (const sub of this.subs) {
      // A page catching up hears these after the events it missed.
      if (sub.from === null) sub.listener.events(fresh);
      else sub.pending.push(...fresh);
    }
  }

  /**
   * Hands a page that just loaded the events between its data and what the feed has delivered
   * (they arrived, or committed, while it was loading); from then on it hears events live.
   */
  private async replay(sub: Subscription) {
    const from = sub.from;
    const upTo = this.last;
    if (from === null || upTo === null) return;
    let missed: FeedEvent[] = [];
    if (from < upTo) {
      try {
        missed = (await this.read(this.urls, from)).filter((e) => e.seq <= upTo);
      } catch {
        // Offline: the page reloads on the next event or reconnect.
      }
      // Synced again (it reloaded) or gone: that replay takes over.
      if (sub.from !== from || !this.subs.has(sub)) return;
    }
    const events = [...missed, ...sub.pending].filter((e) => e.seq > from);
    sub.from = null;
    sub.pending = [];
    if (events.length > 0) sub.listener.events(events);
  }

  /** Reads what the socket did not deliver from the ledger, then hands it on. */
  private catchUp(): Promise<void> {
    if (this.catching) {
      this.again = true;
      return this.catching;
    }
    this.catching = (async () => {
      try {
        do {
          this.again = false;
          this.deliver(await this.read(this.urls, this.last ?? 0));
        } while (this.again);
      } catch {
        // Retry while anyone listens; a reconnect's hello would also start one.
        setTimeout(() => this.subs.size && void this.catchUp(), 2000);
      } finally {
        this.catching = null;
      }
    })();
    return this.catching;
  }

  private close() {
    clearInterval(this.ping);
    const ws = this.socket;
    this.socket = null;
    ws?.close(1000, "done");
  }
}

/** Every ledger event after `since`, in order, read page by page. */
async function readEvents(urls: Urls, since: number): Promise<FeedEvent[]> {
  const out: FeedEvent[] = [];
  for (let after = since; ; ) {
    const page = await api<{
      events: (Omit<FeedEvent, "note" | "from_path"> & {
        meta: { note?: unknown; from_path?: unknown } | null;
      })[];
      next: number | null;
    }>(urls.api("events", { since: after, limit: 1000 }));
    for (const e of page.events) {
      out.push({
        ...e,
        note: typeof e.meta?.note === "string" ? e.meta.note : null,
        from_path: typeof e.meta?.from_path === "string" ? e.meta.from_path : null,
      });
    }
    if (page.next === null || page.events.length === 0) return out;
    after = page.events[page.events.length - 1]?.seq ?? page.next;
  }
}

const feeds = new Map<string, LibraryFeed>();

/**
 * Calls `onEvents` with each batch of new events in the library, for as long as the component
 * is mounted, and `onReset` when the ledger is rolled back. `from` is the sequence the page's
 * data reflects (null while loading): the page then also hears the events that arrived, or
 * committed, while it loaded. The callbacks may change between renders; the latest are used.
 */
export function useFeed(
  urls: Urls,
  from: number | null,
  onEvents: (events: FeedEvent[]) => void,
  onReset: () => void,
) {
  const callbacks = useRef({ onEvents, onReset });
  callbacks.current = { onEvents, onReset };
  const key = `${urls.owner}/${urls.slug}`;
  const sub = useRef<ReturnType<LibraryFeed["subscribe"]> | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: one feed per library, keyed by it.
  useEffect(() => {
    let feed = feeds.get(key);
    if (!feed) {
      feed = new LibraryFeed(urls);
      feeds.set(key, feed);
    }
    const s = feed.subscribe({
      events: (events) => callbacks.current.onEvents(events),
      reset: () => callbacks.current.onReset(),
    });
    sub.current = s;
    return () => {
      s.close();
      sub.current = null;
    };
  }, [key]);
  useEffect(() => {
    const s = sub.current;
    if (from !== null && s) feeds.get(key)?.sync(s, from);
  }, [from, key]);
}

/**
 * A function that runs `fn` once, `ms` after the last of a burst of calls: a page reloading on
 * feed events reloads once per burst of agents' writes, not once per write.
 */
export function useTrailing(fn: () => void, ms = 400): () => void {
  const latest = useRef(fn);
  latest.current = fn;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => latest.current(), ms);
  }, [ms]);
}

/**
 * "Since you last looked" (tempra-dev: app/live, TEMPRA-72): the ledger sequence a person has
 * seen in a library, kept on the server so it follows them across devices. Read once per page
 * load, so what is new stays marked while the person looks around; null until it arrives, or
 * when they have never looked.
 */
export function useLastSeen(urls: Urls): number | null {
  const key = seenKey(urls);
  const [seen, setSeen] = useState(() => atLoad.get(key)?.value ?? null);
  useEffect(() => {
    let entry = atLoad.get(key);
    if (!entry) {
      entry = { value: null, ready: loadSeen(urls) };
      atLoad.set(key, entry);
    }
    let live = true;
    void entry.ready.then((v) => live && setSeen(v));
    return () => {
      live = false;
    };
  }, [key, urls]);
  return seen;
}

const seenKey = (urls: Urls) => `${urls.owner}/${urls.slug}`;

const atLoad = new Map<string, { value: number | null; ready: Promise<number | null> }>();

/** The server's cursor; a cursor this browser kept before (local storage) is carried over once. */
async function loadSeen(urls: Urls): Promise<number | null> {
  const key = seenKey(urls);
  let seq: number | null = null;
  try {
    seq = (await api<{ seq: number | null }>(urls.api("seen"))).seq;
  } catch {
    return null;
  }
  const old = `tempra:seen:${key}`;
  try {
    const local = localStorage.getItem(old);
    if (local !== null) {
      localStorage.removeItem(old);
      if (seq === null || Number(local) > seq) {
        seq = Number(local);
        sendSeen(urls, seq);
      }
    }
  } catch {
    // Storage off: nothing to carry over.
  }
  const entry = atLoad.get(key);
  if (entry) entry.value = seq;
  return seq;
}

/** The highest sequence sent per library, so a page sends each step forward once. */
const sent = new Map<string, number>();

/** Said on window when a cursor moved, so counts of what is new reload. */
export const SEEN_EVENT = "tempra:seen";

function sendSeen(urls: Urls, seq: number) {
  sent.set(seenKey(urls), seq);
  void api(urls.api("seen"), { method: "PUT", body: JSON.stringify({ seq }) })
    .then(() => window.dispatchEvent(new Event(SEEN_EVENT)))
    .catch(() => {
      // Offline: the next look sends it again.
      sent.delete(seenKey(urls));
    });
}

/**
 * The person has seen the library's ledger up to `seq` (it never moves back). Sent once this
 * page load's cursor has been read, so the page still marks what was new when it opened.
 */
export function markSeen(urls: Urls, seq: number) {
  if ((sent.get(seenKey(urls)) ?? -1) >= seq) return;
  sent.set(seenKey(urls), seq);
  const read = atLoad.get(seenKey(urls))?.ready ?? Promise.resolve(null);
  void read.then(() => sendSeen(urls, seq));
}
