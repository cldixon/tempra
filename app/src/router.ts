import { useEffect, useState } from "react";
import { type ActivityFilters, type ActivityView, inboxUrl } from "./urls";

/** The pages the app draws itself; every other URL is a server page, loaded in full. */
export type Route =
  | { page: "libraries"; create: boolean }
  | { page: "welcome" }
  | { page: "connect" }
  | { page: "tokens"; library: string | null }
  | { page: "apps" }
  | { page: "account"; done: string | null }
  | { page: "notifications" }
  | { page: "invitations" }
  | { page: "inbox"; done: boolean; library: string | null }
  /** A page that moved: the app replaces the URL with `to` (as the server answers with a 308). */
  | { page: "redirect"; to: string }
  | { page: "members"; owner: string; slug: string }
  | { page: "work"; owner: string; slug: string; kind?: string }
  | { page: "settings"; owner: string; slug: string }
  | { page: "activity"; owner: string; slug: string; filters: ActivityFilters; done: Done }
  | { page: "transfer"; owner: string; slug: string }
  | { page: "recovery"; owner: string; slug: string }
  | { page: "library-connect"; owner: string; slug: string }
  | { page: "delete"; owner: string; slug: string }
  | { page: "revert"; owner: string; slug: string; request: string }
  | { page: "restore"; owner: string; slug: string; path: string; to?: number }
  | { page: "directory"; owner: string; slug: string; dir: string; at?: number }
  | {
      page: "file";
      owner: string;
      slug: string;
      path: string;
      at?: number;
      /** A concept's page compares: in review mode, or against a version (`?since=`). */
      compare?: Compare;
    }
  | { page: "diff"; owner: string; slug: string; path: string; from?: number; to?: number };

/** What a concept's page draws its body against: the last verification, or a chosen version. */
export type Compare = { kind: "review" } | { kind: "since"; seq: number };

/** A confirmation from a server form that redirected back here (`?done=`). */
export type Done = { kind: string; n?: number } | null;

const decode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};
const decodePath = (rest: string) => rest.split("/").map(decode).join("/").replace(/\/+$/, "");

