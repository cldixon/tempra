import { useEffect, useMemo, useState } from "react";
import type { ActedBy } from "./agents";
import { type FeedEvent, useFeed } from "./live";
import type { Urls } from "./urls";

/**
 * Agents' recent changes, as the change feed brings them (take 4, tempra-dev: app/workspace). The
 * one colour the app allows is the change dot, in two states: solid for changed since the person's
 * seen cursor, pulsing for an agent writing now (a write on the feed within the last minute). The
 * tree marks each file, the sidebar marks Activity, the byline its author.
 */

/** An agent's latest change to one path, seen live. */
export interface AgentChange {
  actor: string;
  by?: ActedBy | null;
  seq: number;
  /** When it arrived (this browser's clock). */
  at: number;
}

/** How long an agent's write counts as writing now (the pulsing dot). */
export const LIVE_MS = 60_000;

/** Whether a change is an agent writing now: it arrived within the last minute. */
export function isLive(change: Pick<AgentChange, "at"> | undefined, now: number): boolean {
  return change !== undefined && now - change.at < LIVE_MS;
}

/** Whether an event is an agent's change to a file (not a person's, not a comment). */
export const isAgentChange = (e: FeedEvent) =>
  !e.actor.startsWith("human:") && e.op !== "comment" && e.op !== "delete";

/**
 * Agents' changes in this library since the workspace opened, by path, and the clock they are
 * read against (it moves on when a pulsing dot is due to settle, without another event).
 */
export function useAgentChanges(urls: Urls, from: number | null) {
  const [changes, setChanges] = useState<Map<string, AgentChange>>(new Map());
  const [now, setNow] = useState(() => Date.now());
  useFeed(
    urls,
    from,
    (events) => {
      const agents = events.filter(isAgentChange);
      if (agents.length === 0) return;
      const at = Date.now();
      setNow(at);
      setChanges((c) => {
        const next = new Map(c);
        for (const e of agents) next.set(e.path, { actor: e.actor, by: e.by, seq: e.seq, at });
        return next;
      });
    },
    // The ledger went back (a restore): what was marked may no longer be there.
    () => setChanges(new Map()),
  );
  // The next pulsing dot to settle moves the clock on; nothing ticks while none pulses.
  useEffect(() => {
    let next = Number.POSITIVE_INFINITY;
    for (const c of changes.values()) if (isLive(c, now)) next = Math.min(next, c.at + LIVE_MS);
    if (next === Number.POSITIVE_INFINITY) return;
    const t = setTimeout(() => setNow(Date.now()), Math.max(0, next - Date.now()) + 50);
    return () => clearTimeout(t);
  }, [changes, now]);
  // The latest change of all, for the sidebar's Activity row.
  const latest = useMemo(() => {
    let last: AgentChange | undefined;
    for (const c of changes.values()) if (!last || c.at > last.at) last = c;
    return last;
  }, [changes]);
  return { changes, latest, now };
}
