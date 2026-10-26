import { prefetch } from "./api";
import type { Route } from "./router";
import { type Urls, urlsFor } from "./urls";

/**
 * What a library's pages load first, by page (tempra-dev: app/workspace): the file's page, the
 * home and Activity register how, under the key their `useLoad` keeps it by. A link pointed at
 * loads its page ahead (`links.ts`, TEMPRA-193), the switcher its selected file (`prefetchFile`);
 * a navigation waits a moment for the next page's load before it replaces the one on screen
 * (`hold.ts`, TEMPRA-194).
 * A registry, so those parts do not import the pages.
 */
export interface PageLoad {
  key: string;
  load: () => Promise<unknown>;
}

type LibraryRoute = Extract<Route, { owner: string }>;
type Loader<P extends LibraryRoute["page"]> = (
  route: Extract<LibraryRoute, { page: P }>,
  urls: Urls,
) => PageLoad | null;

const loaders = new Map<string, Loader<LibraryRoute["page"]>>();

export function registerPage<P extends LibraryRoute["page"]>(page: P, fn: Loader<P>) {
  loaders.set(page, fn as unknown as Loader<LibraryRoute["page"]>);
}

/** What the page at a route loads first, or null when it registered nothing. */
export function pageLoad(route: Route | null): PageLoad | null {
  if (!route || !("owner" in route)) return null;
  const fn = loaders.get(route.page);
  const at = "at" in route ? route.at : undefined;
  return fn ? fn(route, urlsFor(route.owner, route.slug, at)) : null;
}

export function prefetchFile(urls: Urls, path: string) {
  const l = pageLoad({ page: "file", owner: urls.owner, slug: urls.slug, path, at: urls.at });
  if (l) prefetch(l.key, l.load);
}