function int(v: string | null): number | undefined {
  if (v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}

const SERVER_ROOTS = new Set([
  "account",
  "api",
  "app",
  "apps",
  "authorize",
  "connect",
  "dl",
  "mcp",
  "sign-in",
  "sign-out",
  "tokens",
  "welcome",
  "_app",
  "_design",
  ".well-known",
]);

/** The app's page for a URL, following the server's routes (tempra-dev: v2/urls-and-handles). */
export function match(url: URL): Route | null {
  const path = url.pathname;
  const q = url.searchParams;
  if (path === "/") return { page: "libraries", create: q.get("new") === "1" };
  // The account's pages; sign-in, consent and the email-change link are server pages.
  if (path === "/welcome") return { page: "welcome" };
  if (path === "/connect") return { page: "connect" };
  if (path === "/tokens") return { page: "tokens", library: q.get("library") };
  if (path === "/apps") return { page: "apps" };
  if (path === "/account") return { page: "account", done: q.get("done") };
  if (path === "/notifications") return { page: "notifications" };
  if (path === "/invitations") return { page: "invitations" };
  // The Inbox (take 4, TEMPRA-116): Open or Done (take 3's `?all=1` showed done ones too), all
  // libraries or one.
  if (path === "/inbox") {
    return {
      page: "inbox",
      done: q.get("done") === "1" || q.get("all") === "1",
      library: q.get("library")?.trim() || null,
    };
  }
  const m = /^\/([^/]+)\/([^/]+)\/(.*)$/.exec(path);
  if (!m) return null;
  const owner = decode(m[1] ?? "");
  // The server's own paths (reserved, so never a handle): /account/email/confirm and the like.
  if (SERVER_ROOTS.has(owner)) return null;
  const slug = decode(m[2] ?? "");
  const rest = m[3] ?? "";
  const at = int(q.get("at"));
  if (rest === "") return { page: "directory", owner, slug, dir: "", at };
  if (rest.startsWith("-/")) {
    const [, pageName = "", tail = ""] = /^-\/([^/]+)\/?(.*)$/.exec(rest) ?? [];
    switch (pageName) {
      case "tree":
        return { page: "directory", owner, slug, dir: decodePath(tail), at };
      case "files":
        return { page: "file", owner, slug, path: decodePath(tail), at, compare: compareOf(q) };
      // The ledger is Activity's Every event view at its own address (take 4, TEMPRA-115).
      case "ledger":
      case "activity": {
        if (tail !== "") return null;
        const done = q.get("done")?.trim();
        return {
          page: "activity",
          owner,
          slug,
          filters: activityFilters(q, pageName === "ledger" ? "events" : undefined),
          done: done ? { kind: done, n: int(q.get("n")) } : null,
        };
      }
      case "diff":
        return {
          page: "diff",
          owner,
          slug,
          path: decodePath(tail),
          from: int(q.get("from")),
          to: int(q.get("to")),
        };
      case "work":
        return tail === "" ? { page: "work", owner, slug, kind: q.get("kind") || undefined } : null;
      // The old `-/needs` URL: the Inbox, filtered to the library (TEMPRA-116).
      case "needs":
        return tail === ""
          ? { page: "redirect", to: inboxUrl({ library: `${owner}/${slug}` }) }
          : null;
      case "settings":
      case "transfer":
      case "recovery":
      case "delete":
      case "members":
        return tail === "" ? { page: pageName, owner, slug } : null;
      case "connect":
        return tail === "" ? { page: "library-connect", owner, slug } : null;
      case "revert":
        return tail !== "" && !tail.includes("/")
          ? { page: "revert", owner, slug, request: decode(tail) }
          : null;
      case "restore":
        return { page: "restore", owner, slug, path: decodePath(tail), to: int(q.get("to")) };
      default:
        return null;
    }
  }
  if (rest.endsWith("/")) return { page: "directory", owner, slug, dir: decodePath(rest), at };
  return { page: "file", owner, slug, path: decodePath(rest), at, compare: compareOf(q) };
}

/**
 * Activity's view and filters from its URL; `-/ledger` asks for Every event. Take 3's ledger
 * filters map where they can (`prefix`, `actor`); its dates and `before` cursor are dropped (the
 * table pages back in place), as are take 3 Activity's `comments=hide`.
 */
function activityFilters(q: URLSearchParams, view?: ActivityView): ActivityFilters {
  const s = (k: string) => q.get(k)?.trim() || undefined;
  const who = q.get("who");
  return {
    view: view ?? (q.get("view") === "events" ? "events" : "summary"),
    who: who === "agents" || who === "people" ? who : "everyone",
    prefix: s("prefix"),
    actor: s("actor"),
    kind: s("kind"),
    q: s("q"),
  };
}

function compareOf(q: URLSearchParams): Compare | undefined {
  if (q.get("review") === "1") return { kind: "review" };
  const since = int(q.get("since"));
  return since === undefined ? undefined : { kind: "since", seq: since };
}

/**
 * Which page is on screen: a new key starts the page afresh, with two exceptions. A concept's page
 * stays mounted while only how it is shown changes (`?since=`, `?review=`, `?panel=`, `?done=`),
 * so its open panel stays open (tempra-dev: app/reader, The panels); another file or a pinned
 * version (`?at=`) is another page. Activity keeps its page across its own view and filter
 * changes (a text filter keeps focus while the URL follows it).
 */
export function pageKey(url: URL, route: Route | null): string {
  const at = url.searchParams.get("at");
  if (route?.page === "file") return `${url.pathname}${at === null ? "" : `?at=${at}`}`;
  if (route?.page === "activity") return url.pathname;
  return url.pathname + url.search;
}

const NAVIGATE = "tempra:navigate";

/** How the app last moved: to a new page, or back or forward through history. */
let lastMove: "push" | "pop" = "push";
export const lastNavigation = () => lastMove;

/** Goes to a URL without reloading when the app draws it, otherwise loads it in full. */
export function navigate(href: string, opts: { replace?: boolean } = {}) {
  const url = new URL(href, location.href);
  if (url.origin !== location.origin || !match(url)) {
    location.assign(url.href);
    return;
  }
  if (opts.replace) history.replaceState(null, "", url.href);
  else history.pushState(null, "", url.href);
  lastMove = "push";
  window.dispatchEvent(new Event(NAVIGATE));
  if (!url.hash) window.scrollTo(0, 0);
}

/** The current URL, updated on navigation and on back and forward. */
export function useLocation(): URL {
  const [url, setUrl] = useState(() => new URL(location.href));
  useEffect(() => {
    const update = () => setUrl(new URL(location.href));
    const back = () => {
      lastMove = "pop";
      update();
    };
    window.addEventListener(NAVIGATE, update);
    window.addEventListener("popstate", back);
    return () => {
      window.removeEventListener(NAVIGATE, update);
      window.removeEventListener("popstate", back);
    };
  }, []);
  return url;
}

/**
 * Whether a link is followed in place: a same-site URL the app draws (`match`), so every account
 * page and any library's pages, the person's own or one shared with them (handles never collide
 * with the site's fixed routes). Downloads and server pages under a library (`-/raw/…`) are not.
 */
export function followsInPlace(url: URL, here: string = location.origin): boolean {
  return url.origin === here && match(url) !== null;
}

/**
 * Same-site links the app draws are followed in place (`followsInPlace`). Links with a target, a
 * download, a modifier key, or only a different #fragment behave as usual.
 */
export function interceptLinks() {
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
      return;
    }
    const a = (e.target as Element | null)?.closest?.("a");
    if (!a || a.target || a.hasAttribute("download") || !a.href) return;
    const url = new URL(a.href);
    if (url.origin !== location.origin) return;
    if (url.pathname === location.pathname && url.search === location.search && url.hash) return;
    if (!followsInPlace(url)) return;
    e.preventDefault();
    navigate(url.href);
  });
}
