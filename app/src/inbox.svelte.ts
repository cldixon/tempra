import { actorAgentName, agentLabel, type Contributor, readableName } from "./agents.svelte.ts";
import { api } from "./api";
import { useLoad } from "./load.svelte.ts";
import { libraryLabel } from "./role.svelte.ts";
import { Urls } from "./urls";

/*
 * The Inbox's items and count (TEMPRA-72; take 4, TEMPRA-116), shared by the bell and the Inbox
 * page. Kept apart from the page so the chrome can show it without importing pages.
 */

/** What a person is told of (TEMPRA-173): an invitation, a mention and a reply, nothing else. */
export type InboxKind = "reply" | "mention" | "invitation";

/** One item, as `GET /api/v1/inbox` describes it. */
export interface InboxItem {
  id: string;
  kind: InboxKind;
  /** The library as owner/slug. */
  library: string;
  library_title: string | null;
  path: string | null;
  thread: string | null;
  /** The concept's title, when the item is on one. */
  title: string | null;
  actor: string;
  /** Who did it, as people read it: an agent by its name, a person by their handle. */
  who: string;
  agent: boolean;
  excerpt: string;
  /** `invitation`: the invitation to accept or decline, while it is open. */
  invitation: string | null;
  created: string;
  read_at: string | null;
  done_at: string | null;
  /** What the row offers: reply, resolve, open, accept, decline. */
  actions: string[];
  href: string;
}

export interface InboxPage {
  items: InboxItem[];
  next: string | null;
  unread: number;
  open: number;
}

/** Said on window when the inbox may have changed (a comment or write on an open feed, a mark). */
export const INBOX_EVENT = "tempra:inbox";

export const inboxChanged = (): void => {
  window.dispatchEvent(new Event(INBOX_EVENT));
};

/**
 * Marks items read (these ids, or all of them, or all of one library's: `owner/slug`), then
 * tells every count to reload.
 */
export function markRead(ids?: string[], library?: string | null): Promise<void> {
  return api("/api/v1/inbox/read", {
    method: "POST",
    body: JSON.stringify(markReadBody(ids, library)),
  })
    .then(inboxChanged)
    .catch(() => {});
}

/** What Mark all read asks for: these items, or all of one library's, or all of them. */
export function markReadBody(
  ids?: string[],
  library?: string | null,
): { ids?: string[]; library?: string } {
  if (ids) return { ids };
  return library ? { library } : {};
}

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


/** A path's last part without .md: what names a page that has no title. */
const pageName = (path: string) => path.replace(/\.md$/, "").split("/").pop() ?? path;

/**
 * The item's library as people read it (libraryLabel, TEMPRA-131): its title, else its slug;
 * the owner after it when it is not the person's own (`me` is their handle).
 */
export function itemLibrary(
  i: Pick<InboxItem, "library" | "library_title">,
  me: string | null,
): string {
  const [owner = "", slug = i.library] = i.library.split("/");
  return libraryLabel({
    owner,
    slug,
    title: i.library_title,
    role: me === null || owner === me ? "owner" : "read",
  });
}

/** What the item is about: the page, or the library for an invitation or an access change. */
export function itemTitle(i: InboxItem, titles: PageTitles = {}): string {
  if (i.path) return i.title || titles[`${i.library} ${i.path}`] || pageName(i.path);
  return i.library_title || (i.library.split("/").pop() ?? i.library);
}

/** Agents' names by "owner/slug actor", for items whose actor is an agent (useAgentLabels). */
export type AgentLabels = Record<string, string>;

/**
 * Who did it, as people read it (AgentName's words, TEMPRA-131): an agent named for its person
 * ("Claude Code for @dev") when the library's agents tell which one it is, else by its readable
 * name ("Claude Code", never "claude-code/local"); a person by their handle.
 */
export function itemWho(
  i: Pick<InboxItem, "who" | "actor" | "agent" | "library">,
  labels: AgentLabels = {},
): string {
  if (!i.agent) return i.who;
  const known = labels[`${i.library} ${i.actor}`];
  if (known) return known;
  return i.who === i.actor ? actorAgentName(i.actor) : readableName(i.who);
}

/** Items with `who` in people's words (itemWho), for the row, the bell and the home's cards. */
export const withNames = (items: InboxItem[], labels: AgentLabels): InboxItem[] =>
  items.map((i) => ({ ...i, who: itemWho(i, labels) }));

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
          const r = await api<{ contributors: Contributor[] }>(new Urls(owner, slug).api("agents"));
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

/** Pages' titles by "owner/slug path", for items the server names by path only (replies). */
export type PageTitles = Record<string, string>;

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

/** The kind, as the row's meta line says it. */
export function kindLabel(i: InboxItem): string {
  switch (i.kind) {
    case "reply":
      return "Reply";
    case "mention":
      return "Mention";
    case "invitation":
      return "Invitation";
  }
}

/** The row's detail line: "Claude Code replied to your thread". */
export function itemDetail(i: InboxItem): string {
  switch (i.kind) {
    case "reply":
      return `${i.who} replied to your thread`;
    case "mention":
      return `${i.who} mentioned you`;
    case "invitation":
      return `${i.who} invited you to ${/write/i.test(i.excerpt) ? "write" : "read and comment"}`;
    default:
      return i.excerpt;
  }
}

/** The quote a row shows under its detail line: what was said, when something was. */
export function itemQuote(i: InboxItem): string | null {
  return i.kind === "invitation" ? null : i.excerpt || null;
}

/** Where following the item leads: a thread opens in the page's Comments panel. */
export function itemHref(i: InboxItem): string {
  if (i.thread && i.path && i.kind !== "invitation") {
    return i.href.replace(/#comments$/, `#thread-${encodeURIComponent(i.thread)}`);
  }
  return i.href;
}
