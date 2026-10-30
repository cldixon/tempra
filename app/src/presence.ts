import type { ActedBy } from "./agents";
import { isAgentChange } from "./changes";
import type { FeedEvent } from "./live";
import { ancestors } from "./tree";

/*
 * Agents' presence (TEMPRA-219, tempra-dev: app/live): what an agent is reading or writing in
 * the library now. Reading comes as presence messages on the feed (worker/src/feed.ts); writing
 * from the agents' own events on it; a search marks nothing. Kept per library, the most recent
 * per file, each fading PRESENCE_TTL_MS after it came; nothing is stored or asked for.
 */

export type PresenceKind = "reading" | "writing";

/**
 * A presence message as the feed sends it: an agent reading, or the library's agent replying in a
 * thread (TEMPRA-222, `thread`; its page in `paths`, "" for the library), which marks the thread,
 * not the tree.
 */
export interface PresenceMessage {
  type: "presence";
  kind: "reading" | "replying";
  actor: string;
  by: ActedBy | null;
  paths: string[];
  thread?: string;
}

/** A thread the library's agent is replying in, and when that was last said. */
export interface Replying {
  actor: string;
  by: ActedBy | null;
  at: number;
}

/**
 * How long "Tempra is replying…" stays without word from the agent's turn, which says it again
 * before each model call; its reply landing on the feed clears it sooner.
 */
export const REPLYING_TTL_MS = 60_000;

/** What an agent was last seen doing to a file, and when it came (ms since the epoch). */
export interface Presence {
  kind: PresenceKind;
  actor: string;
  by: ActedBy | null;
  at: number;
}

/**
 * How long a file stays marked after its last presence. The server sends at most one message
 * per agent and file every 3 s, so an agent still at it keeps the mark.
 */
export const PRESENCE_TTL_MS = 8000;

/** The presence of one library: path to its most recent, until each fades. */
export class PresenceStore {
  private entries = new Map<string, Presence>();
  /** Threads the library's agent is replying in (TEMPRA-222), by thread id. */
  private threads = new Map<string, Replying>();
  private watchers = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private now: () => number = Date.now,
    private ttl = PRESENCE_TTL_MS,
    private replyTtl = REPLYING_TTL_MS,
  ) {}

  /** A presence message from the feed. */
  add(m: PresenceMessage) {
    if (m.actor.startsWith("human:")) return;
    const at = this.now();
    if (m.kind === "replying") {
      if (!m.thread) return;
      this.threads.set(m.thread, { actor: m.actor, by: m.by ?? null, at });
      this.changed();
      return;
    }
    if (m.paths.length === 0) return;
    for (const path of m.paths) {
      this.entries.set(path, { kind: "reading", actor: m.actor, by: m.by ?? null, at });
    }
    this.changed();
  }

  /** Events as they arrive live: an agent's write to a file is writing presence on it. */
  events(events: FeedEvent[]) {
    const at = this.now();
    let any = false;
    for (const e of events) {
      // The agent's comment in a thread it was replying in: the reply has landed.
      if (
        e.op === "comment" &&
        e.comment &&
        this.threads.get(e.comment.thread)?.actor === e.actor
      ) {
        this.threads.delete(e.comment.thread);
        any = true;
      }
      if (!isAgentChange(e)) continue;
      // A move leaves its old path: the file is at its new one.
      if (e.from_path) this.entries.delete(e.from_path);
      this.entries.set(e.path, { kind: "writing", actor: e.actor, by: e.by ?? null, at });
      any = true;
    }
    if (any) this.changed();
  }

  /** The files marked now, each with its most recent presence. */
  active(): ReadonlyMap<string, Presence> {
    this.prune();
    return new Map(this.entries);
  }

  /** The threads the library's agent is replying in now. */
  replying(): ReadonlyMap<string, Replying> {
    this.prune();
    return new Map(this.threads);
  }

  /** Calls `fn` whenever what is marked changes (added, or faded), until it returns. */
  watch(fn: () => void): () => void {
    this.watchers.add(fn);
    return () => this.watchers.delete(fn);
  }

  private prune(): boolean {
    const now = this.now();
    let gone = false;
    for (const [path, p] of this.entries) {
      if (now - p.at >= this.ttl) {
        this.entries.delete(path);
        gone = true;
      }
    }
    for (const [id, r] of this.threads) {
      if (now - r.at >= this.replyTtl) {
        this.threads.delete(id);
        gone = true;
      }
    }
    return gone;
  }

  private changed() {
    for (const fn of this.watchers) fn();
    this.schedule();
  }

  /** Wakes when the oldest mark is due to fade, so the watchers hear it go. */
  private schedule() {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.entries.size === 0 && this.threads.size === 0) return;
    const due = [
      ...[...this.entries.values()].map((p) => p.at + this.ttl),
      ...[...this.threads.values()].map((r) => r.at + this.replyTtl),
    ];
    const wait = Math.max(0, Math.min(...due) - this.now());
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (this.prune()) for (const fn of this.watchers) fn();
      this.schedule();
    }, wait + 20);
  }
}

/**
 * The folders that hold a marked file, at any depth, each with the most recent presence inside:
 * what a closed folder's name shimmers for (an open one leaves it to its rows).
 */
export function activeFolders(active: ReadonlyMap<string, Presence>): Map<string, Presence> {
  const out = new Map<string, Presence>();
  for (const [path, p] of active) {
    for (const d of ancestors(path)) {
      const seen = out.get(d);
      if (!seen || p.at > seen.at) out.set(d, p);
    }
  }
  return out;
}

/** The words for a presence, for a screen reader beside the tree's row. */
export const presenceWords: Record<PresenceKind, string> = {
  reading: "an agent is reading",
  writing: "an agent is writing",
};

/** The same for a closed folder holding such a file. */
export const presenceWordsInside: Record<PresenceKind, string> = {
  reading: "an agent is reading in here",
  writing: "an agent is writing in here",
};

/**
 * A marked row's tooltip, naming the agent as the app names it (`actorText`): "Claude Code for
 * @dev is reading" ("… is reading in here" on a closed folder). The shimmer is the cue; this is
 * what a hover adds.
 */
export const presenceTitle = (who: string, kind: PresenceKind, inside = false) =>
  `${who} is ${kind}${inside ? " in here" : ""}`;
