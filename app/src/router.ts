import { useEffect, useState } from "react";
import type { LedgerFilters } from "./urls";

/** The pages the app draws itself; every other URL is a server page, loaded in full. */
export type Route =
  | { page: "libraries" }
  | { page: "welcome" }
  | { page: "connect" }
  | { page: "tokens"; library: string | null }
  | { page: "apps" }
  | { page: "account"; done: string | null }
  | { page: "invitations" }
  | { page: "inbox"; all: boolean }
  | { page: "members"; owner: string; slug: string }
  | { page: "work"; owner: string; slug: string; kind?: string }
  | { page: "transfer"; owner: string; slug: string }
  | { page: "recovery"; owner: string; slug: string }
  | { page: "library-connect"; owner: string; slug: string }
  | { page: "delete"; owner: string; slug: string }
  | { page: "revert"; owner: string; slug: string; request: string }
  | { page: "restore"; owner: string; slug: string; path: string; to?: number }
  | { page: "directory"; owner: string; slug: string; dir: string; at?: number }
  | { page: "file"; owner: string; slug: string; path: string; at?: number }
  | { page: "ledger"; owner: string; slug: string; filters: LedgerFilters; done: Done }
  | { page: "diff"; owner: string; slug: string; path: string; from?: number; to?: number };

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
  if (path === "/") return { page: "libraries" };
  // The account's pages; sign-in, consent and the email-change link are server pages.
  if (path === "/welcome") return { page: "welcome" };
  if (path === "/connect") return { page: "connect" };
  if (path === "/tokens") return { page: "tokens", library: q.get("library") };
  if (path === "/apps") return { page: "apps" };
  if (path === "/account") return { page: "account", done: q.get("done") };
  if (path === "/invitations") return { page: "invitations" };
  if (path === "/inbox") return { page: "inbox", all: q.get("all") === "1" };
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
        return { page: "file", owner, slug, path: decodePath(tail), at };
      case "ledger": {
        if (tail !== "") return null;
        const s = (k: string) => q.get(k)?.trim() || undefined;
        const done = s("done");
        return {
          page: "ledger",
          owner,
          slug,
          filters: {
            prefix: s("prefix"),
            actor: s("actor"),
            from: s("from"),
            to: s("to"),
            before: int(q.get("before")),
          },
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
  return { page: "file", owner, slug, path: decodePath(rest), at };
}

const NAVIGATE = "tempra:navigate";

/** How the app last moved: to a new page, or back or forward through history. */
let lastMove: "push" | "pop" = "push";
export const lastNavigation = () => lastMove;

/** The account's own pages, which no handle can collide with (they are reserved names). */
const ACCOUNT_PAGES = new Set([
  "/",
  "/welcome",
  "/connect",
  "/tokens",
  "/apps",
  "/account",
  "/invitations",
  "/inbox",
]);

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
 * Same-site links the app draws are followed in place: a link into the signed-in person's own
 * libraries (handles never collide with the site's fixed routes) or to the library list. Links
 * with a target, a download, a modifier key, or only a different #fragment behave as usual.
 */
export function interceptLinks(handle: () => string | null) {
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
      return;
    }
    const a = (e.target as Element | null)?.closest?.("a");
    if (!a || a.target || a.hasAttribute("download") || !a.href) return;
    const url = new URL(a.href);
    if (url.origin !== location.origin) return;
    if (url.pathname === location.pathname && url.search === location.search && url.hash) return;
    const first = decodeURIComponent(url.pathname.split("/")[1] ?? "");
    const ours = ACCOUNT_PAGES.has(url.pathname) || (first !== "" && first === handle());
    if (!ours || !match(url)) return;
    e.preventDefault();
    navigate(url.href);
  });
}
