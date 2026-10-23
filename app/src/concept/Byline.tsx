import { useEffect, useState } from "react";
import { AgentName } from "../AgentName";
import { type ActedBy, type ActorView, actorText } from "../agents";
import { Avatar } from "../chrome";
import { Moment } from "../Moment";
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
 * version on screen, for whom when an agent ("Claude Code for @ann"), and when ("edited 14 min
 * ago"); while an agent writes the page (a write within the last minute, or one on the feed not
 * yet shown) "· editing now" with the pulsing dot, the agent named once (TEMPRA-131: "Claude
 * Code for @ann · editing now · edited just now"). It follows the version on screen: an earlier
 * one shows who wrote it and when, never "editing now". Versions are in History; whether a person
 * checked the page is the quiet line under it (`Checked.tsx`).
 */
export function Byline(props: {
  concept: Concept;
  history: HistoryEvent[];
  name: Namer;
  live: Live | null;
  /** The latest version is on screen: an earlier one is never being edited now. */
  current: boolean;
}) {
  const { concept: c, name } = props;
  const live = props.current ? props.live : null;
  const s = standing(props.history, c.seq);
  const author = s.current?.event;
  const who = author ? name(author.actor, actedBy(author)) : null;
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
  const editing = useWithin(props.current ? at : null, EDITING_MS) && writer !== null;
  if (!who || !author) return <div className="byline" />;
  // The agent is named once: when the one writing now wrote the version on screen, "editing
  // now" follows its name; another writer is named in that clause.
  const same = writer !== null && actorText(writer) === actorText(who);
  const sep = (
    <span className="byline-sep" aria-hidden="true">
      ·
    </span>
  );
  return (
    <div className="byline">
      <Avatar name={who.mark} agent={who.agent} />
      <span className="byline-name">
        <AgentName who={who} />
      </span>
      {editing && writer && (
        <>
          {sep}
          <span className="byline-live" role="status">
            <span className="change-dot live" aria-hidden="true" />
            {same ? "editing now" : `${actorText(writer)} is editing now`}
          </span>
        </>
      )}
      {sep}
      <span className="muted">
        edited <Moment ts={author.ts} />
      </span>
    </div>
  );
}
