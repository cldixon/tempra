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
import { lastNavigation, navigate } from "./router";
import { Switcher } from "./Switcher";
import { type OutlineFile, Tree } from "./Tree";
import type { Me } from "./ui";
import { Urls } from "./urls";

/** Where the open page is in its library: a file, a folder, or one of the library's views. */
export interface Place {
  file: string | null;
  dir: string | null;
  view: "ledger" | "work" | "transfer" | "recovery" | "connect" | "delete" | null;
}

const ContextSlot = createContext<{ el: HTMLElement | null; register(): () => void } | null>(null);

/**
 * The open page's context (trust, sources, links, history, work; later comments), drawn in the
 * workspace's right panel. Outside a workspace it renders in place.
 */
export function ContextPanel({ children }: { children: ReactNode }) {
  const slot = useContext(ContextSlot);
  useEffect(() => slot?.register(), [slot]);
  if (!slot) return <aside>{children}</aside>;
  return slot.el ? createPortal(children, slot.el) : null;
}

const CONTEXT_KEY = "tempra:context";
const NARROW = "(max-width: 60rem)";

/** Where the main pane was scrolled on each page, for back and forward. */
const scrolls = new Map<string, number>();
/** Whether the screen is narrow enough for drawers, following resizes. */
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW).matches);
  useEffect(() => {
    const m = window.matchMedia(NARROW);
    const update = () => setNarrow(m.matches);
    m.addEventListener("change", update);
    return () => m.removeEventListener("change", update);
  }, []);
  return narrow;
}

function storedHidden(): boolean {
  try {
    return localStorage.getItem(CONTEXT_KEY) === "hidden";
  } catch {
    return false;
  }
}

/**
 * The workspace (tempra-dev: app/workspace): one frame for a library's pages. It stays mounted
 * while the person moves between the library's files and views, so the tree keeps its state and
 * scroll; only the main pane and the context panel change.
 */
export function Workspace(props: { urls: Urls; place: Place; me: Me | null; children: ReactNode }) {
  const { urls, place } = props;
  const [contextEl, setContextEl] = useState<HTMLElement | null>(null);
  const [panels, setPanels] = useState(0);
  const [hidden, setHidden] = useState(storedHidden);
  const [drawer, setDrawer] = useState<"files" | "context" | null>(null);
  const [switching, setSwitching] = useState(false);
  const narrow = useNarrow();
  const [index, setIndex] = useState<OutlineFile[]>([]);
  const sidebar = useRef<HTMLDivElement>(null);

  const register = useCallback(() => {
    setPanels((n) => n + 1);
    return () => setPanels((n) => n - 1);
  }, []);
  const slot = useMemo(() => ({ el: contextEl, register }), [contextEl, register]);

  // The main pane scrolls on its own: a new page starts at the top (or its #fragment), and back
  // or forward returns to where the person was on that page.
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

  // A drawer closes when the person moves to another page.
  // biome-ignore lint/correctness/useExhaustiveDependencies: closes on every move.
  useEffect(() => setDrawer(null), [place.file, place.dir, place.view]);

  // Drawers are for narrow screens: widening closes them. Escape closes one, and an open one
  // takes the focus (the context drawer through its own element below).
  useEffect(() => {
    if (!narrow) setDrawer(null);
  }, [narrow]);
  useEffect(() => {
    if (!drawer) return;
    (drawer === "files" ? sidebar.current : contextEl)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawer(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawer, contextEl]);

  // Ctrl or Cmd+K opens the quick switcher, from anywhere in the workspace.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSwitching(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const toggleContext = () => {
    if (narrow) {
      setDrawer((d) => (d === "context" ? null : "context"));
      return;
    }
    setHidden((h) => {
      try {
        localStorage.setItem(CONTEXT_KEY, h ? "shown" : "hidden");
      } catch {
        // Storage off: the choice lasts for this page load.
      }
      return !h;
    });
  };

  const hasContext = panels > 0;
  const classes = ["workspace", !hasContext || hidden ? "no-context" : ""].filter(Boolean);
  const views: [string, string, Place["view"]][] = [
    ["Ledger", urls.ledger(), "ledger"],
    ["Work queue", urls.work(), "work"],
    ["Import & export", urls.transfer(), "transfer"],
    ["Recovery", urls.recovery(), "recovery"],
    ["Connect", urls.connect(), "connect"],
    ["Delete", urls.remove(), "delete"],
  ];

  return (
    <div className={classes.join(" ")}>
      <header className="ws-header">
        <button
          type="button"
          className="ws-toggle"
          aria-expanded={drawer === "files"}
          onClick={() => setDrawer((d) => (d === "files" ? null : "files"))}
        >
          Files
        </button>
        <a href="/">Libraries</a>
        <LibrarySwitch urls={urls} />
        <button type="button" onClick={() => setSwitching(true)}>
          Open… <kbd>Ctrl K</kbd>
        </button>
        <span className="ws-spacer" />
        {hasContext && (
          <button
            type="button"
            aria-pressed={narrow ? drawer === "context" : !hidden}
            onClick={toggleContext}
          >
            Context
          </button>
        )}
        <a href="/connect">Connect</a>
        <a href="/tokens">Tokens</a>
        <a href="/apps">Connected apps</a>
        {props.me && <a href="/account">{props.me.email}</a>}
      </header>
      <div
        ref={sidebar}
        tabIndex={-1}
        className={drawer === "files" ? "ws-sidebar open" : "ws-sidebar"}
      >
        <Tree urls={urls} file={place.file} dir={place.dir} onIndex={setIndex} />
        <ul className="ws-views" aria-label="Library">
          {views.map(([name, href, key]) => (
            <li key={name}>
              <a href={href} aria-current={place.view === key ? "page" : undefined}>
                {name}
              </a>
            </li>
          ))}
        </ul>
      </div>
      <main
        className="ws-main"
        ref={main}
        onScroll={(e) => scrolls.set(href, e.currentTarget.scrollTop)}
        // A tap on the page closes an open drawer, as a tap outside a menu does.
        onPointerDown={() => drawer && setDrawer(null)}
      >
        <ContextSlot.Provider value={slot}>{props.children}</ContextSlot.Provider>
      </main>
      <aside
        ref={setContextEl}
        className={drawer === "context" ? "ws-context open" : "ws-context"}
        hidden={!hasContext || (narrow ? false : hidden)}
        tabIndex={-1}
        aria-label="Context"
      />
      <Switcher urls={urls} index={index} open={switching} onClose={() => setSwitching(false)} />
    </div>
  );
}

/** The library's name, and a switch to the account's other libraries. */
function LibrarySwitch({ urls }: { urls: Urls }) {
  const libs = useLoad("workspace libraries", () =>
    api<{ libraries: { owner: string; slug: string }[] }>("/api/v1/libraries"),
  );
  const list = libs.state === "ready" ? libs.data.libraries : [];
  if (list.length < 2) return <strong>{urls.slug}</strong>;
  return (
    <select
      aria-label="Library"
      value={`${urls.owner}/${urls.slug}`}
      onChange={(e) => {
        const [owner = "", slug = ""] = e.target.value.split("/");
        navigate(new Urls(owner, slug).tree(""));
      }}
    >
      {list.map((l) => (
        <option key={`${l.owner}/${l.slug}`} value={`${l.owner}/${l.slug}`}>
          {l.slug}
        </option>
      ))}
    </select>
  );
}
