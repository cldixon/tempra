import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { type AgentChange, useAgentChanges } from "./changes";
import { AccountMenu, Bell, Icon } from "./chrome";
import { inboxChanged } from "./inbox";
import { useFeed, useFeedStatus } from "./live";
import { libraryLabel, useLibraries } from "./role";
import { lastNavigation } from "./router";
import {
  AccountSettingsSidebar,
  AccountSidebar,
  LibrarySidebar,
  LibrarySwitcher,
  SettingsSidebar,
} from "./Sidebar";
import { LibrarySearch, Switcher } from "./Switcher";
import type { OutlineFile } from "./Tree";
import { type Me, switcherKey } from "./ui";
import { baseName, type Urls } from "./urls";

/*
 * The app's frame (take 4, TEMPRA-113; tempra-dev: app/workspace): a top bar across the window,
 * split at the sidebar's edge (the mark, the library switcher and search over the sidebar; the
 * page's tools, the bell and the avatar over the page, and no crumbs), a navigation sidebar, and
 * the page as a flat column. A library's pages, its settings and the account's pages all use
 * it, each with its own sidebar. Under 900px the sidebar is a drawer behind the top bar.
 */

/** Where the open page is in its library: a file, a folder, or one of the library's views. */
export interface Place {
  file: string | null;
  dir: string | null;
  view:
    | "home"
    | "activity"
    | "work"
    | "settings"
    | "transfer"
    | "recovery"
    | "connect"
    | "delete"
    | "members"
    | null;
}

/** Under this width the sidebar is a drawer behind the top bar (the phone layout). */
export const NARROW = "(max-width: 900px)";

/** The library's settings pages: they get the settings sidebar, not the library's. */
export const SETTINGS_VIEWS: ReadonlySet<Place["view"]> = new Set([
  "settings",
  "transfer",
  "recovery",
  "connect",
  "delete",
  "members",
]);

/** What a page in the workspace may ask of the frame. */
interface Frame {
  /** The sidebar is beside the page (not hidden, not a drawer). */
  sidebar: boolean;
  /** The phone layout: a top bar, the sidebar as a drawer. */
  narrow: boolean;
  /** The library's index (`GET …/outline`, as the tree loaded it); null until it arrives. */
  index: OutlineFile[] | null;
  /** The latest of agents' recent changes, and the clock it is read against (changes.ts). */
  latest: AgentChange | undefined;
  now: number;
  /** The top bar's slot a page fills through PageBar: its tools. */
  slots: { tools: HTMLElement | null };
  /** Tells the frame a page has tools of its own (a concept's), which take the phone bar's end. */
  setOwnTools(own: boolean): void;
  /** A page's overlay (a concept's panel over the page) is modal: the top bar and sidebar go inert. */
  setModal(on: boolean): void;
  /** Opens search: a library's quick switcher, or the search of the person's libraries. */
  search(): void;
}

const FrameContext = createContext<Frame>({
  sidebar: true,
  narrow: false,
  index: null,
  latest: undefined,
  now: 0,
  slots: { tools: null },
  setOwnTools: () => {},
  setModal: () => {},
  search: () => {},
});

/** The workspace's frame, for pages that lay themselves out by it. */
export function useFrame(): Frame {
  return useContext(FrameContext);
}

/** Pages' titles by path, from the index the tree loaded (the file name until it arrives). */
export function useTitleOf(): (path: string) => string {
  const { index } = useFrame();
  return useMemo(() => {
    const titles = new Map<string, string>();
    for (const f of index ?? []) if (f.title) titles.set(f.path, f.title);
    return (path: string) => titles.get(path) ?? baseName(path).replace(/\.md$/, "");
  }, [index]);
}

/** Where the page was scrolled on each URL, for back and forward. */
const scrolls = new Map<string, number>();

/** Whether a media query matches, following resizes. */
export function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const update = () => setOn(m.matches);
    m.addEventListener("change", update);
    return () => m.removeEventListener("change", update);
  }, [query]);
  return on;
}

const hiddenKey = (urls: Urls) => `tempra:sidebar:${urls.owner}/${urls.slug}`;

/** Whether the person hid the sidebar in this library (a reading mode, remembered per library). */
function loadHidden(urls: Urls): boolean {
  try {
    return localStorage.getItem(hiddenKey(urls)) === "hidden";
  } catch {
    return false;
  }
}

