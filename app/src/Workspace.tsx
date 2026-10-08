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
import { api, useLoad } from "./api";
import { AccountMenu, Icon, Menu } from "./chrome";
import { lastNavigation } from "./router";
import { Switcher } from "./Switcher";
import { type OutlineFile, Tree } from "./Tree";
import { type Me, switcherKey } from "./ui";
import { Urls } from "./urls";

/** Where the open page is in its library: a file, a folder, or one of the library's views. */
export interface Place {
  file: string | null;
  dir: string | null;
  view: "ledger" | "work" | "transfer" | "recovery" | "connect" | "delete" | null;
}

/** The concept page's panels, one open at a time (tempra-dev: app/workspace, The panels). */
export type PanelId = "comments" | "review" | "contents" | "history" | "properties";

const PANELS: readonly PanelId[] = ["comments", "review", "contents", "history", "properties"];

interface Panels {
  /** The open panel, or null. */
  panel: PanelId | null;
  /** Opens a panel; the open one again closes it. */
  toggle(id: PanelId): void;
  open(id: PanelId): void;
  close(): void;
  /** Where the page draws the open panel (the workspace's right column). */
  el: HTMLElement | null;
  /** A page with panels is shown (it registers while mounted). */
  register(): () => void;
}

const PanelContext = createContext<Panels | null>(null);

/** The workspace's panels; null outside a workspace. */
export function usePanels(): Panels | null {
  return useContext(PanelContext);
}

/**
 * The page's panel, drawn in the workspace's right column while a panel is open. A page that has
 * panels renders this whenever it is shown (even while loading, so the column keeps its place).
 */
export function PanelHost({ children }: { children: ReactNode }) {
  const panels = usePanels();
  useEffect(() => panels?.register(), [panels?.register]);
  if (!panels) return <aside>{children}</aside>;
  return panels.el && panels.panel ? createPortal(children, panels.el) : null;
}

const PANEL_KEY = "tempra:panel";
const NARROW = "(max-width: 900px)";
/** Where the panel overlays the sheet instead of taking a column. */
const OVERLAY = "(max-width: 1100px)";

/** Where the main pane was scrolled on each page, for back and forward. */
const scrolls = new Map<string, number>();

/** Whether a media query matches, following resizes. */
function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const update = () => setOn(m.matches);
    m.addEventListener("change", update);
    return () => m.removeEventListener("change", update);
  }, [query]);
  return on;
}

/** The panel last open on this browser; Comments on a first visit, none where it would cover. */
function storedPanel(): PanelId | null {
  try {
    const v = localStorage.getItem(PANEL_KEY);
    if (v === "none") return null;
    if (v && (PANELS as readonly string[]).includes(v)) return v as PanelId;
  } catch {
    // Storage off: the default below.
  }
  return window.matchMedia(OVERLAY).matches ? null : "comments";
}

function storePanel(p: PanelId | null) {
  try {
    localStorage.setItem(PANEL_KEY, p ?? "none");
  } catch {
    // Storage off: the choice lasts for this page load.
  }
}

/**
 * The workspace (tempra-dev: app/workspace): one frame for a library's pages. A header, the
 * sidebar on the ground, the open page as a floating sheet, and the concept's panel beside it. It
 * stays mounted while the person moves between the library's files and views, so the tree keeps
 * its state and scroll; only the sheet and the panel change.
 */
