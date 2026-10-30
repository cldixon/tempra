import { who } from "./ui";

/**
 * Agents named for whom they act (tempra-dev: decisions/agents-act-for-a-person, TEMPRA-77):
 * "Claude for @ann", from the library's `GET …/agents`. The ledger, the tree's marks, the
 * new-version notice and comment authors all name them this way.
 */

/** Someone who has worked in the library: a person in the app, or one of their agents. */
export interface Contributor {
  person: string | null;
  agent: { id: string; name: string | null; platform: string | null; client: string | null } | null;
  actor: string;
  requests: number;
  last_ts: string;
}

/** The person and agent behind an actor, by id, as the ledger keeps them (TEMPRA-75). */
export interface ActedBy {
  person: string;
  agent?: string;
}

/** Apps whose slug does not read as their name word by word. */
const KNOWN_APPS: Record<string, string> = { "claude-ai": "Claude", chatgpt: "ChatGPT" };

/**
 * An agent's name as people read it. A token's agent is named by its app half, a slug
 * ("claude-code"), which reads as words ("Claude Code"); names an app chose ("Claude",
 * "claude.ai") stay as they are.
 */
export function readableName(name: string): string {
  const known = KNOWN_APPS[name];
  if (known) return known;
  if (!/^[a-z0-9]+([-_][a-z0-9]+)*$/.test(name)) return name;
  return name
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * An agent's name from its actor alone, for one the library's list does not know (yet): the app
 * half of a token's actor ("claude-code/laptop" is Claude Code), a process by its name. Never
 * the raw actor id.
 */
export function actorAgentName(actor: string): string {
  if (actor.startsWith("process:")) {
    return readableName(actor.slice("process:".length) || "process");
  }
  return readableName(actor.split("/")[0] || actor);
}

/** How an agent is named: "Claude for @ann", "Claude Code for @dev". */
export function agentLabel(c: Pick<Contributor, "person" | "agent" | "actor">): string {
  const who = c.person ? `@${c.person}` : "a deleted account";
  if (!c.agent) return `${who} in the app`;
  return `${c.agent.name ? readableName(c.agent.name) : actorAgentName(c.actor)} for ${who}`;
}

/** Each agent's label by its id. */
export function agentNames(contributors: Contributor[]): Record<string, string> {
  const names: Record<string, string> = {};
  for (const c of contributors) if (c.agent) names[c.agent.id] = agentLabel(c);
  return names;
}

/**
 * Who did something, as a person reads it: the agent named for its person when it is known,
 * otherwise the actor (a person's handle, or an agent's actor for events from before `by`).
 */
export function actorLabel(
  actor: string,
  by: ActedBy | null | undefined,
  names: Record<string, string>,
): string {
  const named = by?.agent ? names[by.agent] : undefined;
  if (named) return named;
  return actor.startsWith("human:") ? who(actor) : actorAgentName(actor);
}

/** An ActorView as one line of text: "Claude Code for @dev", "You", "ann". */
export const actorText = (v: Pick<ActorView, "name" | "for">) =>
  v.for ? `${v.name} for ${v.for}` : v.name;

/** Who acted, as a byline or a row draws them: "Claude Code for @cl_dixon", "You", "ann". */
export interface ActorView {
  /** The agent's name, or the person's handle; "You" for the signed-in person. */
  name: string;
  /** For an agent, whom it acts for ("@cl_dixon"); null for a person. */
  for: string | null;
  agent: boolean;
  /** The signed-in person themselves (not their agents). */
  you: boolean;
  /** What their round mark's initials come from: the agent's name, or the person's handle
   * (never "You"). */
  mark: string;
  /** Tempra's own agent, @tempra (TEMPRA-222): its mark is filled with the agent colour. */
  tempra: boolean;
}

/** The managed agent's actor, as the Worker's `AGENT_ACTOR` (TEMPRA-222). */
export const TEMPRA_ACTOR = "tempra/agent";

/** An agent's one letter in its round mark (TEMPRA-223): the first of its name ("Claude" is C). */
export const agentInitial = (name: string) =>
  (Array.from(name.trim().replace(/^[^\p{L}\p{N}]+/u, ""))[0] ?? "?").toUpperCase();

/** Each agent's contributor entry by its id. */
export function agentsById(contributors: Contributor[]): Record<string, Contributor> {
  const out: Record<string, Contributor> = {};
  for (const c of contributors) if (c.agent) out[c.agent.id] = c;
  return out;
}

/** An actor as an ActorView, given the library's agents and the signed-in person's actor. */
export function actorView(
  actor: string,
  by: ActedBy | null | undefined,
  agents: Record<string, Contributor>,
  me: string | null,
): ActorView {
  const c = by?.agent ? agents[by.agent] : undefined;
  const human = actor.startsWith("human:") && !by?.agent;
  if (human) {
    const you = me !== null && actor === me;
    return {
      name: you ? "You" : who(actor),
      for: null,
      agent: false,
      you,
      mark: who(actor),
      tempra: false,
    };
  }
  // An agent the list does not know yet is named from its actor ("claude-code/local" is Claude
  // Code); `by.person` is an id, never shown as a handle.
  const person = c?.person ?? null;
  const name = c?.agent?.name ? readableName(c.agent.name) : actorAgentName(actor);
  return {
    name,
    for: person ? `@${person}` : null,
    agent: true,
    you: false,
    mark: name,
    tempra: actor === TEMPRA_ACTOR,
  };
}