function saveHidden(urls: Urls, hidden: boolean) {
  try {
    if (hidden) localStorage.setItem(hiddenKey(urls), "hidden");
    else localStorage.removeItem(hiddenKey(urls));
  } catch {
    // Storage off: the sidebar shows again next time.
  }
}

/** What the frame draws around a page: the brand's part of the top bar, the sidebar, the phone's place. */
interface Chrome {
  /** Over the sidebar: the library switcher, or the frame's name (Tempra, Settings). */
  brand: ReactNode;
  /** The sidebar's content (the drawer's on a phone). */
  sidebar: ReactNode;
  /** Opens search (Ctrl or Cmd+K too): the library's quick switcher, or the libraries'. */
  onSearch?: () => void;
  /** The sidebar can be hidden (a library's own pages): its state and the way to change it. */
  hidden?: boolean;
  onHide?: (hidden: boolean) => void;
  /** A quiet word on the top bar when live updates have stopped (a library's feed, F-19). */
  status?: ReactNode;
}

/**
 * The frame itself: the top bar, the sidebar (a drawer on a phone), and the page as the frame's
 * scroller. The page scrolls on its own: a new page starts at the top (or its #fragment), and
 * back or forward returns to where the person was on that page.
 */
function Shell(props: {
  chrome: Chrome;
  me: Me | null;
  frame: Omit<Frame, "sidebar" | "narrow" | "slots" | "setOwnTools" | "setModal" | "search">;
  children: ReactNode;
}) {
  const { chrome } = props;
  const [drawer, setDrawer] = useState(false);
  const narrow = useMedia(NARROW);
  const sidebar = useRef<HTMLElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const [toolsSlot, setToolsSlot] = useState<HTMLElement | null>(null);
  const [ownTools, setOwnTools] = useState(false);

  const main = useRef<HTMLElement>(null);
  const topbar = useRef<HTMLElement>(null);
  // Modality (C-26, P-1; TEMPRA-133): what the open drawer dims (the top bar and the page), and
  // what a page's overlay dims (the top bar and the sidebar), is inert, so Tab and a screen reader
  // stay in the drawer or the overlay. Set on the elements at once, not on the next render, so
  // the focus can go back to a control in the bar as soon as either closes.
  const modal = useRef(false);
  const drawerOpen = useRef(false);
  const applyInert = useCallback(() => {
    if (topbar.current) topbar.current.inert = drawerOpen.current || modal.current;
    if (main.current) main.current.inert = drawerOpen.current;
    if (sidebar.current) sidebar.current.inert = modal.current;
  }, []);
  const setModal = useCallback(
    (on: boolean) => {
      modal.current = on;
      applyInert();
    },
    [applyInert],
  );
  useLayoutEffect(() => {
    drawerOpen.current = drawer;
    applyInert();
  }, [drawer, applyInert]);
  const href = location.pathname + location.search;
  const shownHref = useRef(href);
  useLayoutEffect(() => {
    if (shownHref.current === href) return;
    shownHref.current = href;
    const el = main.current;
    if (!el) return;
    const target = lastNavigation() === "pop" ? (scrolls.get(href) ?? 0) : 0;
    el.scrollTop = target;
    if (target === 0) return;
    // The page's body may still be drawing (the reader mounts after this): keep the position
    // until the page is tall enough to hold it, for up to a second, or until the person scrolls.
    const until = performance.now() + 1000;
    let frame = requestAnimationFrame(function again() {
      if (el.scrollTop !== target) el.scrollTop = target;
      if (el.scrollTop !== target && performance.now() < until) {
        frame = requestAnimationFrame(again);
      }
    });
    const stop = () => cancelAnimationFrame(frame);
    const inputs = ["wheel", "touchstart", "keydown", "pointerdown"] as const;
    for (const i of inputs) el.addEventListener(i, stop, { passive: true });
    return () => {
      stop();
      for (const i of inputs) el.removeEventListener(i, stop);
    };
  }, [href]);

  // The drawer closes when the person moves to another page, and when the screen widens.
  // biome-ignore lint/correctness/useExhaustiveDependencies: closes on every move.
  useEffect(() => setDrawer(false), [href]);
  useEffect(() => {
    if (!narrow) setDrawer(false);
  }, [narrow]);
  // An opened drawer takes the focus, unless something in it already has; a tap anywhere else
  // (the dimmed page beside it) closes it, as a tap outside a menu does. Once it closes, the
  // focus it held goes back to the menu button.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (!drawer) {
      const focused = document.activeElement;
      const lost = !focused || focused === document.body || sidebar.current?.contains(focused);
      if (wasOpen.current && narrow && lost) menuButton.current?.focus();
      wasOpen.current = false;
      return;
    }
    wasOpen.current = true;
    if (!sidebar.current?.contains(document.activeElement)) sidebar.current?.focus();
    const away = (e: PointerEvent) => {
      const t = e.target instanceof Element ? e.target : null;
      if (!sidebar.current?.contains(t) && !t?.closest(".ws-menu, dialog")) setDrawer(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [drawer, narrow]);

  // Keys: Escape closes the drawer (not from inside a dialog or a menu, which handle their own);
  // Ctrl or Cmd+\ hides the sidebar where it can be hidden (a library's own, not a settings
  // page's or the account's, which are their navigation).
  const { hidden, onHide } = chrome;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target instanceof Element ? e.target : null;
      if (e.key === "Escape" && !e.defaultPrevented && drawer && !t?.closest("dialog, .menu")) {
        // Handled: a panel's bottom sheet under the drawer stays open for the next Escape.
        e.preventDefault();
        setDrawer(false);
      } else if ((e.ctrlKey || e.metaKey) && e.key === "\\" && !narrow && onHide) {
        e.preventDefault();
        onHide(!hidden);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawer, narrow, hidden, onHide]);

  const showSidebar = !hidden || narrow;
  const beside = showSidebar && !narrow;
  const frame = useMemo<Frame>(
    () => ({
      ...props.frame,
      sidebar: beside,
      narrow,
      slots: { tools: toolsSlot },
      setOwnTools,
      setModal,
      search: chrome.onSearch ?? (() => {}),
    }),
    [props.frame, beside, narrow, toolsSlot, chrome.onSearch, setModal],
  );
  const classes = [
    "workspace",
    showSidebar ? "" : "sidebar-hidden",
    ownTools ? "has-tools" : "",
    drawer ? "drawer-open" : "",
  ].filter(Boolean);
  return (
    <FrameContext.Provider value={frame}>
      <div className={classes.join(" ")}>
        <header className="ws-topbar" ref={topbar}>
          <div className="topbar-brand">{chrome.brand}</div>
          <div className="topbar-page">
            <button
              ref={menuButton}
              type="button"
              className="icon-button touch ws-menu"
              aria-label="Menu"
              aria-expanded={drawer}
              onClick={() => setDrawer((d) => !d)}
            >
              <Icon name="menu" />
            </button>
            {/* On a phone, Tempra where the desktop has its mark; the page's title names the page
                (TEMPRA-140). */}
            <a className="ws-topbar-place" href="/">
              <span className="wordmark-tile" aria-hidden="true">
                T
              </span>
              Tempra
            </a>
            {!showSidebar && onHide && (
              <button
                type="button"
                className="icon-button show-sidebar"
                aria-label="Show sidebar"
                title="Show sidebar"
                onClick={() => onHide(false)}
              >
                <Icon name="sidebar" />
              </button>
            )}
            {/* No crumbs (TEMPRA-139): the tree, the switcher and the page's title say where. */}
            <div className="topbar-space" />
            <div className="topbar-tools" ref={setToolsSlot} />
            <div className="topbar-end">
              {chrome.status}
              {chrome.onSearch && (
                <button
                  type="button"
                  className="icon-button phone-search"
                  aria-label="Search"
                  title={`Search (${switcherKey()})`}
                  onClick={chrome.onSearch}
                >
                  <Icon name="search" />
                </button>
              )}
              <Bell />
              <AccountMenu me={props.me} />
            </div>
          </div>
        </header>
        {/* The page dimmed behind the open drawer; a tap on it closes the drawer. */}
        {drawer && <div className="ws-scrim" aria-hidden="true" />}
        <section
          ref={sidebar}
          tabIndex={-1}
          className={drawer ? "ws-sidebar open" : "ws-sidebar"}
          aria-label="Navigation"
          hidden={!showSidebar}
        >
          {/* On a phone the drawer's head: the mark and the switcher (or the frame's name), ×. */}
          <div className="drawer-head">
            {chrome.brand}
            <button
              type="button"
              className="icon-button touch drawer-close"
              aria-label="Close menu"
              title="Close"
              onClick={() => setDrawer(false)}
            >
              <Icon name="close" />
            </button>
          </div>
          {chrome.sidebar}
        </section>
        <main
          className="ws-main"
          ref={main}
          onScroll={(e) => scrolls.set(href, e.currentTarget.scrollTop)}
        >
          {props.children}
        </main>
      </div>
    </FrameContext.Provider>
  );
}

