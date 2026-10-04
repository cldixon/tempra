import { useEffect, useRef } from "react";
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

type Message =
  | { type: "hello"; head: number }
  | { type: "events"; head: number; events: FeedEvent[] };

type Listener = (events: FeedEvent[]) => void;

/**
 * The change feed of one library (tempra-dev: app/live): one WebSocket shared by every page of
 * the library that listens. It reconnects with backoff and, after any gap, catches up from
 * `GET /events?since=` so no event is missed; listeners see each event once, in order.
 */
class LibraryFeed {
  private socket: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private last: number | null = null;
  private retry = 0;
  private ping: ReturnType<typeof setInterval> | undefined;
  private idle: ReturnType<typeof setTimeout> | undefined;
  private catching: Promise<void> | null = null;

  constructor(private urls: Urls) {}

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    clearTimeout(this.idle);
    if (!this.socket) this.connect();
    return () => {
      this.listeners.delete(fn);
      // Moving between pages of the same library keeps the socket.
      if (this.listeners.size === 0) this.idle = setTimeout(() => this.close(), 10_000);
    };
  }

  private connect() {
    const url = new URL(this.urls.api("feed"), location.href);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(url);
    this.socket = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.ping = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send("ping"), 30_000);
    };
    ws.onmessage = (e) => {
      if (typeof e.data !== "string" || e.data === "pong") return;
      const m = JSON.parse(e.data) as Message;
      if (m.type === "hello") {
        if (this.last === null) this.last = m.head;
        else if (m.head > this.last) void this.catchUp();
        return;
      }
      const first = m.events[0]?.seq ?? m.head;
      if (this.last !== null && first > this.last + 1) {
        void this.catchUp();
        return;
      }
      this.deliver(m.events);
      if (this.last !== null && m.head > this.last) void this.catchUp();
    };
    ws.onclose = () => {
      clearInterval(this.ping);
      if (this.socket !== ws) return;
      this.socket = null;
      if (this.listeners.size === 0) return;
      const wait = Math.min(30_000, 1000 * 2 ** this.retry++);
      setTimeout(() => this.listeners.size && !this.socket && this.connect(), wait);
    };
  }

  private deliver(events: FeedEvent[]) {
    const fresh = events.filter((e) => this.last === null || e.seq > this.last);
    if (fresh.length === 0) return;
    this.last = fresh[fresh.length - 1]?.seq ?? this.last;
    for (const fn of this.listeners) fn(fresh);
  }

  /** Reads what the socket did not deliver from the ledger, then hands it on. */
  private catchUp(): Promise<void> {
    this.catching ??= (async () => {
      try {
        for (;;) {
          const since = this.last ?? 0;
          const page = await api<{
            events: (Omit<FeedEvent, "note" | "from_path"> & {
              meta: { note?: unknown; from_path?: unknown } | null;
            })[];
            next: number | null;
          }>(this.urls.api("events", { since, limit: 1000 }));
          this.deliver(
            page.events.map((e) => ({
              ...e,
              note: typeof e.meta?.note === "string" ? e.meta.note : null,
              from_path: typeof e.meta?.from_path === "string" ? e.meta.from_path : null,
            })),
          );
          if (page.next === null) break;
        }
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

const feeds = new Map<string, LibraryFeed>();

/**
 * Calls `onEvents` with each batch of new events in the library, for as long as the component
 * is mounted. The callback may change between renders; the latest one is used.
 */
export function useFeed(urls: Urls, onEvents: (events: FeedEvent[]) => void) {
  const callback = useRef(onEvents);
  callback.current = onEvents;
  const key = `${urls.owner}/${urls.slug}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: one feed per library, keyed by it.
  useEffect(() => {
    let feed = feeds.get(key);
    if (!feed) {
      feed = new LibraryFeed(urls);
      feeds.set(key, feed);
    }
    return feed.subscribe((events) => callback.current(events));
  }, [key]);
}

/**
 * "Since you last looked" (tempra-dev: app/live): the ledger sequence a person had seen in a
 * library on this browser. Local storage only; it may be missing or refuse, which only means
 * nothing is marked new.
 */
export function lastSeen(urls: Urls): number | null {
  const key = `tempra:seen:${urls.owner}/${urls.slug}`;
  // Read once per page load, so what is new stays marked while the person looks around.
  if (!atLoad.has(key)) {
    try {
      const v = localStorage.getItem(key);
      atLoad.set(key, v === null ? null : Number(v));
    } catch {
      atLoad.set(key, null);
    }
  }
  return atLoad.get(key) ?? null;
}

const atLoad = new Map<string, number | null>();

export function markSeen(urls: Urls, seq: number) {
  try {
    const key = `tempra:seen:${urls.owner}/${urls.slug}`;
    if (Number(localStorage.getItem(key) ?? 0) < seq) localStorage.setItem(key, String(seq));
  } catch {
    // Private mode or storage off: nothing is marked new next time.
  }
}
