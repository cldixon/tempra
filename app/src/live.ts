import { useCallback, useEffect, useRef, useState } from "react";
import type { ActedBy } from "./agents";
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
  /** The person and agent behind the actor, by id; absent on events from before it was kept. */
  by?: ActedBy | null;
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
 * The close code for a connection refused over the library's or the account's cap on open
 * sockets (TEMPRA-80): the feed polls the ledger instead and tries a socket again much later.
 */
export const FEED_FULL = 4029;

/**
 * How often a feed refused a socket reads the ledger, and when it first tries a socket again;
 * and how long a failed catch-up waits before the next, doubling up to a minute (F-19).
 */
export const FALLBACK = {
  pollMs: 15_000,
  retryMs: 5 * 60_000,
  maxRetryMs: 30 * 60_000,
  catchUpMs: 2000,
  maxCatchUpMs: 60_000,
};

/** Whether the feed is following the library, or trying to get back to it. */
export type FeedStatus = "live" | "reconnecting";

/** Whether the page is out of sight (a background tab): retries wait for it to show again. */
const pageHidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";

/**
 * The change feed of one library (tempra-dev: app/live): one WebSocket shared by every page of
 * the library that listens. It reconnects with backoff and, after any gap, catches up from
 * `GET /events?since=` so no event is missed; listeners see each event once, in order. A page
 * says which sequence its data reflects (`sync`), and hears every event after it, including
 * any that arrived while it was loading. Retries (a socket, a catch-up) back off and wait while
 * the tab is hidden; `status` says when the feed is reconnecting, for the frame's quiet notice.
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
  /** Set while the server refuses a socket (FEED_FULL): the ledger is polled instead. */
  private polling: ReturnType<typeof setInterval> | undefined;
  private retrySocket: ReturnType<typeof setTimeout> | undefined;
  /** Sockets refused in a row, to space out the next try. */
  private refused = 0;
  /** Catch-ups failed in a row, to space out the next. */
  private failed = 0;
  /** Retries that came due while the tab was hidden, run when it shows again (one per kind). */
  private paused = new Map<string, () => void>();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  status: FeedStatus = "live";
  private watchers = new Set<(s: FeedStatus) => void>();

  constructor(
    private urls: Urls,
    private open: (url: URL) => WebSocket = (url) => new WebSocket(url),
    private read: typeof readEvents = readEvents,
    fallback: Partial<typeof FALLBACK> = {},
    private hidden: () => boolean = pageHidden,
  ) {
    this.fallback = { ...FALLBACK, ...fallback };
  }

  private fallback: typeof FALLBACK;

  /** Calls `fn` with each change of status, until the function it returns is called. */
  watch(fn: (s: FeedStatus) => void): () => void {
    this.watchers.add(fn);
    return () => this.watchers.delete(fn);
  }

  private setStatus(s: FeedStatus) {
    if (this.status === s) return;
    this.status = s;
    for (const fn of this.watchers) fn(s);
  }

  /**
   * Runs `fn` after `ms`, or, when the tab is hidden by then, once it shows again (`wake`): a
   * background tab spends nothing on retries. One paused retry is kept of each kind.
   */
  private later(kind: string, fn: () => void, ms: number) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      if (this.hidden()) this.paused.set(kind, fn);
      else fn();
    }, ms);
    this.timers.add(t);
  }

  /** The tab shows again: run the retries it held back. */
  wake() {
    if (this.hidden()) return;
    const due = [...this.paused.values()];
    this.paused.clear();
    for (const fn of due) fn();
  }

  subscribe(listener: Listener): Subscription & { close(): void } {
    const sub: Subscription = { listener, from: null, pending: [] };
    this.subs.add(sub);
    clearTimeout(this.idle);
    if (!this.socket && this.polling === undefined) this.connect();
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
      // Over a cap on open sockets: poll, and try a socket again much later, never in a loop.
      if (e.code === FEED_FULL) {
        this.poll();
        return;
      }
      this.stopPolling();
      this.refused = 0;
      // Asked to reconnect (the server re-checks access): at once; otherwise back off, and say
      // that the feed is reconnecting.
      if (e.code !== REAUTHORIZE) this.setStatus("reconnecting");
      const wait = e.code === REAUTHORIZE ? 0 : Math.min(30_000, 1000 * 2 ** this.retry++);
      this.later("socket", () => this.subs.size && !this.socket && this.connect(), wait);
    };
  }

  /**
   * The socket was refused: read the ledger every so often instead (the same catch-up a gap
   * runs), and try a socket again after a wait that doubles with each refusal.
   */
  private poll() {
    if (this.polling === undefined) {
      this.polling = setInterval(() => {
        if (this.subs.size === 0) return;
        // Never connected: start from what the pages loaded, not from the ledger's beginning.
        if (this.last === null) {
          const from = [...this.subs].flatMap((s) => (s.from === null ? [] : [s.from]));
          if (from.length === 0) return;
          this.last = Math.min(...from);
          for (const sub of this.subs) void this.replay(sub);
        }
        void this.catchUp();
      }, this.fallback.pollMs);
    }
    const wait = Math.min(this.fallback.maxRetryMs, this.fallback.retryMs * 2 ** this.refused++);
    clearTimeout(this.retrySocket);
    this.retrySocket = setTimeout(() => {
      if (this.subs.size && !this.socket) this.connect();
    }, wait);
  }

  private stopPolling() {
    clearInterval(this.polling);
    clearTimeout(this.retrySocket);
    this.polling = undefined;
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
      // A socket is open again: the server took it, so stop polling.
      this.stopPolling();
      this.refused = 0;
      if (this.failed === 0) this.setStatus("live");
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
        this.failed = 0;
        if (this.socket || this.polling !== undefined) this.setStatus("live");
      } catch {
        // Retry while anyone listens, waiting longer each time and not while the tab is hidden
        // (each read spends the session's rate limit); a reconnect's hello also starts one.
        this.setStatus("reconnecting");
        const { catchUpMs, maxCatchUpMs } = this.fallback;
        const wait = Math.min(maxCatchUpMs, catchUpMs * 2 ** this.failed++);
        this.later("catch-up", () => this.subs.size && void this.catchUp(), wait);
      } finally {
        this.catching = null;
      }
    })();
    return this.catching;
  }

  private close() {
    clearInterval(this.ping);
    this.stopPolling();
    this.refused = 0;
    this.failed = 0;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.paused.clear();
    this.setStatus("live");
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
      events: (Omit<FeedEvent, "note" | "from_path" | "by"> & {
        meta: { note?: unknown; from_path?: unknown; by?: ActedBy } | null;
      })[];
      next: number | null;
    }>(urls.api("events", { since: after, limit: 1000 }));
    for (const e of page.events) {
      out.push({
        ...e,
        note: typeof e.meta?.note === "string" ? e.meta.note : null,
        from_path: typeof e.meta?.from_path === "string" ? e.meta.from_path : null,
        by: typeof e.meta?.by?.person === "string" ? e.meta.by : null,
      });
    }
    if (page.next === null || page.events.length === 0) return out;
    after = page.events[page.events.length - 1]?.seq ?? page.next;
  }
}

