import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useAgentChanges } from "./changes";
import { Icon } from "./chrome";
import { inboxChanged } from "./inbox";
import { useFeed } from "./live";
import { lastNavigation } from "./router";
import { Sidebar, TopBar } from "./Sidebar";
import { Switcher } from "./Switcher";
import type { OutlineFile } from "./Tree";
import type { Me } from "./ui";
import type { Urls } from "./urls";

/** Where the open page is in its library: a file, a folder, or one of the library's views. */
export interface Place {
  file: string | null;
  dir: string | null;
  view:
    | "home"
    | "needs"
    | "activity"
    | "ledger"
    | "work"
    | "transfer"
    | "recovery"
    | "connect"
    | "delete"
    | "members"
    | null;
}

/** Under this width the sidebar is a drawer behind the top bar (the phone layout). */
export const NARROW = "(max-width: 900px)";

/** What a page in the workspace may ask of the frame. */
interface Frame {
  /** The sidebar is beside the sheet (not hidden, not a drawer). */
  sidebar: boolean;
  /** The phone layout: a top bar, the sidebar as a drawer. */
  narrow: boolean;
}

const FrameContext = createContext<Frame>({ sidebar: true, narrow: false });

/** The workspace's frame, for pages that lay themselves out by it. */
export function useFrame(): Frame {
  return useContext(FrameContext);
}

/** Where the sheet was scrolled on each page, for back and forward. */
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
    // Storage off: the choice lasts for this page load.
  }
}

/**
 * The workspace (take 3, tempra-dev: app/workspace): one frame for a library's pages. No header:
 * the ground holds the sidebar and the open page as a full-height sheet. The sidebar can be
 * hidden; on a phone it is a drawer behind a top bar. The frame stays mounted while the person
 * moves between the library's files and views, so the tree keeps its state and scroll; only the
 * sheet changes.
 */
export function Workspace(props: { urls: Urls; place: Place; me: Me | null; children: ReactNode }) {
  const { urls, place } = props;
  const [drawer, setDrawer] = useState(false);
  const [hidden, setHidden] = useState(() => loadHidden(urls));
  const [switching, setSwitching] = useState(false);
  const narrow = useMedia(NARROW);
  const [index, setIndex] = useState<OutlineFile[]>([]);
  const [indexSeq, setIndexSeq] = useState<number | null>(null);
  const sidebar = useRef<HTMLElement>(null);
  const agents = useAgentChanges(urls, indexSeq);

  const hide = useCallback(
    (h: boolean) => {
      setHidden(h);
      saveHidden(urls, h);
    },
    [urls],
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
      if (!sidebar.current?.contains(t) && !t?.closest(".ws-menu")) setDrawer(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [drawer]);

  // Keys: Escape closes the drawer (not from inside a dialog or a menu, which handle their own);
  // Ctrl or Cmd+K opens the quick switcher, and again closes it; Ctrl or Cmd+\ hides the sidebar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target instanceof Element ? e.target : null;
      if (e.key === "Escape" && !e.defaultPrevented && drawer && !t?.closest("dialog, .menu")) {
        setDrawer(false);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSwitching((on) => !on);
      } else if ((e.ctrlKey || e.metaKey) && e.key === "\\" && !narrow) {
        e.preventDefault();
        hide(!hidden);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawer, narrow, hidden, hide]);

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

  const showSidebar = !hidden || narrow;
  const classes = ["workspace", showSidebar ? "" : "sidebar-hidden"].filter(Boolean);
  return (
    <FrameContext.Provider value={{ sidebar: showSidebar && !narrow, narrow }}>
      <div className={classes.join(" ")}>
        <TopBar
          urls={urls}
          me={props.me}
          drawer={drawer}
          onDrawer={() => setDrawer((d) => !d)}
          onSearch={() => setSwitching(true)}
        />
        <section
          ref={sidebar}
          tabIndex={-1}
          className={drawer ? "ws-sidebar open" : "ws-sidebar"}
          aria-label="Library"
          hidden={!showSidebar}
        >
          <Sidebar
            urls={urls}
            place={place}
            me={props.me}
            changes={agents.changes}
            latest={agents.latest}
            now={agents.now}
            onSearch={() => setSwitching(true)}
            onHide={() => (narrow ? setDrawer(false) : hide(true))}
            onIndex={onIndex}
          />
        </section>
        <div className="ws-sheet">
          {!showSidebar && (
            <button
              type="button"
              className="icon-button sheet-toggle"
              aria-label="Show sidebar"
              title="Show sidebar"
              onClick={() => hide(false)}
            >
              <Icon name="sidebar" />
            </button>
          )}
          <main
            className="ws-main"
            ref={main}
            onScroll={(e) => scrolls.set(href, e.currentTarget.scrollTop)}
          >
            {props.children}
          </main>
        </div>
        <Switcher urls={urls} index={index} open={switching} onClose={() => setSwitching(false)} />
      </div>
    </FrameContext.Provider>
  );
}

/**
 * The bar at the top of the sheet, kept in view while the page scrolls: where the page is (the
 * crumbs, or on a phone a way back) on the left, the page's few controls on the right.
 */
export function SheetBar(props: {
  children?: ReactNode;
  /** On a phone, in place of the crumbs: back to the folder or page above. */
  back?: { href: string; label: string };
  actions?: ReactNode;
}) {
  return (
    <div className="sheet-bar">
      <div className="sheet-bar-start">
        {props.back && (
          <a
            className="icon-button touch sheet-back"
            href={props.back.href}
            aria-label={`Back to ${props.back.label}`}
            title={`Back to ${props.back.label}`}
          >
            <Icon name="back" />
          </a>
        )}
        {props.children}
      </div>
      {props.actions && <div className="sheet-bar-end">{props.actions}</div>}
    </div>
  );
}

/** A page's column in the sheet (everything but a concept, which lays out its own margins). */
export function SheetPage({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return <div className={wide ? "sheet-page wide" : "sheet-page"}>{children}</div>;
}
