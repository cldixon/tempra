import type { Urls } from "./urls";

/**
 * Starting a file's page load before it opens (tempra-dev: app/workspace). The concept page
 * registers how; the tree and the switcher call `prefetchFile` on hover and selection. A
 * registry, so those parts do not import the page.
 */
let handler: ((urls: Urls, path: string) => void) | null = null;

export function registerPrefetch(fn: (urls: Urls, path: string) => void) {
  handler = fn;
}

export function prefetchFile(urls: Urls, path: string) {
  handler?.(urls, path);
}
