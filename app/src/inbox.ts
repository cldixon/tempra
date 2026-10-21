import { useEffect } from "react";
import { api, useLoad } from "./api";
import { day } from "./ui";

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
  | "report"
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

/** Marks items read (these ids, or all of them), then tells every count to reload. */
export function markRead(ids?: string[]): Promise<void> {
  return api("/api/v1/inbox/read", {
    method: "POST",
    body: JSON.stringify(ids ? { ids } : {}),
  })
    .then(inboxChanged)
    .catch(() => {});
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
export function itemTitle(i: InboxItem): string {
  if (i.path) return i.title || pageName(i.path);
  return i.library.replace("/", " / ");
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
    default:
      return "Report";
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

/** The bell's one line: "Claude Code replied on Reader". */
export function bellLine(i: InboxItem): { lead: string; on: string | null } {
  const page = i.path ? itemTitle(i) : null;
  switch (i.kind) {
    case "reply":
      return { lead: `${i.who} replied on`, on: page };
    case "mention":
      return { lead: `${i.who} mentioned you on`, on: page };
    case "thread":
      return { lead: `${i.who} opened a thread on`, on: page };
    case "verify":
      return { lead: `${i.who} changed a page you verified,`, on: page };
    case "stale":
      return { lead: kindLabel(i), on: page };
    case "invitation":
      return { lead: `${i.who} invited you to`, on: i.library.split("/").pop() ?? i.library };
    case "access":
      return { lead: `${i.who} changed your access to`, on: i.library };
    default:
      return { lead: i.excerpt, on: page };
  }
}

/** Where following the item leads: a thread opens in the page's Comments panel. */
export function itemHref(i: InboxItem): string {
  if (i.thread && i.path && (i.kind === "reply" || i.kind === "mention" || i.kind === "thread")) {
    return i.href.replace(/#comments$/, `#thread-${encodeURIComponent(i.thread)}`);
  }
  return i.href;
}
