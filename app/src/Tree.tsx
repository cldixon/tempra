import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { type FeedEvent, lastSeen, useFeed } from "./live";
import { baseName, dirOf, type Urls } from "./urls";

/** One file of `GET …/outline`: the library's index, without bodies. */
interface Entry {
  path: string;
  kind: "dir" | "concept" | "attachment";
  title?: string | null;
  seq?: number | null;
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
 * folder never waits. Open folders are remembered on this browser, the open file is revealed and
 * marked, and the change feed refreshes the index once per burst of writes, with a mark on files
 * an agent changed in the last minutes or that changed since the last visit.
 */
export function Tree(props: { urls: Urls; file: string | null; dir: string | null }) {
  const { urls } = props;
  const [files, setFiles] = useState<Entry[] | null>(null);
  const [expanded, setExpanded] = useState(() => loadExpanded(urls));
  const [seq, setSeq] = useState<number | null>(null);
  const [active, setActive] = useState<Map<string, { actor: string; at: number }>>(new Map());
  const [filter, setFilter] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const seen = lastSeen(urls);
  const dirs = useMemo(() => (files ? buildDirs(files) : null), [files]);

  const load = useCallback(async () => {
    try {
      const r = await api<{ seq: number; files: Entry[] }>(urls.api("outline"));
      setFiles(r.files);
      setSeq(r.seq);
    } catch {
      setFiles((f) => f ?? []);
    }
  }, [urls]);
  useEffect(() => {
    void load();
  }, [load]);

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

  // Live: one refresh of the index per burst of writes.
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  useFeed(
    urls,
    seq,
    (events: FeedEvent[]) => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void load(), 300);
      const agents = events.filter((e) => !e.actor.startsWith("human:") && e.op !== "delete");
      if (agents.length > 0) {
        setActive((a) => {
          const next = new Map(a);
          for (const e of agents) next.set(e.path, { actor: e.actor, at: Date.now() });
          return next;
        });
      }
    },
    () => void load(),
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
    if (seen !== null && typeof e.seq === "number" && e.seq > seen) {
      return (
        <span className="tree-mark" title="Changed since you last looked">
          ∗
        </span>
      );
    }
    return null;
  };
  const label = (e: Entry) => (e.kind === "concept" && e.title ? e.title : baseName(e.path));

  const rows = (dir: string): React.ReactNode => {
    if (dirs === null) return <li className="muted small">Loading…</li>;
    const entries = dirs[dir] ?? [];
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
    return (files ?? [])
      .filter((e) => e.path.toLowerCase().includes(q) || (e.title ?? "").toLowerCase().includes(q))
      .slice(0, 200);
  }, [filter, files]);

  return (
    <nav aria-label="Files">
      <input
        className="ws-filter"
        type="search"
        placeholder="Filter files"
        aria-label="Filter files"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      {matches ? (
        <ul className="tree">
          {matches.length === 0 && <li className="muted small">No match.</li>}
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
          <li className="muted small">Ctrl K also searches inside files.</li>
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
