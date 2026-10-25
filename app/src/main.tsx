import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { Account, Agents, Invitations, Notifications, Welcome } from "./pages/Account";
import { Activity } from "./pages/Activity";
import { File } from "./pages/File";
import { Home } from "./pages/Home";
import { Inbox } from "./pages/Inbox";
import { Libraries } from "./pages/Libraries";
import {
  ConnectLibrary,
  DeleteLibrary,
  General,
  Members,
  Recovery,
  Restore,
  Revert,
  Transfer,
} from "./pages/Manage";
import { interceptLinks, match, navigate, pageKey, useLocation } from "./router";
import { PageBoundary, useMe } from "./ui";
import { Urls } from "./urls";
import { AccountFrame, type AccountPage, PageColumn, type Place, Workspace } from "./Workspace";

/** The pages that lay out their column themselves (a concept's columns, the person's views). */
const OWN_COLUMN = new Set(["file", "directory", "activity"]);

/** A page that moved (`-/needs` into the Inbox, `-/work` to the home): the URL is replaced, as the server's 308 does. */
function Redirect({ to }: { to: string }) {
  useEffect(() => navigate(to, { replace: true }), [to]);
  return null;
}

/**
 * A folder's address (TEMPRA-138; tempra-dev: decisions/folders-are-not-pages): a folder is a
 * group in the tree, not a page, so its address opens the home. The workspace hands the folder
 * to the tree (`place.dir`), which opens it and scrolls to it, and the address becomes the home's.
 */
function RevealFolder({ urls }: { urls: Urls }) {
  useEffect(() => navigate(urls.pinned(undefined).tree(""), { replace: true }), [urls]);
  return null;
}

/**
 * One Urls per library and pinned sequence, so pages and their memos see the same object
 * across renders (a fragment change re-renders the app; it must not remount the reader).
 */
const urlsCache = new Map<string, Urls>();
function urlsFor(owner: string, slug: string, at: number | undefined): Urls {
  const key = `${owner}/${slug}@${at ?? ""}`;
  let urls = urlsCache.get(key);
  if (!urls) {
    urls = new Urls(owner, slug, at);
    urlsCache.set(key, urls);
  }
  return urls;
}

function App() {
  const url = useLocation();
  const who = useMe();
  const route = match(url);
  const actor = who?.actor ?? "";
  let page: React.ReactNode = null;
  /** For a library's pages: the library and where in it the page is (the workspace frame). */
  let library: { urls: Urls; place: Place } | null = null;
  /** For the account's pages: which one, for its frame. */
  let account: AccountPage | null = null;
  if (!route) {
    // The Worker serves this page only at the app's own URLs, so this is a bug, not a 404.
    page = <h1>Not found</h1>;
  } else if (route.page === "libraries") {
    account = "libraries";
    page = <Libraries create={route.create} />;
  } else if (route.page === "welcome") {
    account = "welcome";
    page = <Welcome me={who} />;
  } else if (route.page === "agents") {
    account = "agents";
    page = <Agents me={who} newToken={route.newToken} library={route.library} />;
  } else if (route.page === "account") {
    account = "account";
    page = <Account done={route.done} />;
  } else if (route.page === "notifications") {
    account = "notifications";
    page = <Notifications />;
  } else if (route.page === "invitations") {
    account = "invitations";
    page = <Invitations />;
  } else if (route.page === "inbox") {
    account = "inbox";
    page = <Inbox done={route.done} library={route.library} />;
  } else if (route.page === "redirect") {
    account = "inbox";
    page = <Redirect to={route.to} />;
  } else {
    const urls = urlsFor(route.owner, route.slug, "at" in route ? route.at : undefined);
    const place: Place = { file: null, dir: null, view: null };
    switch (route.page) {
      case "directory":
        if (route.dir === "") place.view = "home";
        else place.dir = route.dir;
        break;
      case "file":
      case "diff":
      case "restore":
        place.file = route.path;
        break;
      case "revert":
        place.view = "activity";
        break;
      case "library-connect":
        place.view = "connect";
        break;
      default:
        place.view = route.page;
    }
    library = { urls: urlsFor(route.owner, route.slug, undefined), place };
    switch (route.page) {
      case "directory":
        page = route.dir === "" ? <Home urls={urls} /> : <RevealFolder urls={urls} />;
        break;
      case "activity":
        page = <Activity urls={urls} actor={actor} filters={route.filters} done={route.done} />;
        break;
      case "file":
        // Keyed by the file: nothing of one page (a panel, the Markdown view, the active thread)
        // carries to the next.
        page = (
          <File
            key={route.path}
            urls={urls}
            path={route.path}
            done={url.searchParams.get("done")}
            actor={actor}
            compare={route.compare ?? null}
          />
        );
        break;
      case "diff":
        // The take 3 Diff page is retired (TEMPRA-124): its address opens the concept's own
        // version view.
        page = <Redirect to={urls.diff(route.path, route.from, route.to)} />;
        break;
      case "settings":
        page = <General urls={urls} />;
        break;
      case "transfer":
        page = <Transfer urls={urls} />;
        break;
      case "recovery":
        page = <Recovery urls={urls} />;
        break;
      case "library-connect":
        page = <ConnectLibrary urls={urls} />;
        break;
      case "delete":
        page = <DeleteLibrary urls={urls} />;
        break;
      case "members":
        page = <Members urls={urls} me={who?.handle ?? null} />;
        break;
      case "revert":
        page = <Revert urls={urls} request={route.request} actor={actor} />;
        break;
      case "restore":
        page = <Restore urls={urls} path={route.path} to={route.to} actor={actor} />;
        break;
    }
  }
  const boundary = <PageBoundary key={pageKey(url, route)}>{page}</PageBoundary>;
  // A library's pages share one workspace, kept mounted while the person moves within it.
  if (library) {
    const { urls, place } = library;
    // The library's own views lay out their column; its settings and tools share one.
    const own = route && OWN_COLUMN.has(route.page);
    return (
      <Workspace key={`${urls.owner}/${urls.slug}`} urls={urls} place={place} me={who}>
        {own ? boundary : <PageColumn>{boundary}</PageColumn>}
      </Workspace>
    );
  }
  // The account's pages share its frame.
  return (
    <AccountFrame page={account ?? "libraries"} me={who}>
      <PageColumn>{boundary}</PageColumn>
    </AccountFrame>
  );
}

interceptLinks();
createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
