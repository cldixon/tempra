import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import {
  Account,
  Apps,
  ConnectAccount,
  Invitations,
  Notifications,
  Tokens,
  Welcome,
} from "./pages/Account";
import { Activity } from "./pages/Activity";
import { Diff } from "./pages/Diff";
import { File } from "./pages/File";
import { Folder } from "./pages/Folder";
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
  Work,
} from "./pages/Manage";
import { interceptLinks, match, navigate, useLocation } from "./router";
import { PageBoundary, useMe } from "./ui";
import { Urls } from "./urls";
import { AccountFrame, type AccountPage, PageColumn, type Place, Workspace } from "./Workspace";

let handle: string | null = null;

/** The pages that lay out their column themselves (a concept's columns, the person's views). */
const OWN_COLUMN = new Set(["file", "directory", "activity"]);

/** A page that moved (`-/needs`, into the Inbox): the URL is replaced, as the server's 308 does. */
function Redirect({ to }: { to: string }) {
  useEffect(() => navigate(to, { replace: true }), [to]);
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
  handle = who?.handle ?? null;
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
  } else if (route.page === "connect") {
    account = "connect";
    page = <ConnectAccount />;
  } else if (route.page === "tokens") {
    account = "tokens";
    page = <Tokens me={who} library={route.library} />;
  } else if (route.page === "apps") {
    account = "apps";
    page = <Apps />;
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
        page = route.dir === "" ? <Home urls={urls} /> : <Folder urls={urls} dir={route.dir} />;
        break;
      case "activity":
        page = <Activity urls={urls} actor={actor} filters={route.filters} done={route.done} />;
        break;
      case "file":
        page = (
          <File
            urls={urls}
            path={route.path}
            done={url.searchParams.get("done")}
            actor={actor}
            compare={route.compare ?? null}
          />
        );
        break;
      case "diff":
        page = <Diff urls={urls} path={route.path} from={route.from} to={route.to} />;
        break;
      case "work":
        page = <Work urls={urls} kind={route.kind} />;
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
  // A page starts afresh on a new URL, with two exceptions. A concept's page stays mounted while
  // only how it is shown changes (`?since=`, `?review=`, `?panel=`, `?done=`), so its open panel
  // stays open (tempra-dev: app/reader, The panels); a pinned version (`?at=`) is another page.
  // Activity keeps its page across its own view and filter changes (a text filter keeps focus
  // while the URL follows it).
  const at = url.searchParams.get("at");
  const pageKey =
    route?.page === "file"
      ? `${url.pathname}${at === null ? "" : `?at=${at}`}`
      : route?.page === "activity"
        ? url.pathname
        : url.pathname + url.search;
  const boundary = <PageBoundary key={pageKey}>{page}</PageBoundary>;
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

interceptLinks(() => handle);
createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
