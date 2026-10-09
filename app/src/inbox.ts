import { useEffect } from "react";
import { api, useLoad } from "./api";

/*
 * The inbox's count (TEMPRA-72), shared by the headers and the inbox page. Kept apart from the
 * page so the chrome can show it without importing pages.
 */

/** Said on window when the inbox may have changed (a comment on an open feed, a mark). */
export const INBOX_EVENT = "tempra:inbox";

export const inboxChanged = () => window.dispatchEvent(new Event(INBOX_EVENT));

/** The unread count, for the headers' Inbox link: reloads when told the inbox changed. */
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
