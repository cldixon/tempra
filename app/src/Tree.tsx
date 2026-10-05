import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { type FeedEvent, lastSeen, useFeed } from "./live";
import { baseName, dirOf, type Urls } from "./urls";

/** One entry of `GET …/tree?depth=1`. */
interface Entry {
  path: string;
  kind: "dir" | "concept" | "attachment";
  title?: string | null;
  seq?: number;
}

/** How long a file keeps its "an agent just changed this" mark. */
const ACTIVE_MS = 5 * 60_000;

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

/**
 * The library's file tree (tempra-dev: app/workspace): loaded one directory at a time, open
 * folders remembered on this browser, the open file revealed and marked, and kept current by the
 * change feed, with a mark on files an agent changed in the last minutes or since the last visit.
 */
export function Tree(props: { urls: Urls; file: string | null; dir: string | null }) {
  const { urls } = props;
  const [dirs, setDirs] = useState<Record<string, Entry[]>>({});
  const [expanded, setExpanded] = useState(() => loadExpanded(urls));
  const [rootSeq, setRootSeq] = useState<number | null>(null);
  const [active, setActive] = useState<Map<string, { actor: string; at: number }>>(new Map());
  const [filter, setFilter] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const seen = lastSeen(urls);
  const loading = useRef(new Set<string>());
  const loaded = useRef(dirs);
  loaded.current = dirs;

  const load = useCallback(
    async (dir: string) => {
      if (loading.current.has(dir)) return;
      loading.current.add(dir);
      try {
        const r = await api<{ seq: number; entries: Entry[] }>(
          urls.api("tree", { prefix: dir || undefined, depth: 1 }),
        );
        setDirs((d) => ({ ...d, [dir]: r.entries }));
        if (dir === "") setRootSeq(r.seq);
      } catch {
        // A folder that went away (deleted, moved): it simply shows nothing.
        setDirs((d) => ({ ...d, [dir]: [] }));
      } finally {
        loading.current.delete(dir);
      }
    },
    [urls],
  );

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

  // Every open folder (and the root) is loaded once.
  useEffect(() => {
    for (const d of ["", ...expanded]) if (!(d in dirs)) void load(d);
  }, [expanded, dirs, load]);

  // Live: reload the loaded folders a write touched, once per burst.
  const pending = useRef(new Set<string>());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const refresh = useCallback(
    (paths: string[]) => {
      for (const p of paths) for (const d of ["", ...ancestors(p)]) pending.current.add(d);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        const todo = [...pending.current];
        pending.current.clear();
        for (const dir of todo) if (dir in loaded.current) void load(dir);
      }, 300);
    },
    [load],
  );
  useEffect(() => () => clearTimeout(timer.current), []);
  useFeed(
    urls,
    rootSeq,
    (events: FeedEvent[]) => {
      refresh(events.flatMap((e) => (e.from_path ? [e.path, e.from_path] : [e.path])));
      const agents = events.filter((e) => !e.actor.startsWith("human:") && e.op !== "delete");
      if (agents.length > 0) {
        setActive((a) => {
          const next = new Map(a);
          for (const e of agents) next.set(e.path, { actor: e.actor, at: Date.now() });
          return next;
        });
      }
    },
    () => {
      setDirs({});
      setRootSeq(null);
    },
  );
  // Activity marks fade after a few minutes.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const toggle = (dir: string) =>
    setExpanded((e) => {
      const next = new Set(e);
      if (next.has(dir)) next.delete(dir);
      else next.add(dir);
      saveExpanded(urls, next);
      return next;
    });

  const currentRow = useRef<HTMLAnchorElement | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when the open file changes or its row appears.
  useEffect(() => {
    currentRow.current?.scrollIntoView({ block: "nearest" });
  }, [current, dirs]);

  const mark = (e: Entry) => {
    const a = active.get(e.path);
    if (a && now - a.at < ACTIVE_MS) {
      return (
        <span className="tree-mark" title={`${a.actor} changed this just now`}>
          ●
        </span>
      );
    }
    if (seen !== null && e.seq !== undefined && e.seq > seen) {
      return (
        <span className="tree-mark" title="Changed since you last looked">
          ∗
        </span>
      );
    }
    return null;
  };
  const label = (e: Entry) => (e.kind === "concept" && e.title ? e.title : baseName(e.path));

  const rows = (dir: string) => {
    const entries = dirs[dir];
    if (entries === undefined) return <li className="muted small">Loading…</li>;
    if (entries.length === 0 && dir === "") return <li className="muted small">No files yet.</li>;
    return entries.map((e) =>
      e.kind === "dir" ? (
        <li key={e.path}>
          <div className="tree-row">
            <button
              type="button"
              className="tree-toggle"
              aria-expanded={expanded.has(e.path)}
              aria-label={`${expanded.has(e.path) ? "Collapse" : "Expand"} ${baseName(e.path)}`}
              onClick={() => toggle(e.path)}
            >
              {expanded.has(e.path) ? "▾" : "▸"}
            </button>
            <a
              href={urls.tree(e.path)}
              aria-current={props.dir === e.path ? "page" : undefined}
              ref={props.dir === e.path ? currentRow : undefined}
            >
              {baseName(e.path)}/
            </a>
          </div>
          {expanded.has(e.path) && <ul>{rows(e.path)}</ul>}
        </li>
      ) : (
        <li key={e.path}>
          <div className="tree-row">
            <span className="tree-leaf" />
            <a
              href={urls.file(e.path)}
              title={e.path}
              aria-current={props.file === e.path ? "page" : undefined}
              ref={props.file === e.path ? currentRow : undefined}
            >
              {label(e)}
            </a>
            {mark(e)}
          </div>
        </li>
      ),
    );
  };

  const matches = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return null;
    return Object.values(dirs)
      .flat()
      .filter(
        (e) =>
          e.kind !== "dir" &&
          (e.path.toLowerCase().includes(q) || (e.title ?? "").toLowerCase().includes(q)),
      )
      .sort((a, b) => a.path.localeCompare(b.path));
  }, [filter, dirs]);

  return (
    <nav aria-label="Files">
      <input
        className="ws-filter"
        type="search"
        placeholder="Filter open folders"
        aria-label="Filter open folders"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      {matches ? (
        <ul className="tree">
          {matches.length === 0 && <li className="muted small">No match in open folders.</li>}
          {matches.map((e) => (
            <li key={e.path}>
              <div className="tree-row">
                <a href={urls.file(e.path)} title={e.path}>
                  {label(e)}
                </a>
                {mark(e)}
              </div>
            </li>
          ))}
          <li className="muted small">Ctrl K searches the whole library.</li>
        </ul>
      ) : (
        <ul className="tree">
          <li>
            <div className="tree-row">
              <span className="tree-leaf" />
              <a
                href={urls.tree("")}
                aria-current={props.dir === "" ? "page" : undefined}
                ref={props.dir === "" ? currentRow : undefined}
              >
                <strong>{urls.slug}</strong>
              </a>
            </div>
          </li>
          {rows("")}
        </ul>
      )}
    </nav>
  );
}