const NO_CHANGES = { index: null, latest: undefined, now: 0 };

/** Ctrl or Cmd+K opens search, and again closes it, on every page (TEMPRA-127). */
function useSearchKey(toggle: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        toggle();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [toggle]);
}

/** Over the sidebar: a round search button, the shortcut as its hint. */
function SearchButton({ onSearch }: { onSearch(): void }) {
  return (
    <button
      type="button"
      className="icon-button search-button"
      aria-label="Search"
      title={`Search (${switcherKey()})`}
      onClick={onSearch}
    >
      <Icon name="search" />
    </button>
  );
}

/**
 * A library's frame, keyed by the library so it stays mounted while the person moves within it:
 * the switcher and search over the sidebar, the library's sidebar (or its settings' sidebar on a
 * settings page), the quick switcher, and the feed's refresh of the inbox count.
 */
export function Workspace(props: { urls: Urls; place: Place; me: Me | null; children: ReactNode }) {
  const { urls, place } = props;
  const [hidden, setHidden] = useState(() => loadHidden(urls));
  const [switching, setSwitching] = useState(false);
  const [index, setIndex] = useState<OutlineFile[] | null>(null);
  const [indexSeq, setIndexSeq] = useState<number | null>(null);
  const agents = useAgentChanges(urls, indexSeq);
  const libs = useLibraries();
  const library =
    libs.state === "ready"
      ? libs.data.libraries.find((l) => l.owner === urls.owner && l.slug === urls.slug)
      : undefined;
  const name = libraryLabel(library ?? urls);

  const hide = useCallback(
    (h: boolean) => {
      setHidden(h);
      saveHidden(urls, h);
    },
    [urls],
  );
  // Ctrl or Cmd+K opens the quick switcher, and again closes it (on the settings pages too).
  useSearchKey(useCallback(() => setSwitching((on) => !on), []));
  // A comment, a write or a verification may make, change or close an item of the person's
  // (TEMPRA-116): the inbox's count reloads a moment after one (items are written just after the
  // write commits), once for a burst.
  const inboxTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useFeed(
    urls,
    indexSeq,
    (events) => {
      if (events.length === 0 || inboxTimer.current) return;
      inboxTimer.current = setTimeout(() => {
        inboxTimer.current = null;
        inboxChanged();
      }, 1500);
    },
    () => {},
  );
  const onIndex = useCallback((files: OutlineFile[], seq: number) => {
    setIndex(files);
    setIndexSeq((s) => s ?? seq);
  }, []);
  const onSearch = useCallback(() => setSwitching(true), []);

  const settings = SETTINGS_VIEWS.has(place.view);
  const brand = (
    <>
      <a className="wordmark-tile" href="/" aria-label="Tempra" title="Tempra">
        T
      </a>
      <span className="brand-sep" aria-hidden="true" />
      {settings ? (
        <a className="topbar-name" href={urls.settings()}>
          Library settings
        </a>
      ) : (
        <LibrarySwitcher urls={urls} name={name} />
      )}
      {!settings && <SearchButton onSearch={onSearch} />}
    </>
  );
  const sidebarContent = settings ? (
    <SettingsSidebar urls={urls} name={name} place={place} />
  ) : (
    <LibrarySidebar
      urls={urls}
      name={name}
      place={place}
      changes={agents.changes}
      now={agents.now}
      onSearch={onSearch}
      onIndex={onIndex}
    />
  );
  const chrome: Chrome = {
    brand,
    sidebar: sidebarContent,
    onSearch,
    // Only the library's own sidebar hides; the settings' is how the person moves between tabs.
    hidden: settings ? undefined : hidden,
    onHide: settings ? undefined : hide,
    status: <FeedNotice urls={urls} />,
  };
  const frame = useMemo(
    () => ({ index, latest: agents.latest, now: agents.now }),
    [index, agents.latest, agents.now],
  );
  return (
    <>
      <Shell chrome={chrome} me={props.me} frame={frame}>
        {props.children}
      </Shell>
      <Switcher
        urls={urls}
        name={name}
        index={index ?? []}
        open={switching}
        onClose={() => setSwitching(false)}
      />
    </>
  );
}

