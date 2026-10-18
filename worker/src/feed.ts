/**
 * The change feed (tempra-dev: app/live): every committed ledger event, pushed to the library's
 * open WebSockets. Free of Worker APIs; the Library DO holds the sockets (hibernation API) and
 * calls these.
 */
import type { ActedBy } from "./agents";
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
  /** For a comment: what was done, to which thread. */
  comment: { kind: string; thread: string } | null;
  /** The person and agent behind the actor (TEMPRA-75), by id; null before they were kept. */
  by: ActedBy | null;
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

/**
 * Open feed sockets one library holds at most (TEMPRA-80): each write's fan-out is O(sockets ×
 * events), and the app opens one socket per library per tab. Counted in the Library DO from
 * `getWebSockets()`, which hibernation keeps, never from memory.
 */
export const FEED_SOCKETS_PER_LIBRARY = 200;

/**
 * Open feed sockets one account holds at most, across every library it reaches (its person's
 * tabs and agents together). Counted by the account's AccountFeeds object (feed-leases.ts).
 */
export const FEED_SOCKETS_PER_ACCOUNT = 50;

/**
 * The close code for a feed connection refused over a cap: the socket opens and closes at once
 * with it, as a browser cannot read an HTTP refusal of a WebSocket. The client polls
 * `GET /events?since=` instead and tries the socket again later.
 */
export const FEED_FULL = 4029;

/** The DO's write methods: a call to one of these may add events. */
export const WRITE_METHODS = new Set(["apply", "import", "revert", "verify", "comment"]);

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
    comment: commentOf(meta.comment),
    by: byOf(meta.by),
  };
}

/** The `by` of an event's meta, if it has a well-formed one. */
export function byOf(v: unknown): ActedBy | null {
  if (!v || typeof v !== "object") return null;
  const b = v as { person?: unknown; agent?: unknown };
  if (typeof b.person !== "string") return null;
  return typeof b.agent === "string" ? { person: b.person, agent: b.agent } : { person: b.person };
}

function commentOf(v: unknown): FeedEvent["comment"] {
  if (!v || typeof v !== "object") return null;
  const c = v as { kind?: unknown; thread?: unknown };
  return typeof c.kind === "string" && typeof c.thread === "string"
    ? { kind: c.kind, thread: c.thread }
    : null;
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
