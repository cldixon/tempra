import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAgentNames } from "./agents";
import { api } from "./api";
import { type AgentChange, isLive } from "./changes";
import { Icon } from "./chrome";
import { useFeed, useLastSeen } from "./live";
import { prefetchFile } from "./prefetch";
import { baseName, dirOf, folderName, type Urls } from "./urls";

/** One file of `GET …/outline`: the library's index, without bodies. */
export type OutlineFile = Entry;

interface Entry {
  path: string;
  kind: "dir" | "concept" | "attachment";
  title?: string | null;
  seq?: number | null;
  /** Open comment threads on it. */
  comments?: number;
  /** Past its stale_after, or within 14 days of it (the staleness process's flags). */
  stale?: "stale" | "stale_soon";
}

/** The least time between two refreshes of the index while writes keep coming. */
const REFRESH_MS = 3000;

/** How long a pointer rests on a file before its page is loaded ahead. */
const HOVER_MS = 120;

const ancestors = (path: string) => {
  const out: string[] = [];
  for (let d = dirOf(path); d !== ""; d = dirOf(d)) out.unshift(d);
  return out;
};

const expandedKey = (urls: Urls) => `tempra:tree:${urls.owner}/${urls.slug}`;

function loadExpanded(urls: Urls): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(expandedKey(urls)) ?? "[]") as unknown;
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function saveExpanded(urls: Urls, dirs: Set<string>) {
  try {
    localStorage.setItem(expandedKey(urls), JSON.stringify([...dirs]));
  } catch {
    // Storage off: folders open again collapsed next time.
  }
}

