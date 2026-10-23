import { useEffect } from "react";
import { api, useLoad } from "./api";
import { clip, day } from "./ui";
import { Urls } from "./urls";

/*
 * The Inbox's items and count (TEMPRA-72; take 4, TEMPRA-116), shared by the bell and the Inbox
 * page. Kept apart from the page so the chrome can show it without importing pages.
 */

export type InboxKind =
  | "reply"
  | "mention"
  | "thread"
  | "invitation"
  | "access"
  | "verify"
  | "stale";

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
  /** `verify`: edits since the person verified. */
  count: number | null;
  /** `stale`: the concept's stale_after. */
  due: string | null;
  /** `invitation`: the invitation to accept or decline, while it is open. */
  invitation: string | null;
  created: string;
  read_at: string | null;
  done_at: string | null;
  /** What the row offers: reply, resolve, review, dismiss, open, accept, decline. */
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
export function useUnread(): number {
  const loaded = useLoad("inbox-count", () => api<{ unread: number }>("/api/v1/inbox/count"));
  const { reload } = loaded;
  useEffect(() => {
    window.addEventListener(INBOX_EVENT, reload);
    window.addEventListener("focus", reload);
    return () => {
      window.removeEventListener(INBOX_EVENT, reload);
      window.removeEventListener("focus", reload);
    };
  }, [reload]);
  return loaded.state === "ready" ? loaded.data.unread : 0;
}

/** A path's last part without .md: what names a page that has no title. */
const pageName = (path: string) => path.replace(/\.md$/, "").split("/").pop() ?? path;

/** The library as a row names it: its title, else its slug. */
export const libraryLabel = (i: Pick<InboxItem, "library" | "library_title">) =>
  i.library_title || (i.library.split("/").pop() ?? i.library);

/** What the item is about: the page, or the library for an invitation or an access change. */
export function itemTitle(i: InboxItem, titles: PageTitles = {}): string {
  if (i.path) return i.title || titles[`${i.library} ${i.path}`] || pageName(i.path);
  return i.library_title || i.library.replace("/", " / ");
}

/** Pages' titles by "owner/slug path", for items the server names by path only (replies). */
export type PageTitles = Record<string, string>;

/**
 * The titles of the pages items are on, where an item has none of its own (a reply or a
 * mention carries only the path): read from each such library's outline, the index the tree
 * loads (`GET …/outline`), so a row always names a page by its title.
 */
export function usePageTitles(items: InboxItem[] | null): PageTitles {
  const want = [
    ...new Set((items ?? []).filter((i) => i.path && !i.title).map((i) => i.library)),
  ].sort();
  const loaded = useLoad(`inbox titles ${want.join(" ")}`, async () => {
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
  });
  return loaded.state === "ready" ? loaded.data : {};
}

/** The library's open items (`GET /api/v1/inbox?library=`), for its home's For you here. */
export function useLibraryInbox(library: string, limit = 20) {
  const q = new URLSearchParams({ limit: String(limit), library });
  const loaded = useLoad(`inbox ${q}`, () => api<InboxPage>(`/api/v1/inbox?${q}`));
  const { reload } = loaded;
  useEffect(() => {
    window.addEventListener(INBOX_EVENT, reload);
    window.addEventListener("focus", reload);
    return () => {
      window.removeEventListener(INBOX_EVENT, reload);
      window.removeEventListener("focus", reload);
    };
  }, [reload]);
  return loaded;
}

/** One thing for the person on a library's home, as a card: its kind, a title and a detail. */
export interface Card {
  key: string;
  kind: string;
  title: string;
  detail: string | null;
  href: string;
}

/**
 * The home's cards from the library's open Inbox items (the same items the Inbox lists, so
 * what is done there leaves the home too): one of each kind first (something said to the person,
 * a page to verify, a page going stale), then more in that order, up to `max`.
 */
export function forYouCards(items: InboxItem[], titles: PageTitles = {}, max = 3): Card[] {
  const card = (i: InboxItem): Card => {
    const page = itemTitle(i, titles);
    const said = i.kind === "reply" || i.kind === "mention" || i.kind === "thread";
    return {
      key: i.id,
      kind: kindLabel(i),
      title: said ? `${i.who} on ${page}` : page,
      detail: said ? (i.excerpt ? clip(i.excerpt, 80) : null) : itemDetail(i),
      href: itemHref(i),
    };
  };
  const group = (i: InboxItem) =>
    i.kind === "verify" ? 1 : i.kind === "stale" ? 2 : i.path ? 0 : 3;
  const kinds: InboxItem[][] = [[], [], [], []];
  for (const i of items) kinds[group(i)]?.push(i);
  const firsts = kinds.flatMap((k) => k.slice(0, 1));
  const rest = kinds.flatMap((k) => k.slice(1));
  return [...firsts, ...rest].slice(0, max).map(card);
}

/** The kind, as the row's meta line says it. */
export function kindLabel(i: InboxItem, now = Date.now()): string {
  switch (i.kind) {
    case "reply":
      return "Reply";
    case "mention":
      return "Mention";
    case "thread":
      return "New thread";
    case "verify":
      return "To verify";
    case "stale":
      return i.due && Date.parse(i.due) <= now ? "Stale" : "Going stale";
    case "invitation":
      return "Invitation";
    case "access":
      return "Access";
  }
}

/** The row's detail line: "Claude Code replied to your thread", "Stale on Oct 24". */
export function itemDetail(i: InboxItem, now = Date.now()): string {
  switch (i.kind) {
    case "reply":
      return `${i.who} replied to your thread`;
    case "mention":
      return `${i.who} mentioned you`;
    case "thread":
      return `${i.who} opened a thread`;
    case "verify": {
      const n = i.count ?? 1;
      return `${n} ${n === 1 ? "edit" : "edits"} by ${i.who} since you verified`;
    }
    case "stale":
      if (!i.due) return "Going stale";
      return `${Date.parse(i.due) <= now ? "Stale since" : "Stale on"} ${day(i.due)}`;
    case "invitation":
      return `${i.who} invited you to ${/write/i.test(i.excerpt) ? "write" : "read and comment"}`;
    case "access":
      return `${i.who} changed your access`;
    default:
      return i.excerpt;
  }
}

/** The quote a row shows under its detail line: what was said, when something was. */
export function itemQuote(i: InboxItem): string | null {
  if (i.kind === "reply" || i.kind === "mention" || i.kind === "thread" || i.kind === "access") {
    return i.excerpt || null;
  }
  return null;
}

/** Where following the item leads: a thread opens in the page's Comments panel. */
export function itemHref(i: InboxItem): string {
  if (i.thread && i.path && (i.kind === "reply" || i.kind === "mention" || i.kind === "thread")) {
    return i.href.replace(/#comments$/, `#thread-${encodeURIComponent(i.thread)}`);
  }
  return i.href;
}