const feeds = new Map<string, LibraryFeed>();

/** The library's one feed, made on first use; a tab shown again wakes every feed's retries. */
function feedOf(urls: Urls): LibraryFeed {
  const key = `${urls.owner}/${urls.slug}`;
  let feed = feeds.get(key);
  if (!feed) {
    if (feeds.size === 0 && typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => {
        for (const f of feeds.values()) f.wake();
      });
    }
    feed = new LibraryFeed(urls);
    feeds.set(key, feed);
  }
  return feed;
}

/**
 * Whether the library's feed is live or reconnecting, said only once it has been reconnecting
 * for a few seconds (a socket the server asks to reopen, or a blip, says nothing).
 */
export function useFeedStatus(urls: Urls, quietMs = 4000): FeedStatus {
  const key = `${urls.owner}/${urls.slug}`;
  const [shown, setShown] = useState<FeedStatus>("live");
  // biome-ignore lint/correctness/useExhaustiveDependencies: one feed per library, keyed by it.
  useEffect(() => {
    const feed = feedOf(urls);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const on = (s: FeedStatus) => {
      clearTimeout(timer);
      if (s === "live") setShown("live");
      else timer = setTimeout(() => setShown(feed.status), quietMs);
    };
    on(feed.status);
    const stop = feed.watch(on);
    return () => {
      stop();
      clearTimeout(timer);
    };
  }, [key, quietMs]);
  return shown;
}

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
    const feed = feedOf(urls);
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
 * seen in a library, kept on the server so it follows them across devices. Read from the server
 * once per page load, then followed as this page load moves it (Activity does): the tree's dots,
 * the home's line and its sections clear after a look at Activity, with no reload. `hold` keeps
 * the value the page found when it opened, for the page that moves the cursor (Activity still
 * marks what was new when it opened). Null until it arrives, or when they have never looked.
 */
