import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { Icon } from "./chrome";
import { useFeed } from "./live";
import { prefetchFile } from "./prefetch";
import { plural } from "./ui";
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

/*
 * Every folder starts open, the library laid out as a docs site's sidebar is (TEMPRA-146); what
 * is remembered is the folders the person closed. (The key changed with it: the old one listed
 * the open folders.)
 */
const closedKey = (urls: Urls) => `tempra:tree-closed:${urls.owner}/${urls.slug}`;

function loadClosed(urls: Urls): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(closedKey(urls)) ?? "[]") as unknown;
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function saveClosed(urls: Urls, dirs: Set<string>) {
  try {
    localStorage.setItem(closedKey(urls), JSON.stringify([...dirs]));
  } catch {
    // Storage off: every folder opens again next time.
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
 * The library's file tree (tempra-dev: app/workspace). The whole index (paths, titles,
 * sequences; no bodies) arrives in one small request when the workspace opens, so opening a
 * folder never waits. A folder (named for people, with its count of concepts) is a group, not a
 * page: its row opens and closes it (TEMPRA-138), and a folder's address reveals it here. Every
 * folder starts open; the ones the person closed are remembered on this browser, the open file is revealed and marked, and the change feed
 * refreshes the index once per burst of writes. A closed folder rolls up the marks of what is
 * inside it. Change is not marked here (TEMPRA-173): Activity is where a person looks for it.
 */
export function Tree(props: {
  urls: Urls;
  file: string | null;
  dir: string | null;
  /** The index and its sequence, for the quick switcher and the feed's start. */
  onIndex?(files: OutlineFile[], seq: number): void;
}) {
  const { urls } = props;
  const [files, setFiles] = useState<Entry[] | null>(null);
  const [closed, setClosed] = useState(() => loadClosed(urls));
  const isOpen = (dir: string) => !closed.has(dir);
  const [seq, setSeq] = useState<number | null>(null);
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

  // The open file's folders are revealed when it opens (and may be collapsed after); so is a
  // folder whose address was opened (`dir`, on its way to the home).
  const current = props.file ?? props.dir;
  /** A folder being revealed: its row is scrolled into view when it first draws. */
  const revealing = useRef<string | null>(null);
  useEffect(() => {
    if (current === null) return;
    if (props.file === null) revealing.current = current;
    const up = props.file !== null ? ancestors(props.file) : [...ancestors(current), current];
    const want = up.filter((d) => d !== "");
    setClosed((c) => {
      if (!want.some((d) => c.has(d))) return c;
      const next = new Set([...c].filter((d) => !want.includes(d)));
      saveClosed(urls, next);
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
    setClosed((c) => {
      const next = new Set(c);
      if (next.has(dir)) next.delete(dir);
      else next.add(dir);
      saveClosed(urls, next);
      return next;
    });

  // The open file's (or revealed folder's) row is scrolled into view once, when it opens (not after every refresh,
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

  const mark = (e: Entry, comments = e.comments, stale = e.stale) => (
    <>
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
   * A closed folder's marks: the open comments added up, and stale if anything inside is (else
   * stale soon).
   */
  const rolledUp = (dir: string) => {
    const all = inside.get(dir) ?? [];
    let comments = 0;
    let stale: Entry["stale"];
    for (const f of all) {
      comments += f.comments ?? 0;
      if (f.stale === "stale" || (f.stale && !stale)) stale = f.stale;
    }
    return mark({ path: dir, kind: "dir" }, comments, stale);
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
          {/* A folder is a group, not a page (TEMPRA-138): its whole row opens and closes it. */}
          <div className={isOpen(e.path) ? "tree-row dir open" : "tree-row dir"}>
            <span className="tree-chevron" aria-hidden="true">
              <Icon name="chevron" />
            </span>
            <button
              type="button"
              className="tree-name"
              aria-expanded={isOpen(e.path)}
              title={folderName(e.path)}
              ref={(el) => {
                if (el && revealing.current === e.path) {
                  revealing.current = null;
                  el.scrollIntoView({ block: "nearest" });
                }
              }}
              onClick={() => toggle(e.path)}
            >
              {folderName(e.path)}
              {(counts.get(e.path) ?? 0) > 0 && (
                <span className="visually-hidden">, {plural(counts.get(e.path) ?? 0, "page")}</span>
              )}
            </button>
            {(counts.get(e.path) ?? 0) > 0 && (
              <span className="tree-count" aria-hidden="true">
                {counts.get(e.path)}
              </span>
            )}
            {!isOpen(e.path) && rolledUp(e.path)}
          </div>
          {isOpen(e.path) && <ul>{rows(e.path)}</ul>}
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