/**
 * "Reconnecting…", quietly, while the library's feed is trying to get back (F-19): a page then
 * stops following agents' writes until it does. Nothing while the feed is live.
 */
function FeedNotice({ urls }: { urls: Urls }) {
  const status = useFeedStatus(urls);
  return (
    <span className="feed-status" role="status">
      {status === "reconnecting" ? "Reconnecting…" : ""}
    </span>
  );
}

/** The account's pages: the library list and the Inbox, or the account's settings. */
export type AccountPage =
  | "libraries"
  | "inbox"
  | "welcome"
  | "account"
  | "notifications"
  | "agents"
  | "invitations";

const ACCOUNT_NAMES: Record<AccountPage, string> = {
  libraries: "Libraries",
  inbox: "Inbox",
  welcome: "Welcome",
  account: "Account",
  notifications: "Notifications",
  agents: "Agents",
  invitations: "Invitations",
};

/** The account's pages under its own sidebar; Welcome and Invitations are not settings (S-14). */
const ACCOUNT_OWN: ReadonlySet<AccountPage> = new Set([
  "libraries",
  "inbox",
  "welcome",
  "invitations",
]);

/**
 * The account's frame (take 4, boards 01 to 05): Tempra over the sidebar; the library list, the
 * Inbox (an invitation is answered from it), and first run under the account's sidebar
 * (Libraries, Inbox, the person's libraries), the rest under the settings' (Back to libraries,
 * then each page).
 */
