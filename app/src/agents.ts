import { useEffect, useMemo, useRef } from "react";
import { api, useLoad } from "./api";
import { who } from "./ui";
import type { Urls } from "./urls";

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

/** How an agent is named: "Claude for @ann". */
export function agentLabel(c: Pick<Contributor, "person" | "agent" | "actor">): string {
  const who = c.person ? `@${c.person}` : "a deleted account";
  if (!c.agent) return `${who} in the app`;
  return `${c.agent.name ?? c.actor} for ${who}`;
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
  return (by?.agent && names[by.agent]) || who(actor);
}

/**
 * The library's agent names, loaded once per library and kept like any page's data. `seen` are
 * the agent ids on screen: one the list does not know yet (an agent's first write) loads it again.
 */
export function useAgentNames(urls: Urls, seen: readonly (string | undefined)[] = []) {
  const loaded = useLoad(`agents ${urls.base}`, () =>
    api<{ contributors: Contributor[] }>(urls.api("agents")).then((r) =>
      agentNames(r.contributors),
    ),
  );
  const names = loaded.state === "ready" ? loaded.data : null;
  const asked = useRef(new Set<string>());
  const missing = names ? seen.filter((id): id is string => !!id && !(id in names)) : [];
  const key = missing.join(" ");
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` names the missing ids.
  useEffect(() => {
    const fresh = missing.filter((id) => !asked.current.has(id));
    if (fresh.length === 0) return;
    for (const id of fresh) asked.current.add(id);
    loaded.reload();
  }, [key, loaded.reload]);
  return useMemo(() => {
    const known = names ?? {};
    return (actor: string, by?: ActedBy | null) => actorLabel(actor, by, known);
  }, [names]);
}