export function Workspace(props: {
  urls: Urls;
  place: Place;
  me: Me | null;
  /** The page draws its own sheet content (a concept: its cluster and column). */
  bare: boolean;
  children: ReactNode;
}) {
  const { urls, place } = props;
  const [panelEl, setPanelEl] = useState<HTMLElement | null>(null);
  const [hosts, setHosts] = useState(0);
  const [panel, setPanel] = useState<PanelId | null>(storedPanel);
  const [drawer, setDrawer] = useState(false);
  const [switching, setSwitching] = useState(false);
  const narrow = useMedia(NARROW);
  const [index, setIndex] = useState<OutlineFile[]>([]);
  const sidebar = useRef<HTMLElement>(null);

  const register = useCallback(() => {
    setHosts((n) => n + 1);
    return () => setHosts((n) => n - 1);
  }, []);
  const choose = useCallback((p: PanelId | null) => {
    setPanel(p);
    storePanel(p);
  }, []);
  const panels = useMemo<Panels>(
    () => ({
      panel,
      toggle: (id) => choose(panel === id ? null : id),
      open: (id) => choose(id),
      close: () => choose(null),
      el: panelEl,
      register,
    }),
    [panel, panelEl, register, choose],
  );

  // The sheet scrolls on its own: a new page starts at the top (or its #fragment), and back or
  // forward returns to where the person was on that page.
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
  useEffect(() => setDrawer(false), [place.file, place.dir, place.view]);
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
      if (!sidebar.current?.contains(t) && !t?.closest(".ws-files")) setDrawer(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [drawer]);

  // Escape closes the drawer, else the panel. Not from inside the body being edited, a dialog
  // (the switcher, the link dialog), or a menu, which handle their own Escape.
  const hasPanel = hosts > 0 && panel !== null;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const t = e.target instanceof Element ? e.target : null;
      if (t?.closest("[contenteditable='true'], dialog, .link-dialog, .menu")) return;
      if (drawer) setDrawer(false);
      else if (hasPanel) choose(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawer, hasPanel, choose]);

  // Ctrl or Cmd+K opens the quick switcher, from anywhere in the workspace except a body being
  // edited, where it makes a link.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const editing = e.target instanceof Element && e.target.closest("[contenteditable='true']");
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k" && !editing) {
        e.preventDefault();
        // The same keys close it again.
        setSwitching((on) => !on);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // A link to a page's comments (#comments, from the ledger or the work queue) opens them.
  // biome-ignore lint/correctness/useExhaustiveDependencies: on each page, once it has panels.
  useEffect(() => {
    if (hosts > 0 && location.hash === "#comments") choose("comments");
  }, [hosts > 0, href]);

  // The sidebar's counts: the head sequence and the open work, refreshed with the tree.
  const stats = useLoad(`stats ${urls.owner}/${urls.slug}`, () =>
    api<{ seq: number; open_work: number }>(urls.api("stats")),
  );
  const reloadStats = stats.reload;
  // The first index arrives with the first stats; later ones follow writes.
  const indexed = useRef(false);
  const onIndex = useCallback(
    (files: OutlineFile[]) => {
      setIndex(files);
      if (indexed.current) reloadStats();
      indexed.current = true;
    },
    [reloadStats],
  );
  const counts = stats.state === "ready" ? stats.data : null;

  const classes = ["workspace", hasPanel ? "has-panel" : ""].filter(Boolean);
  return (
    <div className={classes.join(" ")}>
      <header className="ws-header">
        <button
          type="button"
          className="icon-button ws-files"
          aria-label="Files"
          aria-expanded={drawer}
          onClick={() => setDrawer((d) => !d)}
        >
          <Icon name="files" />
        </button>
        <a className="brand" href="/">
          Tempra
        </a>
        <span className="header-sep" aria-hidden="true">
          /
        </span>
        <LibraryMenu urls={urls} place={place} />
        <span className="spacer" />
        <AccountMenu me={props.me} />
      </header>
      <section
        ref={sidebar}
        tabIndex={-1}
        className={drawer ? "ws-sidebar open" : "ws-sidebar"}
        aria-label="Library"
      >
        <button type="button" className="search-pill" onClick={() => setSwitching(true)}>
          <span>Search {urls.slug}…</span>
          <kbd>{switcherKey()}</kbd>
        </button>
        <div className="ws-scroll">
          <Tree urls={urls} file={place.file} dir={place.dir} onIndex={onIndex} />
          <ul className="ws-views" aria-label="Views">
            <li>
              <a href={urls.ledger()} aria-current={place.view === "ledger" ? "page" : undefined}>
                <span>Ledger</span>
                {counts && <span className="count">seq {counts.seq}</span>}
              </a>
            </li>
            <li>
              <a href={urls.work()} aria-current={place.view === "work" ? "page" : undefined}>
                <span>Work queue</span>
                {counts && counts.open_work > 0 && (
                  <span className="count">{counts.open_work}</span>
                )}
              </a>
            </li>
          </ul>
        </div>
      </section>
      <main
        className="ws-main"
        ref={main}
        onScroll={(e) => scrolls.set(href, e.currentTarget.scrollTop)}
      >
        <PanelContext.Provider value={panels}>
          {props.bare ? props.children : <div className="sheet-page">{props.children}</div>}
        </PanelContext.Provider>
      </main>
      <aside
        ref={setPanelEl}
        className="ws-panel"
        hidden={!hasPanel}
        tabIndex={-1}
        aria-labelledby="panel-title"
      />
      <Switcher urls={urls} index={index} open={switching} onClose={() => setSwitching(false)} />
    </div>
  );
}

/**
 * The library's name as a menu: the account's other libraries, then this library's settings
 * (import and export, recovery, connect, delete).
 */
function LibraryMenu({ urls, place }: { urls: Urls; place: Place }) {
  const libs = useLoad("workspace libraries", () =>
    api<{ libraries: { owner: string; slug: string }[] }>("/api/v1/libraries"),
  );
  const list = libs.state === "ready" ? libs.data.libraries : [];
  const others = list.filter((l) => l.owner !== urls.owner || l.slug !== urls.slug);
  const settings: [string, string, Place["view"]][] = [
    ["Import & export", urls.transfer(), "transfer"],
    ["Recovery", urls.recovery(), "recovery"],
    ["Connect", urls.connect(), "connect"],
    ["Delete", urls.remove(), "delete"],
  ];
  return (
    <Menu
      name={`Library ${urls.slug}`}
      label={
        <>
          {urls.slug}
          <span className="caret">
            <Icon name="down" size={12} />
          </span>
        </>
      }
    >
      {others.length > 0 && (
        <>
          <div className="menu-note">Switch library</div>
          {others.map((l) => (
            <a key={`${l.owner}/${l.slug}`} href={new Urls(l.owner, l.slug).tree("")}>
              {l.slug}
            </a>
          ))}
          <hr />
        </>
      )}
      <div className="menu-note">Library settings</div>
      {settings.map(([name, href, key]) => (
        <a key={name} href={href} aria-current={place.view === key ? "page" : undefined}>
          {name}
        </a>
      ))}
    </Menu>
  );
}
