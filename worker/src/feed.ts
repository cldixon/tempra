/**
 * The change feed (tempra-dev: app/live): every committed ledger event, pushed to the library's
 * open WebSockets. Free of Worker APIs; the Library DO holds the sockets (hibernation API) and
 * calls these.
 */
import { normalizeDir, underPrefix } from "./okf/paths";
import type { EventRow } from "./store/store";

/** One event as the feed sends it. */
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
  /** For a move: where the file was. */
  from_path: string | null;
}

/** What the feed sends: on connect, the head; after each write, its events. */
export type FeedMessage =
  | { type: "hello"; head: number }
  | { type: "events"; head: number; events: FeedEvent[] };

/** An open feed socket and the path prefix it asked for ("" for the whole library). */
export interface FeedSocket {
  prefix: string;
  /** When it was accepted (ms since the epoch). */
  opened: number;
  send(message: string): void;
  close(code: number, reason: string): void;
}

/**
 * How long a socket may carry events before it must reconnect. The Worker authorizes a socket
 * once, at the upgrade; a revoked token, a suspension or a transfer is enforced again at the
 * next connect, so this bounds how long a lapsed caller can still see the library's events.
 */
export const FEED_MAX_AGE_MS = 10 * 60_000;

/** The close code that asks a client to reconnect (and be authorized again) at once. */
export const FEED_REAUTHORIZE = 4001;

/** The DO's write methods: a call to one of these may add events. */
export const WRITE_METHODS = new Set(["apply", "import", "revert", "verify"]);

export function feedEvent(e: EventRow): FeedEvent {
  const meta = e.meta ?? {};
  return {
    seq: e.seq,
    ts: e.ts,
    actor: e.actor,
    request_id: e.request_id,
    op: e.op,
    path: e.path,
    concept_id: e.concept_id,
    hash: e.hash,
    note: typeof meta.note === "string" ? meta.note : null,
    from_path: typeof meta.from_path === "string" ? meta.from_path : null,
  };
}

/** The prefix a socket asked for, normalized the way the store normalizes directories. */
export function feedPrefix(raw: string | null | undefined): string {
  return normalizeDir(raw ?? "");
}

/** Whether an event concerns a prefix: its path, or for a move, where it came from. */
export function concerns(e: FeedEvent, prefix: string): boolean {
  return underPrefix(e.path, prefix) || (e.from_path !== null && underPrefix(e.from_path, prefix));
}

/**
 * Sends each socket the events under its prefix. A socket that fails to take a message is
 * skipped, and one older than FEED_MAX_AGE_MS is closed instead of sent to; either way the
 * client catches up from `GET /events?since=` when it reconnects, authorized afresh.
 */
export function broadcast(
  sockets: readonly FeedSocket[],
  head: number,
  events: FeedEvent[],
  now = Date.now(),
) {
  let sent = 0;
  for (const s of sockets) {
    const mine = events.filter((e) => concerns(e, s.prefix));
    if (mine.length === 0) continue;
    if (now - s.opened > FEED_MAX_AGE_MS) {
      try {
        s.close(FEED_REAUTHORIZE, "reconnect");
      } catch {
        // Already closed.
      }
      continue;
    }
    const message: FeedMessage = { type: "events", head, events: mine };
    try {
      s.send(JSON.stringify(message));
      sent++;
    } catch {
      // Closed or closing: nothing to do.
    }
  }
  return sent;
}
