import type { ActorView } from "./agents";

/**
 * Who acted, the one way the app names them (TEMPRA-131, X-1): an agent for its person ("Claude
 * Code for @dev"), a person by handle, the signed-in person as "You". Never the raw actor id
 * ("claude-code/local"): the ActorView comes from `useActors` (the library's `GET …/agents`),
 * which names an agent the list does not know yet from its actor's app half. `actorText` is the
 * same as one string, for titles and labels.
 */
export function AgentName({ who }: { who: Pick<ActorView, "name" | "for"> }) {
  return (
    <span className="agent-name">
      <b>{who.name}</b>
      {who.for && <span className="agent-for"> for {who.for}</span>}
    </span>
  );
}
