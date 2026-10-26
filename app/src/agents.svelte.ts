import {
  type ActedBy,
  actorLabel,
  actorView,
  agentNames,
  agentsById,
  type Contributor,
} from "./agents";
import { api } from "./api";
import { useLoad } from "./load.svelte.ts";
import { useMe } from "./ui.svelte.ts";
import type { Urls } from "./urls";

/**
 * The library's contributors (`GET …/agents`), loaded once per library and shared by every page
 * that names people and agents. An agent seen on screen that the list does not know yet (its
 * first write, arriving live) loads it again, once per agent.
 */
function useContributors(urls: () => Urls) {
  const loaded = useLoad(
    () => `contributors ${urls().base}`,
    () => api<{ contributors: Contributor[] }>(urls().api("agents")).then((r) => r.contributors),
  );
  const list = $derived(loaded.data ?? null);
  const byId = $derived(agentsById(list ?? []));
  // Ids met while drawing that the list lacks; asked for after the render, each once.
  const asked = new Set<string>();
  let pending = false;
  const note = (id: string | undefined) => {
    if (!id || !list || id in byId || asked.has(id)) return;
    asked.add(id);
    if (pending) return;
    pending = true;
    queueMicrotask(() => {
      pending = false;
      loaded.reload();
    });
  };
  return {
    get list() {
      return list;
    },
    get byId() {
      return byId;
    },
    note,
  };
}

/**
 * Who acted, as an ActorView, for pages that draw people and agents apart (the byline, home,
 * Activity, the Inbox). The signed-in person is "You".
 */
export function useActors(urls: () => Urls) {
  const c = useContributors(urls);
  const me = useMe();
  return {
    view: (actor: string, by?: ActedBy | null) => {
      c.note(by?.agent);
      return actorView(actor, by, c.byId, me.current?.actor ?? null);
    },
    /** Everyone who has worked here: people and agents. */
    get contributors() {
      return c.list ?? [];
    },
  };
}

/**
 * The library's agent names as one string each ("Claude for @ann"), for the new-version notice
 * and the ledger. A rune: read `.label` inside a template or $derived so it follows the list.
 */
export function useAgentNames(urls: () => Urls) {
  const c = useContributors(urls);
  const known = $derived(agentNames(c.list ?? []));
  return {
    label: (actor: string, by?: ActedBy | null) => {
      c.note(by?.agent);
      return actorLabel(actor, by, known);
    },
    note: c.note,
  };
}
