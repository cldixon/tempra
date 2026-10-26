import { cache } from "./api";
import { type PageLoad, pageLoad } from "./prefetch";
import { match } from "./router";

/**
 * Loading a page ahead from any link people point at (TEMPRA-193; tempra-dev: app/workspace): a
 * hover usually comes 100 ms or more before the click, which covers most of a warm request. One
 * delegated listener for the frame (links.svelte.ts) asks this which links are worth it.
 */

/** How long the pointer or the keyboard rests on a link before its page is loaded ahead, so a sweep across the page loads nothing. */
export const LINK_REST_MS = 80;

/**
 * What following a link would load first, when it is worth loading ahead; null otherwise. Only
 * the app's own pages that registered a load (prefetch.ts), within `library` when the frame is a
 * library's (an account page, the Inbox, follows links into any library); never a link that opens
 * elsewhere, a download, another site, or a page already in the cache (it draws from there at once
 * and is checked again when it opens).
 */
export function linkLoad(
  a: HTMLAnchorElement,
  library: { owner: string; slug: string } | null,
  origin: string = location.origin,
): PageLoad | null {
  if (!a.href || a.target || a.hasAttribute("download")) return null;
  const url = new URL(a.href);
  if (url.origin !== origin) return null;
  const route = match(url);
  if (!route || !("owner" in route)) return null;
  if (library && (route.owner !== library.owner || route.slug !== library.slug)) return null;
  const load = pageLoad(route);
  if (!load || cache.has(load.key)) return null;
  return load;
}

/** The link an event happened on, if any. */
export function linkOf(target: EventTarget | null): HTMLAnchorElement | null {
  const a = target instanceof Element ? target.closest("a[href]") : null;
  return a instanceof HTMLAnchorElement ? a : null;
}