/** The concepts under each folder, at any depth. */
function countConcepts(files: Entry[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const f of files) {
    if (f.kind !== "concept") continue;
    for (const d of ancestors(f.path)) counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  return counts;
}

/** A file as the tree names it: a concept by its title, anything else by its file name. */
export function fileLabel(e: OutlineFile): string {
  return e.kind === "concept" && e.title ? e.title : baseName(e.path);
}

/** Where a row sorts within its folder: folders, then pages, then files (TEMPRA-123). */
const RANK: Record<Entry["kind"], number> = { dir: 0, concept: 1, attachment: 2 };

/** A row as the tree names it, for sorting by what the person sees. */
const shown = (e: Entry) => (e.kind === "dir" ? folderName(e.path) : fileLabel(e));

/**
 * Every folder's children from the flat list of files: folders first, then pages, then files,
 * each by the name the tree shows.
 */
function buildDirs(files: Entry[]): Record<string, Entry[]> {
  const dirs = new Map<string, Map<string, Entry>>([["", new Map()]]);
  const at = (d: string) => {
    let m = dirs.get(d);
    if (!m) {
      m = new Map();
      dirs.set(d, m);
    }
    return m;
  };
  for (const f of files) {
    at(dirOf(f.path)).set(f.path, f);
    for (const d of ancestors(f.path)) at(dirOf(d)).set(d, { path: d, kind: "dir" });
  }
  const out: Record<string, Entry[]> = {};
  for (const [d, m] of dirs) {
    out[d] = [...m.values()].sort(
      (a, b) =>
        RANK[a.kind] - RANK[b.kind] ||
        shown(a).localeCompare(shown(b), undefined, { numeric: true, sensitivity: "base" }) ||
        a.path.localeCompare(b.path),
    );
  }
  return out;
}

/** Every file under each folder, at any depth: what a closed folder rolls up. */
function insideDirs(files: Entry[]): Map<string, Entry[]> {
  const inside = new Map<string, Entry[]>();
  for (const f of files) {
    for (const d of ancestors(f.path)) {
      const list = inside.get(d);
      if (list) list.push(f);
      else inside.set(d, [f]);
    }
  }
  return inside;
}

/**
 * The library's top level, as the tree lists it (folders, then pages, then files), each
 * folder with its count of concepts at any depth: the home's way into the files (TEMPRA-107).
 */
export function topLevel(files: OutlineFile[]): { entry: OutlineFile; count: number }[] {
  const counts = countConcepts(files);
  return (buildDirs(files)[""] ?? []).map((entry) => ({
    entry,
    count: counts.get(entry.path) ?? 0,
  }));
}

/**
 * The library's file tree (tempra-dev: app/workspace). The whole index (paths, titles,
 * sequences; no bodies) arrives in one small request when the workspace opens, so opening a
 * folder never waits. A folder (named for people, with its count of concepts): its name opens its
 * folder view and expands it, its chevron only expands and collapses (TEMPRA-123). Open folders
 * are remembered on this browser, the open file is revealed and marked, and the change feed
 * refreshes the index once per burst of writes. The change dot marks a file: pulsing while an
 * agent writes it now, solid when it changed since the person last looked; a closed folder rolls
 * up the marks of what is inside it.
 */
export function Tree(props: {
  urls: Urls;
  file: string | null;
  dir: string | null;
  /** Agents' recent changes by path, and the clock they are read against (changes.ts). */
  changes: Map<string, AgentChange>;
  now: number;
  /** The index and its sequence, for the quick switcher and the feed's start. */
  onIndex?(files: OutlineFile[], seq: number): void;
}) {
  const { urls, changes, now } = props;
  const [files, setFiles] = useState<Entry[] | null>(null);
  const [expanded, setExpanded] = useState(() => loadExpanded(urls));
  const [seq, setSeq] = useState<number | null>(null);
  // Agents named for their person (TEMPRA-77): "Claude for @ann changed this just now".
  const actorName = useAgentNames(
    urls,
    [...changes.values()].map((a) => a.by?.agent),
  );
  const seen = useLastSeen(urls);
  const dirs = useMemo(() => (files ? buildDirs(files) : null), [files]);
  const counts = useMemo(() => (files ? countConcepts(files) : new Map<string, number>()), [files]);
  const inside = useMemo(() => (files ? insideDirs(files) : new Map<string, Entry[]>()), [files]);

  // Only the latest request's answer is kept (two loads may cross).
  const asked = useRef(0);
  const loadedAt = useRef(0);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    const mine = ++asked.current;
    loadedAt.current = Date.now();
    try {
      const r = await api<{ seq: number; files: Entry[] }>(urls.api("outline"));
      if (mine !== asked.current) return;
      setFiles(r.files);
      setFailed(false);
      // The feed is synced once, from the first index; it stays live after that.
      setSeq((s) => s ?? r.seq);
    } catch {
      if (mine === asked.current) setFailed(true);
    }
  }, [urls]);
  useEffect(() => {
    void load();
  }, [load]);
  const onIndex = props.onIndex;
  useEffect(() => {
    if (files && seq !== null) onIndex?.(files, seq);
  }, [files, seq, onIndex]);

  // The open file's folders are revealed when it opens (and may be collapsed after).
  const current = props.file ?? props.dir;
  useEffect(() => {
    if (current === null) return;
    const up = props.file !== null ? ancestors(props.file) : [...ancestors(current), current];
    const want = up.filter((d) => d !== "");
    setExpanded((e) => {
      if (want.every((d) => e.has(d))) return e;
      const next = new Set([...e, ...want]);
      saveExpanded(urls, next);
      return next;
    });
  }, [current, props.file, urls]);

  // Live: the index is refreshed shortly after a write, and at most every few seconds while
  // agents keep writing (each refresh reads the whole index).
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  useFeed(
    urls,
    seq,
    () => {
      if (timer.current === undefined) {
        const wait = Math.max(300, loadedAt.current + REFRESH_MS - Date.now());
        timer.current = setTimeout(() => {
          timer.current = undefined;
          void load();
        }, wait);
      }
    },
    () => {
      // The ledger went back (a restore): start again from the new index.
      setSeq(null);
      void load();
    },
  );
  const expand = (dir: string) =>
    setExpanded((e) => {
      if (e.has(dir)) return e;
      const next = new Set(e).add(dir);
      saveExpanded(urls, next);
      return next;
    });
  const toggle = (dir: string) =>
    setExpanded((e) => {
      const next = new Set(e);
      if (next.has(dir)) next.delete(dir);
      else next.add(dir);
      saveExpanded(urls, next);
      return next;
    });

  // The open file's row is scrolled into view once, when it opens (not after every refresh,
  // which would pull the person back while agents write).
  const currentRow = useRef<HTMLElement | null>(null);
  const setCurrentRow = (el: HTMLElement | null) => {
    currentRow.current = el;
  };
  const scrolledTo = useRef<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the row may first appear when the index arrives.
  useEffect(() => {
    if (scrolledTo.current === current || !currentRow.current) return;
    scrolledTo.current = current;
    currentRow.current.scrollIntoView({ block: "nearest" });
  }, [current, dirs]);

  // A file's page is loaded ahead when the pointer rests on it, or the keyboard reaches it; not
  // the file already open (a click rests the pointer on the row it opened, whose page has just
  // loaded it).
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(hoverTimer.current), []);
  const openFile = useRef(props.file);
  openFile.current = props.file;
  const ahead = (path: string) => ({
    onMouseEnter: () => {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = setTimeout(() => {
        if (path !== openFile.current) prefetchFile(urls, path);
      }, HOVER_MS);
    },
    onMouseLeave: () => clearTimeout(hoverTimer.current),
    onFocus: (e: { currentTarget: Element }) => {
      if (e.currentTarget.matches(":focus-visible")) prefetchFile(urls, path);
    },
  });

  const mark = (e: Entry, comments = e.comments, stale = e.stale, dot = change(e)) => (
    <>
      {dot}
      {comments ? (
        <span className="tree-mark" title={`${comments} open comment${comments === 1 ? "" : "s"}`}>
          <span aria-hidden="true">{comments}</span>
          <span className="visually-hidden">
            {comments} open comment{comments === 1 ? "" : "s"}
          </span>
        </span>
      ) : null}
      {stale ? (
        <span className="tree-mark" title={stale === "stale" ? "Stale" : "Stale soon"}>
          <span aria-hidden="true">
            <Icon name={stale === "stale" ? "stale" : "soon"} size={12} />
          </span>
          <span className="visually-hidden">{stale === "stale" ? "stale" : "stale soon"}</span>
        </span>
      ) : null}
    </>
  );
  /**
   * A closed folder's marks: the dot of the newest file inside that has one, the open comments
   * added up, and stale if anything inside is (else stale soon).
   */
  const rolledUp = (dir: string) => {
    const all = inside.get(dir) ?? [];
    let comments = 0;
    let stale: Entry["stale"];
    for (const f of all) {
      comments += f.comments ?? 0;
      if (f.stale === "stale" || (f.stale && !stale)) stale = f.stale;
    }
    let dot: React.ReactNode = null;
    for (const f of [...all].sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0))) {
      dot = change(f, true);
      if (dot) break;
    }
    return mark({ path: dir, kind: "dir" }, comments, stale, dot);
  };
  /** A file's change dot; `inner` words it for the closed folder that holds the file. */
  const change = (e: Entry, inner = false) => {
    const what = inner ? "something in here" : "this";
    const a = changes.get(e.path);
    if (a && isLive(a, now)) {
      const said = `${actorName(a.actor, a.by)} is editing ${what} now`;
      return (
        <span className="tree-mark" title={said}>
          <span className="change-dot live" aria-hidden="true" />
          <span className="visually-hidden">{said}</span>
        </span>
      );
    }
    // Solid past the seen cursor (an agent's write seen live counts before the index reloads).
    const at = Math.max(typeof e.seq === "number" ? e.seq : 0, a?.seq ?? 0);
    if (seen !== null && at > seen) {
      return (
        <span
          className="tree-mark"
          title={inner ? "Changed inside since you last looked" : "Changed since you last looked"}
        >
          <span className="change-dot" aria-hidden="true" />
          <span className="visually-hidden">
            {inner ? "changed inside since you last looked" : "changed since you last looked"}
          </span>
        </span>
      );
    }
    return null;
  };

  const rows = (dir: string): React.ReactNode => {
    if (dirs === null && failed) {
      return (
        <li className="tree-note">
          Could not load the files.{" "}
          <button type="button" onClick={() => void load()}>
            Retry
          </button>
        </li>
      );
    }
    if (dirs === null) return <li className="tree-note">Loading…</li>;
    const entries = dirs[dir] ?? [];
    if (entries.length === 0 && dir === "") return <li className="tree-note">No pages yet.</li>;
    return entries.map((e) =>
      e.kind === "dir" ? (
        <li key={e.path}>
          {/* The chevron opens and closes the folder here; its name opens its folder view, which
              reveals it (TEMPRA-123). */}
          <div className="tree-row dir">
            <button
              type="button"
              className="tree-chevron"
              aria-expanded={expanded.has(e.path)}
              aria-label={`${folderName(e.path)} folder`}
              onClick={() => toggle(e.path)}
            >
              <Icon name="chevron" />
            </button>
            <a
              className="tree-name"
              href={urls.tree(e.path)}
              title={folderName(e.path)}
              aria-current={props.dir === e.path ? "page" : undefined}
              ref={props.dir === e.path ? setCurrentRow : undefined}
              onClick={() => expand(e.path)}
            >
              {folderName(e.path)}
            </a>
            {(counts.get(e.path) ?? 0) > 0 && (
              <span className="tree-count">{counts.get(e.path)}</span>
            )}
            {!expanded.has(e.path) && rolledUp(e.path)}
          </div>
          {expanded.has(e.path) && <ul>{rows(e.path)}</ul>}
        </li>
      ) : (
        <li key={e.path}>
          <div className={e.kind === "attachment" ? "tree-row file" : "tree-row"}>
            <span className="tree-leaf">
              {e.kind === "attachment" && <Icon name="file" size={14} />}
            </span>
            <a
              href={urls.file(e.path)}
              title={fileLabel(e)}
              data-path={e.path}
              {...ahead(e.path)}
              aria-current={props.file === e.path ? "page" : undefined}
              ref={props.file === e.path ? setCurrentRow : undefined}
            >
              {fileLabel(e)}
            </a>
            {mark(e)}
          </div>
        </li>
      ),
    );
  };

  return (
    <nav aria-label="Files">
      <ul className="tree">{rows("")}</ul>
    </nav>
  );
}
