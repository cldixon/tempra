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
import { useFeed } from "./live";
import { useLibraries } from "./role";
import { lastNavigation } from "./router";
import {
  AccountSettingsSidebar,
  AccountSidebar,
  LibrarySidebar,
  LibrarySwitcher,
  LibraryTile,
  SettingsSidebar,
} from "./Sidebar";
import { Switcher } from "./Switcher";
import type { OutlineFile } from "./Tree";
import type { Me } from "./ui";
import { dirOf, folderName, type Urls } from "./urls";

/*
 * The app's frame (take 4, TEMPRA-113; tempra-dev: app/workspace): a top bar across the window,
 * split at the sidebar's edge (the mark, the library switcher and search over the sidebar; the
 * crumbs, the page's tools, the bell and the avatar over the page), a navigation sidebar, and
 * the page as a flat column. A library's pages, its settings and the account's pages all use
 * it, each with its own sidebar. Under 900px the sidebar is a drawer behind the top bar.
 */

/** Where the open page is in its library: a file, a folder, or one of the library's views. */
export interface Place {
  file: string | null;
  dir: string | null;
  view:
    | "home"
    | "needs"
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

/** The names of the library's views and settings pages, as the crumbs and the phone show them. */
const VIEW_NAMES: Record<NonNullable<Place["view"]>, string> = {
  home: "Home",
  needs: "Needs you",
  activity: "Activity",
  work: "Work queue",
  settings: "General",
  transfer: "Import & export",
  recovery: "Recovery",
  connect: "Connect",
  delete: "Delete library",
  members: "Members",
};

/** The library's settings pages: they get the settings sidebar, not the library's. */
export const SETTINGS_VIEWS: ReadonlySet<Place["view"]> = new Set([
  "settings",
  "transfer",
  "recovery",
  "connect",
  "delete",
  "members",
]);

/**
 * Where a page is, in a few words (the phone's top bar, under the library's name): the view, a
 * folder by its readable name, or a concept's folder. Null for a file at the library's root.
 */
export function placeName(place: Place): string | null {
  if (place.view) return VIEW_NAMES[place.view];
  if (place.dir) return folderName(place.dir);
  if (place.file) {
    const dir = dirOf(place.file);
    return dir ? folderName(dir) : null;
  }
  return null;
}

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
  /** The top bar's slots a page fills through PageBar: its crumbs and its tools. */
  slots: { crumbs: HTMLElement | null; tools: HTMLElement | null };
  /** Tells the frame a page has crumbs of its own, so the default ones step aside. */
  setOwnCrumbs(own: boolean): void;
}

const FrameContext = createContext<Frame>({
  sidebar: true,
  narrow: false,
  index: null,
  latest: undefined,
  now: 0,
  slots: { crumbs: null, tools: null },
  setOwnCrumbs: () => {},
});

/** The workspace's frame, for pages that lay themselves out by it. */
export function useFrame(): Frame {
  return useContext(FrameContext);
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
  /** The default crumbs, when the page sets none of its own. */
  crumbs: ReactNode;
  /** The phone's top bar: where the person is. */
  place: ReactNode;
  /** Opens the quick switcher (a library frame). */
  onSearch?: () => void;
  /** The sidebar can be hidden (a library frame): its state and the way to change it. */
  hidden?: boolean;
  onHide?: (hidden: boolean) => void;
}

/**
 * The frame itself: the top bar, the sidebar (a drawer on a phone), and the page as the frame's
 * scroller. The page scrolls on its own: a new page starts at the top (or its #fragment), and
 * back or forward returns to where the person was on that page.
 */
