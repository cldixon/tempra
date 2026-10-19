import { useEffect, useMemo, useState } from "react";
import type { ActedBy } from "./agents";
import { type FeedEvent, useFeed } from "./live";
import type { Urls } from "./urls";

/**
 * Agents' recent changes, as the change feed brings them (take 3, TEMPRA-106): the one colour the
 * app allows is a small dot for an agent's change, warm while it is fresh and cooling to grey as
 * it ages. The tree marks each file, the sidebar marks Activity, the byline its author.
 */

/** An agent's latest change to one path, seen live. */
export interface AgentChange {
  actor: string;
  by?: ActedBy | null;
  seq: number;
  /** When it arrived (this browser's clock). */
  at: number;
}

/** How long a change stays warm (the coloured dot). */
export const WARM_MS = 5 * 60_000;
/** How long it shows at all (a grey dot after it cools). */
export const SHOWN_MS = 60 * 60_000;

/** How a change reads now: warm, cooled, or gone. */
export type Warmth = "warm" | "cool" | null;

export function warmth(change: Pick<AgentChange, "at"> | undefined, now: number): Warmth {
  if (!change) return null;
  const age = now - change.at;
  return age < WARM_MS ? "warm" : age < SHOWN_MS ? "cool" : null;
}

/** Whether an event is an agent's change to a file (not a person's, not a comment). */
export const isAgentChange = (e: FeedEvent) =>
  !e.actor.startsWith("human:") && e.op !== "comment" && e.op !== "delete";

/**
 * Agents' changes in this library since the workspace opened, by path, and the clock they are
 * read against (it ticks so dots cool without another event).
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
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  // The latest change of all, for the sidebar's Activity row.
  const latest = useMemo(() => {
    let last: AgentChange | undefined;
    for (const c of changes.values()) if (!last || c.at > last.at) last = c;
    return last;
  }, [changes]);
  return { changes, latest, now };
}
