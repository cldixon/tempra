/*
 * The frame's sidebars (take 4, TEMPRA-113; tempra-dev: app/workspace): a library's (the tree,
 * then a fixed foot of its tools: Activity, Settings; TEMPRA-145, after Linear's docs), its
 * settings' (a way back, then the tabs by role), the account's (Libraries, the person's
 * libraries) and the account's settings' (a way back, then each page). The bar over them holds
 * the mark, the library and its switcher, and search. On a phone each is the drawer's content
 * under the same at its head. The Inbox is the bell's (TEMPRA-189), in no sidebar.
 */

import type { AccountPage, Place } from "./frame";
import { isShared, type ReachableLibrary } from "./role";
import type { Urls } from "./urls";

/**
 * The library's settings pages by role (tempra-dev: v2/sharing): a read member has Members (and
 * Leave on it), a write member also General and Connect, the owner also the recovery tools and
 * Delete. Nothing until the role is known, so no tab shows and then goes.
 */
export function settingsTabs(urls: Urls, role: string | null) {
  const owner = role === "owner";
  const writer = owner || role === "write";
  const all: [string, string, Place["view"], boolean][] = [
    ["General", urls.settings(), "settings", writer],
    ["Members", urls.members(), "members", role !== null],
    ["Connect", urls.connect(), "connect", writer],
    ["Import & export", urls.transfer(), "transfer", owner],
    ["Recovery", urls.recovery(), "recovery", owner],
    ["Delete library", urls.remove(), "delete", owner],
  ];
  return all.filter(([, , , shown]) => shown).map(([label, href, view]) => ({ label, href, view }));
}

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
