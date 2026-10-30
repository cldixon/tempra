import type { ActedBy } from "./agents";
import { isAgentChange } from "./changes";
import type { FeedEvent } from "./live";
import { ancestors } from "./tree";

/*
 * Agents' presence (TEMPRA-219, tempra-dev: app/live): what an agent is reading, searching or
 * writing in the library now. Reading and searching come as presence messages on the feed
 * (worker/src/feed.ts); writing from the agents' own events on it. Kept per library, the most
 * recent per file, each fading PRESENCE_TTL_MS after it came; nothing is stored or asked for.
 */

export type PresenceKind = "reading" | "searching" | "writing";

/** A presence message as the feed sends it. */
export interface PresenceMessage {
  type: "presence";
  kind: Exclude<PresenceKind, "writing">;
  actor: string;
  by: ActedBy | null;
  paths: string[];
}

/** What an agent was last seen doing to a file, and when it came (ms since the epoch). */
export interface Presence {
  kind: PresenceKind;
  actor: string;
  by: ActedBy | null;
  at: number;
}

/**
 * How long a file stays marked after its last presence. The server sends at most one message
 * per agent, kind and file every 3 s, so an agent still at it keeps the mark.
 */
export const PRESENCE_TTL_MS = 8000;

/** The presence of one library: path to its most recent, until each fades. */
export class PresenceStore {
  private entries = new Map<string, Presence>();
  private watchers = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private now: () => number = Date.now,
    private ttl = PRESENCE_TTL_MS,
  ) {}

  /** A presence message from the feed. */
  add(m: PresenceMessage) {
    if (m.actor.startsWith("human:") || m.paths.length === 0) return;
    const at = this.now();
    for (const path of m.paths) {
      this.entries.set(path, { kind: m.kind, actor: m.actor, by: m.by ?? null, at });
    }
    this.changed();
  }

  /** Events as they arrive live: an agent's write to a file is writing presence on it. */
  events(events: FeedEvent[]) {
    const at = this.now();
    let any = false;
    for (const e of events) {
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
    if (this.entries.size === 0) return;
    const oldest = Math.min(...[...this.entries.values()].map((p) => p.at));
    const wait = Math.max(0, oldest + this.ttl - this.now());
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (this.prune()) for (const fn of this.watchers) fn();
      this.schedule();
    }, wait + 20);
  }
}

/** The folders that hold a marked file, at any depth: what a folder's quieter mark follows. */
export function activeFolders(active: ReadonlyMap<string, Presence>): Set<string> {
  const out = new Set<string>();
  for (const path of active.keys()) for (const d of ancestors(path)) out.add(d);
  return out;
}

/** The words for a presence, for a screen reader beside the tree's row. */
export const presenceWords: Record<PresenceKind, string> = {
  reading: "an agent is reading",
  searching: "found in an agent's search",
  writing: "an agent is writing",
};
