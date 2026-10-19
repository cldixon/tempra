import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Account, Apps, ConnectAccount, Invitations, Tokens, Welcome } from "./pages/Account";
import { Activity } from "./pages/Activity";
import { Diff } from "./pages/Diff";
import { File } from "./pages/File";
import { Folder } from "./pages/Folder";
import { Home } from "./pages/Home";
import { Inbox } from "./pages/Inbox";
import { Ledger } from "./pages/Ledger";
import { Libraries } from "./pages/Libraries";
import {
  ConnectLibrary,
  DeleteLibrary,
  Members,
  Recovery,
  Restore,
  Revert,
  Transfer,
  Work,
} from "./pages/Manage";
import { NeedsYou } from "./pages/NeedsYou";
import { interceptLinks, match, useLocation } from "./router";
import { Header, PageBoundary, useMe } from "./ui";
import { Urls } from "./urls";
import { type Place, SheetPage, Workspace } from "./Workspace";

let handle: string | null = null;

/** The pages that lay out the sheet themselves (a concept's margins, the person's views). */
const OWN_SHEET = new Set(["file", "directory", "needs", "activity"]);

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
  if (!route) {
    // The Worker serves this page only at the app's own URLs, so this is a bug, not a 404.
    page = <h1>Not found</h1>;
  } else if (route.page === "libraries") {
    page = <Libraries />;
  } else if (route.page === "welcome") {
    page = <Welcome me={who} />;
  } else if (route.page === "connect") {
    page = <ConnectAccount />;
  } else if (route.page === "tokens") {
    page = <Tokens me={who} library={route.library} />;
  } else if (route.page === "apps") {
    page = <Apps />;
  } else if (route.page === "account") {
    page = <Account done={route.done} />;
  } else if (route.page === "invitations") {
    page = <Invitations />;
  } else if (route.page === "inbox") {
    page = <Inbox all={route.all} />;
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
      case "ledger":
      case "revert":
        place.view = "ledger";
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
      case "needs":
        page = <NeedsYou urls={urls} />;
        break;
      case "activity":
        page = <Activity urls={urls} actor={actor} />;
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
      case "ledger":
        page = <Ledger urls={urls} filters={route.filters} done={route.done} actor={actor} />;
        break;
      case "diff":
        page = <Diff urls={urls} path={route.path} from={route.from} to={route.to} />;
        break;
      case "work":
        page = <Work urls={urls} kind={route.kind} />;
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
  const boundary = <PageBoundary key={url.pathname + url.search}>{page}</PageBoundary>;
  // A library's pages share one workspace, kept mounted while the person moves within it.
  if (library) {
    const { urls, place } = library;
    // The library's own views lay out their sheet; its settings and tools share one column.
    const own = route && OWN_SHEET.has(route.page);
    return (
      <Workspace key={`${urls.owner}/${urls.slug}`} urls={urls} place={place} me={who}>
        {own ? boundary : <SheetPage>{boundary}</SheetPage>}
      </Workspace>
    );
  }
  return (
    <>
      <Header me={who} />
      <main className="page">{boundary}</main>
    </>
  );
}

interceptLinks(() => handle);
createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
