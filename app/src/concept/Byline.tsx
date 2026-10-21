import { useEffect, useState } from "react";
import type { ActedBy, ActorView } from "../agents";
import { Avatar } from "../chrome";
import { useAgo } from "../ui";
import { actedBy, type Concept, type HistoryEvent, standing } from "./data";
import type { Live } from "./live";

/** Names an actor (an agent for its person, the signed-in person as "You"). */
export type Namer = (actor: string, by?: ActedBy | null) => ActorView;

/** How long after an agent's write the byline says it is editing now. */
export const EDITING_MS = 60_000;

/** True until `ts` is `ms` old, turning false on its own when it is. */
function useWithin(ts: number | null, ms: number): boolean {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (ts === null) return;
    const left = ts + ms - Date.now();
    if (left <= 0) return;
    setNow(Date.now());
    const timer = setTimeout(() => setNow(Date.now()), left + 50);
    return () => clearTimeout(timer);
  }, [ts, ms]);
  return ts !== null && now - ts < ms;
}

/**
 * The concept's byline (take 4, TEMPRA-114; tempra-dev: app/reader, The byline): who wrote the
 * version on screen, for whom when an agent ("Claude Code for @ann"), and when; while an agent
 * writes the page (a write within the last minute, or one on the feed not yet shown) "Claude
 * Code is editing now" with the pulsing dot. Versions are in History, verification in
 * Properties (decisions/verification-out-of-the-way).
 */
export function Byline(props: {
  concept: Concept;
  history: HistoryEvent[];
  name: Namer;
  live: Live | null;
}) {
  const { concept: c, name, live } = props;
  const s = standing(props.history, c.seq);
  const author = s.current?.event;
  const who = author ? name(author.actor, actedBy(author)) : null;
  const ago = useAgo(author?.ts ?? new Date().toISOString());
  // An agent's write on the feed (not yet swapped in) or the version on screen, if recent.
  const pending = live?.change;
  const pendingAgent =
    pending &&
    pending.op !== "comment" &&
    (pending.by?.agent || !pending.actor.startsWith("human:"))
      ? pending
      : null;
  const writer = pendingAgent
    ? name(pendingAgent.actor, pendingAgent.by ?? null)
    : who?.agent
      ? who
      : null;
  const at = pendingAgent
    ? Date.parse(pendingAgent.ts)
    : who?.agent && author
      ? Date.parse(author.ts)
      : null;
  const editing = useWithin(at, EDITING_MS) && writer !== null;
  if (!who) return <div className="byline" />;
  return (
    <div className="byline">
      <Avatar name={who.name} agent={who.agent} />
      <span className="byline-name">
        <strong>{who.name}</strong>
        {who.for && <span className="muted"> for {who.for}</span>}
      </span>
      <span className="byline-sep" aria-hidden="true">
        ·
      </span>
      {editing && writer ? (
        <span className="byline-live" role="status">
          <span className="change-dot live" aria-hidden="true" />
          {writer.name} is editing now
        </span>
      ) : (
        <span className="muted">edited {ago} ago</span>
      )}
    </div>
  );
}
