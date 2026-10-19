import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAgentNames } from "./agents";
import { api } from "./api";
import { type AgentChange, warmth } from "./changes";
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

/** Every folder's children from the flat list of files: folders first, then files, by name. */
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
    out[d] = [...m.values()].sort((a, b) =>
      a.kind === "dir" && b.kind !== "dir"
        ? -1
        : b.kind === "dir" && a.kind !== "dir"
          ? 1
          : a.path.localeCompare(b.path),
    );
  }
  return out;
}

/**
 * The library's file tree (tempra-dev: app/workspace). The whole index (paths, titles,
 * sequences; no bodies) arrives in one small request when the workspace opens, so opening a
 * folder never waits. A folder (named for people, with its count of concepts) opens and closes in
 * place; it is not a page. Open folders are remembered on this browser, the open file is revealed
 * and marked, and the change feed refreshes the index once per burst of writes. A dot marks a file
 * an agent changed (warm, then cooling) or that changed since the person last looked.
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

  // A file's page is loaded ahead when the pointer rests on it, or the keyboard reaches it.
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(hoverTimer.current), []);
  const ahead = (path: string) => ({
    onMouseEnter: () => {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = setTimeout(() => prefetchFile(urls, path), HOVER_MS);
    },
    onMouseLeave: () => clearTimeout(hoverTimer.current),
    onFocus: (e: { currentTarget: Element }) => {
      if (e.currentTarget.matches(":focus-visible")) prefetchFile(urls, path);
    },
  });

  const mark = (e: Entry) => (
    <>
      {change(e)}
      {e.comments ? (
        <span
          className="tree-mark"
          title={`${e.comments} open comment${e.comments === 1 ? "" : "s"}`}
        >
          <span aria-hidden="true">{e.comments}</span>
          <span className="visually-hidden">
            {e.comments} open comment{e.comments === 1 ? "" : "s"}
          </span>
        </span>
      ) : null}
      {e.stale ? (
        <span
          className="tree-mark"
          title={e.stale === "stale" ? "Stale: stale_after has passed" : "Stale soon"}
        >
          <span aria-hidden="true">
            <Icon name={e.stale === "stale" ? "stale" : "soon"} size={12} />
          </span>
          <span className="visually-hidden">{e.stale === "stale" ? "stale" : "stale soon"}</span>
        </span>
      ) : null}
    </>
  );
  const change = (e: Entry) => {
    const a = changes.get(e.path);
    const warm = warmth(a, now);
    if (a && warm) {
      const by = actorName(a.actor, a.by);
      const said = warm === "warm" ? `${by} changed this just now` : `${by} changed this lately`;
      return (
        <span className="tree-mark" title={said}>
          <span className={`change-dot ${warm}`} aria-hidden="true" />
          <span className="visually-hidden">{said}</span>
        </span>
      );
    }
    if (seen !== null && typeof e.seq === "number" && e.seq > seen) {
      return (
        <span className="tree-mark" title="Changed since you last looked">
          <span className="change-dot cool" aria-hidden="true" />
          <span className="visually-hidden">changed since you last looked</span>
        </span>
      );
    }
    return null;
  };
  const label = (e: Entry) => (e.kind === "concept" && e.title ? e.title : baseName(e.path));

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
    if (entries.length === 0 && dir === "") return <li className="tree-note">No files yet.</li>;
    return entries.map((e) =>
      e.kind === "dir" ? (
        <li key={e.path}>
          {/* A folder opens and closes here; its index.md is a page only by its URL. */}
          <button
            type="button"
            className="tree-row dir"
            aria-expanded={expanded.has(e.path)}
            aria-current={props.dir === e.path ? "page" : undefined}
            ref={props.dir === e.path ? setCurrentRow : undefined}
            onClick={() => toggle(e.path)}
          >
            <span className="tree-chevron">
              <Icon name="chevron" />
            </span>
            <span className="tree-name" title={e.path}>
              {folderName(e.path)}
            </span>
            {(counts.get(e.path) ?? 0) > 0 && (
              <span className="tree-count">{counts.get(e.path)}</span>
            )}
          </button>
          {expanded.has(e.path) && <ul>{rows(e.path)}</ul>}
        </li>
      ) : (
        <li key={e.path}>
          <div className="tree-row">
            <span className="tree-leaf" />
            <a
              href={urls.file(e.path)}
              title={e.path}
              {...ahead(e.path)}
              aria-current={props.file === e.path ? "page" : undefined}
              ref={props.file === e.path ? setCurrentRow : undefined}
            >
              {label(e)}
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