export function AccountFrame(props: { page: AccountPage; me: Me | null; children: ReactNode }) {
  const { page } = props;
  const settings = !ACCOUNT_OWN.has(page);
  const _name = ACCOUNT_NAMES[page];
  // Off a library, search finds a library (TEMPRA-127).
  const [searching, setSearching] = useState(false);
  useSearchKey(useCallback(() => setSearching((on) => !on), []));
  const onSearch = useCallback(() => setSearching(true), []);
  const chrome: Chrome = {
    brand: (
      <>
        <a className="wordmark-tile" href="/" aria-label="Tempra" title="Tempra">
          T
        </a>
        <span className="brand-sep" aria-hidden="true" />
        <a className="topbar-name" href={settings ? "/account" : "/"}>
          {settings ? "Settings" : "Tempra"}
        </a>
        <SearchButton onSearch={onSearch} />
      </>
    ),
    sidebar: settings ? <AccountSettingsSidebar page={page} /> : <AccountSidebar page={page} />,
    onSearch,
  };
  return (
    <>
      <Shell chrome={chrome} me={props.me} frame={NO_CHANGES}>
        {props.children}
      </Shell>
      <LibrarySearch open={searching} onClose={() => setSearching(false)} />
    </>
  );
}

/**
 * A page's part of the top bar: its tools (a concept's Comments, Copy page and ⋯), drawn into
 * the bar's slot from wherever the page is. The bar names no path (TEMPRA-139) and, on a phone,
 * no page: the page's own title does (TEMPRA-140).
 */
export function PageBar(props: {
  actions?: ReactNode;
  /** On a phone the tools take the place of search and the bell (a concept's, board 33). */
  phoneTools?: boolean;
}) {
  const { slots, setOwnTools } = useFrame();
  const tools = props.phoneTools === true && props.actions !== undefined && props.actions !== null;
  useLayoutEffect(() => {
    if (!tools) return;
    setOwnTools(true);
    return () => setOwnTools(false);
  }, [tools, setOwnTools]);
  return <>{props.actions && slots.tools && createPortal(props.actions, slots.tools)}</>;
}

/** A page's column in the frame (everything but a concept, which lays out its own columns). */
export function PageColumn({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return <div className={wide ? "page-column wide" : "page-column"}>{children}</div>;
}
