import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { api, useLoad } from "./api";
import { Account, Apps, ConnectAccount, Invitations, Tokens, Welcome } from "./pages/Account";
import { Diff } from "./pages/Diff";
import { Directory } from "./pages/Directory";
import { File } from "./pages/File";
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
import { interceptLinks, match, useLocation } from "./router";
import { Header, type Me, PageBoundary } from "./ui";
import { Urls } from "./urls";
import { type Place, Workspace } from "./Workspace";

let handle: string | null = null;

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
  const me = useLoad("me", () => api<Me>("/api/v1/me"));
  const who = me.state === "ready" ? me.data : null;
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
  } else {
    const urls = urlsFor(route.owner, route.slug, "at" in route ? route.at : undefined);
    const place: Place = { file: null, dir: null, view: null };
    switch (route.page) {
      case "directory":
        place.dir = route.dir;
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
        page = <Directory urls={urls} dir={route.dir} />;
        break;
      case "file":
        page = (
          <File urls={urls} path={route.path} done={url.searchParams.get("done")} actor={actor} />
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
    return (
      <Workspace
        key={`${urls.owner}/${urls.slug}`}
        urls={urls}
        place={place}
        me={who}
        bare={route?.page === "file" || route?.page === "directory"}
      >
        {boundary}
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