export function useLastSeen(urls: Urls, hold = false): number | null {
  return useSeenCursor(urls, hold).seen;
}

/**
 * The seen cursor and whether it is known yet: `seen` null and `known` true is a person who has
 * never looked here (the home's first look), not one whose cursor is still loading.
 */
export function useSeenCursor(urls: Urls, hold = false): { seen: number | null; known: boolean } {
  const key = seenKey(urls);
  const [state, setState] = useState(() => {
    const c = cursors.get(key);
    return { key, value: c?.loaded ? c.value : null, known: c?.loaded ?? false };
  });
  useEffect(() => {
    const c = cursorOf(urls);
    let live = true;
    const update = () => {
      if (!live) return;
      setState((s) =>
        hold && s.known && s.key === key ? s : { key, value: c.value, known: true },
      );
    };
    if (c.loaded) update();
    else void c.ready.then(update);
    c.listeners.add(update);
    return () => {
      live = false;
      c.listeners.delete(update);
    };
  }, [key, urls, hold]);
  return state.key === key
    ? { seen: state.value, known: state.known }
    : { seen: null, known: false };
}

const seenKey = (urls: Urls) => `${urls.owner}/${urls.slug}`;

/** A library's cursor as this page load knows it, and who follows it. */
interface Cursor {
  value: number | null;
  loaded: boolean;
  ready: Promise<number | null>;
  listeners: Set<() => void>;
}

const cursors = new Map<string, Cursor>();

function cursorOf(urls: Urls): Cursor {
  const key = seenKey(urls);
  let c = cursors.get(key);
  if (!c) {
    const fresh: Cursor = {
      value: null,
      loaded: false,
      ready: Promise.resolve(null),
      listeners: new Set(),
    };
    fresh.ready = loadSeen(urls).then((v) => {
      // A move made while it loaded (the cursor never goes back) wins over what was read.
      if (v !== null && (fresh.value === null || v > fresh.value)) fresh.value = v;
      fresh.loaded = true;
      return fresh.value;
    });
    cursors.set(key, fresh);
    c = fresh;
  }
  return c;
}

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
  return seq;
}

/** The highest sequence sent per library, so a page sends each step forward once. */
const sent = new Map<string, number>();

/** Said on window when a cursor moved, so counts of what is new reload. */
export const SEEN_EVENT = "tempra:seen";

function sendSeen(urls: Urls, seq: number) {
  sent.set(seenKey(urls), seq);
  void api(urls.api("seen"), { method: "PUT", body: JSON.stringify({ seq }) })
    .then(() => {
      // Every page following the cursor here hears the move.
      const c = cursors.get(seenKey(urls));
      if (c && (c.value === null || seq > c.value)) {
        c.value = seq;
        if (c.loaded) for (const fn of c.listeners) fn();
      }
      window.dispatchEvent(new Event(SEEN_EVENT));
    })
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
  void cursorOf(urls).ready.then(() => sendSeen(urls, seq));
}
