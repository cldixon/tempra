import { agentLabel, type Contributor } from "./agents";
import { api } from "./api";
import { type AgentLabels, INBOX_EVENT, type InboxItem, type PageTitles } from "./inbox";
import { useLoad } from "./load.svelte.ts";
import { Urls } from "./urls";

/** The unread count, for the bell and the sidebar's Inbox row: reloads when told it changed. */
export function useUnread() {
  const loaded = useLoad(
    () => "inbox-count",
    () => api<{ unread: number }>("/api/v1/inbox/count"),
  );
  $effect(() => {
    const reload = () => loaded.reload();
    window.addEventListener(INBOX_EVENT, reload);
    window.addEventListener("focus", reload);
    return () => {
      window.removeEventListener(INBOX_EVENT, reload);
      window.removeEventListener("focus", reload);
    };
  });
  return {
    get current(): number {
      return loaded.data?.unread ?? 0;
    },
  };
}

/**
 * The agents of the libraries agents' items are in (`GET …/agents`), as labels by actor. An
 * actor two people's agents share ("claude-ai/connector") cannot tell them apart, so it keeps
 * the agent's plain name.
 */
export function useAgentLabels(items: () => InboxItem[] | null) {
  const want = $derived(
    [...new Set((items() ?? []).filter((i) => i.agent).map((i) => i.library))].sort(),
  );
  const loaded = useLoad(
    () => `inbox agents ${want.join(" ")}`,
    async () => {
      const out: AgentLabels = {};
      const shared = new Set<string>();
      await Promise.all(
        want.map(async (library) => {
          const [owner = "", slug = ""] = library.split("/");
          try {
            const r = await api<{ contributors: Contributor[] }>(
              new Urls(owner, slug).api("agents"),
            );
            for (const c of r.contributors) {
              if (!c.agent) continue;
              const key = `${library} ${c.actor}`;
              const label = agentLabel(c);
              if (key in out && out[key] !== label) shared.add(key);
              out[key] = label;
            }
          } catch {
            // A library out of reach names its agents by their plain names.
          }
        }),
      );
      for (const key of shared) delete out[key];
      return out;
    },
  );
  return {
    get current(): AgentLabels {
      return loaded.data ?? {};
    },
  };
}

/**
 * The titles of the pages items are on, where an item has none of its own (a reply or a
 * mention carries only the path): read from each such library's outline, the index the tree
 * loads (`GET …/outline`), so a row always names a page by its title.
 */
export function usePageTitles(items: () => InboxItem[] | null) {
  const want = $derived(
    [...new Set((items() ?? []).filter((i) => i.path && !i.title).map((i) => i.library))].sort(),
  );
  const loaded = useLoad(
    () => `inbox titles ${want.join(" ")}`,
    async () => {
      const out: PageTitles = {};
      await Promise.all(
        want.map(async (library) => {
          const [owner = "", slug = ""] = library.split("/");
          try {
            const r = await api<{ files: { path: string; title?: string | null }[] }>(
              new Urls(owner, slug).api("outline"),
            );
            for (const f of r.files) if (f.title) out[`${library} ${f.path}`] = f.title;
          } catch {
            // A library out of reach names its pages by path, as before.
          }
        }),
      );
      return out;
    },
  );
  return {
    get current(): PageTitles {
      return loaded.data ?? {};
    },
  };
}
