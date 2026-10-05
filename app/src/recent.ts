import type { Urls } from "./urls";

/** A file opened recently in a library, for the quick switcher (this browser only). */
export interface Recent {
  path: string;
  title: string;
}

const MAX = 12;
const key = (urls: Urls) => `tempra:recent:${urls.owner}/${urls.slug}`;

/** The library's recently opened files, newest first. Storage may be missing or refuse. */
export function readRecent(urls: Urls): Recent[] {
  try {
    const v = JSON.parse(localStorage.getItem(key(urls)) ?? "[]") as unknown;
    return Array.isArray(v)
      ? v.filter(
          (r): r is Recent =>
            typeof r === "object" &&
            r !== null &&
            typeof r.path === "string" &&
            typeof r.title === "string",
        )
      : [];
  } catch {
    return [];
  }
}

export function pushRecent(urls: Urls, r: Recent) {
  try {
    const rest = readRecent(urls).filter((x) => x.path !== r.path);
    localStorage.setItem(key(urls), JSON.stringify([r, ...rest].slice(0, MAX)));
  } catch {
    // Private mode or storage off: the switcher just has no recent files.
  }
}