function Shell(props: {
  chrome: Chrome;
  me: Me | null;
  frame: Omit<Frame, "sidebar" | "narrow" | "slots" | "setOwnCrumbs">;
  children: ReactNode;
}) {
  const { chrome } = props;
  const [drawer, setDrawer] = useState(false);
  const narrow = useMedia(NARROW);
  const sidebar = useRef<HTMLElement>(null);
  const [crumbsSlot, setCrumbsSlot] = useState<HTMLElement | null>(null);
  const [toolsSlot, setToolsSlot] = useState<HTMLElement | null>(null);
  const [ownCrumbs, setOwnCrumbs] = useState(false);

  const main = useRef<HTMLElement>(null);
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
  // closes it, as a tap outside a menu does.
  useEffect(() => {
    if (!drawer) return;
    if (!sidebar.current?.contains(document.activeElement)) sidebar.current?.focus();
    const away = (e: PointerEvent) => {
      const t = e.target instanceof Element ? e.target : null;
      if (!sidebar.current?.contains(t) && !t?.closest(".ws-menu")) setDrawer(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [drawer]);

  // Keys: Escape closes the drawer (not from inside a dialog or a menu, which handle their own);
  // Ctrl or Cmd+\ hides the sidebar where it can be hidden.
  const { hidden, onHide } = chrome;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target instanceof Element ? e.target : null;
      if (e.key === "Escape" && !e.defaultPrevented && drawer && !t?.closest("dialog, .menu")) {
        // Handled: a comment sheet under the drawer stays open for the next Escape.
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
      slots: { crumbs: crumbsSlot, tools: toolsSlot },
      setOwnCrumbs,
    }),
    [props.frame, beside, narrow, crumbsSlot, toolsSlot],
  );
  const classes = ["workspace", showSidebar ? "" : "sidebar-hidden"].filter(Boolean);
  return (
    <FrameContext.Provider value={frame}>
      <div className={classes.join(" ")}>
        <header className="ws-topbar">
          <div className="topbar-brand">{chrome.brand}</div>
          <div className="topbar-page">
            <button
              type="button"
              className="icon-button touch ws-menu"
              aria-label="Menu"
              aria-expanded={drawer}
              onClick={() => setDrawer((d) => !d)}
            >
              <Icon name="menu" />
            </button>
            {chrome.place}
            {!showSidebar && onHide && (
              <button
                type="button"
                className="icon-button sheet-toggle"
                aria-label="Show sidebar"
                title="Show sidebar"
                onClick={() => onHide(false)}
              >
                <Icon name="sidebar" />
              </button>
            )}
            <div className="topbar-crumbs" ref={setCrumbsSlot}>
              {!ownCrumbs && chrome.crumbs}
            </div>
            <div className="topbar-tools" ref={setToolsSlot} />
            <div className="topbar-end">
              <Bell />
              <AccountMenu me={props.me} />
            </div>
          </div>
        </header>
        <section
          ref={sidebar}
          tabIndex={-1}
          className={drawer ? "ws-sidebar open" : "ws-sidebar"}
          aria-label="Navigation"
          hidden={!showSidebar}
        >
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
  const name = library?.title || urls.slug;

  const hide = useCallback(
    (h: boolean) => {
      setHidden(h);
      saveHidden(urls, h);
    },
    [urls],
  );
  // Ctrl or Cmd+K opens the quick switcher, and again closes it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSwitching((on) => !on);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  // A comment may be for the person: the inbox's count reloads a moment after one (the item is
  // written just after the comment commits).
  useFeed(
    urls,
    indexSeq,
    (events) => {
      if (events.some((e) => e.op === "comment")) setTimeout(inboxChanged, 1500);
    },
    () => {},
  );
  const onIndex = useCallback((files: OutlineFile[], seq: number) => {
    setIndex(files);
    setIndexSeq((s) => s ?? seq);
  }, []);
  const onSearch = useCallback(() => setSwitching(true), []);

  const settings = SETTINGS_VIEWS.has(place.view);
  const here = placeName(place);
  const brand = (
    <>
      <a className="wordmark-tile" href="/" aria-label="Tempra" title="Tempra">
        T
      </a>
      <span className="brand-sep" aria-hidden="true" />
      {settings ? (
        <span className="topbar-name">Library settings</span>
      ) : (
        <LibrarySwitcher urls={urls} name={name} />
      )}
      {!settings && (
        <button
          type="button"
          className="icon-button search-button"
          aria-label="Search"
          title="Search"
          onClick={onSearch}
        >
          <Icon name="search" />
        </button>
      )}
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
  const crumbs = settings ? (
    <nav className="crumbs" aria-label="Path">
      <a href={urls.tree("")}>{name}</a>
      <span aria-hidden="true">/</span>
      <a href={urls.settings()}>Settings</a>
      <span aria-hidden="true">/</span>
      <span className="here" aria-current="page">
        {here}
      </span>
    </nav>
  ) : (
    <nav className="crumbs" aria-label="Path">
      <span className="here" aria-current="page">
        {place.view === "home" || here === null ? name : here}
      </span>
    </nav>
  );
  const chrome: Chrome = {
    brand,
    sidebar: sidebarContent,
    crumbs,
    place: (
      <a className="ws-topbar-place" href={urls.tree("")}>
        <LibraryTile name={name} />
        <span className="lib-names">
          <span className="lib-name">{name}</span>
          {here && <span className="ws-topbar-here">{here}</span>}
        </span>
      </a>
    ),
    onSearch,
    hidden,
    onHide: hide,
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
        index={index ?? []}
        open={switching}
        onClose={() => setSwitching(false)}
      />
    </>
  );
}

/** The account's pages: the library list and the Inbox, or the account's settings. */
export type AccountPage =
  | "libraries"
  | "inbox"
  | "welcome"
  | "account"
  | "notifications"
  | "connect"
  | "tokens"
  | "apps"
  | "invitations";

const ACCOUNT_NAMES: Record<AccountPage, string> = {
  libraries: "Libraries",
  inbox: "Inbox",
  welcome: "Welcome",
  account: "Account",
  notifications: "Notifications",
  connect: "Connect an agent",
  tokens: "Tokens",
  apps: "Connected apps",
  invitations: "Invitations",
};

/**
 * The account's frame (take 4, boards 01 to 05): Tempra over the sidebar; the library list and
 * the Inbox under the account's sidebar (Libraries, Inbox, the person's libraries), the rest
 * under the settings' (Back to libraries, then each page).
 */
export function AccountFrame(props: { page: AccountPage; me: Me | null; children: ReactNode }) {
  const { page } = props;
  const settings = page !== "libraries" && page !== "inbox";
  const name = ACCOUNT_NAMES[page];
  const chrome: Chrome = {
    brand: (
      <>
        <a className="wordmark-tile" href="/" aria-label="Tempra" title="Tempra">
          T
        </a>
        <span className="brand-sep" aria-hidden="true" />
        <a className="topbar-name" href="/">
          {settings ? "Settings" : "Tempra"}
        </a>
      </>
    ),
    sidebar: settings ? <AccountSettingsSidebar page={page} /> : <AccountSidebar page={page} />,
    crumbs: (
      <nav className="crumbs" aria-label="Path">
        {settings && (
          <>
            <a href="/account">Settings</a>
            <span aria-hidden="true">/</span>
          </>
        )}
        <span className="here" aria-current="page">
          {name}
        </span>
      </nav>
    ),
    place: (
      <a className="ws-topbar-place" href="/">
        <span className="wordmark-tile" aria-hidden="true">
          T
        </span>
        <span className="lib-names">
          <span className="lib-name">Tempra</span>
          <span className="ws-topbar-here">{name}</span>
        </span>
      </a>
    ),
  };
  return (
    <Shell chrome={chrome} me={props.me} frame={NO_CHANGES}>
      {props.children}
    </Shell>
  );
}

/**
 * A page's part of the top bar: its crumbs (in place of the frame's default) and its tools (a
 * concept's Comments and ⋯), drawn into the bar's slots from wherever the page is. On a phone
 * `back` is kept for the page's own use; the top bar names the place itself.
 */
export function PageBar(props: {
  children?: ReactNode;
  back?: { href: string; label: string };
  actions?: ReactNode;
}) {
  const { slots, setOwnCrumbs } = useFrame();
  const own = props.children !== undefined && props.children !== null;
  useLayoutEffect(() => {
    if (!own) return;
    setOwnCrumbs(true);
    return () => setOwnCrumbs(false);
  }, [own, setOwnCrumbs]);
  return (
    <>
      {own && slots.crumbs && createPortal(props.children, slots.crumbs)}
      {props.actions && slots.tools && createPortal(props.actions, slots.tools)}
    </>
  );
}

/** A page's column in the frame (everything but a concept, which lays out its own columns). */
export function SheetPage({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return <div className={wide ? "sheet-page wide" : "sheet-page"}>{children}</div>;
}
