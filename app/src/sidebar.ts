/*
 * The frame's sidebars (take 4, TEMPRA-113; tempra-dev: app/workspace): a library's (the tree,
 * then a fixed foot of its tools: Activity, Settings; TEMPRA-145, after Linear's docs; its
 * Settings is one page in the same frame), the account's (Libraries, the person's libraries) and
 * the account's settings' (a way back, then each page). The bar over them holds
 * the mark, the library and its switcher, and search. On a phone each is the drawer's content
 * under the same at its head. The Inbox is the bell's (TEMPRA-189), in no sidebar.
 */

import type { AccountPage } from "./frame";
import { isShared, type ReachableLibrary } from "./role";
import type { Urls } from "./urls";

/** The account settings' pages, in the sidebar's order. */
export const ACCOUNT_SETTINGS: readonly [AccountPage, string, string][] = [
  ["account", "/account", "Account"],
  ["agents", "/agents", "Agents"],
];

/** The person's libraries by kind: their own, then those shared with them. */
export function byKind(list: ReachableLibrary[]) {
  return {
    yours: list.filter((l) => !isShared(l)),
    shared: list.filter(isShared),
  };
}

const hiddenKey = (urls: Urls) => `tempra:sidebar:${urls.owner}/${urls.slug}`;

/** Whether the person hid the sidebar in this library (a reading mode, remembered per library). */
export function loadHidden(urls: Urls): boolean {
  try {
    return localStorage.getItem(hiddenKey(urls)) === "hidden";
  } catch {
    return false;
  }
}

export function saveHidden(urls: Urls, hidden: boolean) {
  try {
    if (hidden) localStorage.setItem(hiddenKey(urls), "hidden");
    else localStorage.removeItem(hiddenKey(urls));
  } catch {
    // Storage off: the sidebar shows again next time.
  }
}
