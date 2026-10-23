import { isLive, useNow } from "../activity";
import type { ActedBy } from "../agents";
import { useAgentNames } from "../agents";
import { api, useLoad } from "../api";
import { useAgentChanges } from "../changes";
import { Icon } from "../chrome";
import { useFeed, useLastSeen, useTrailing } from "../live";
import type { OutlineFile } from "../Tree";
import { Crumbs, plural, Status, useTitle } from "../ui";
import { baseName, dirOf, folderName, type Urls } from "../urls";
import { PageBar, PageColumn, useFrame } from "../Workspace";
import { NotFound } from "./File";

/*
 * A folder (take 4, TEMPRA-117; tempra-dev: app/home, The folder view): its name, then its
 * subfolders with their counts and its concepts by title with their one-line descriptions and the
 * change dot (solid: changed since the person last looked; pulsing: an agent writing it now),
 * then its files by name (from the workspace's outline, H-2). Nothing else. The synthesized index.md stays for agents, linked at the foot.
 */

/** GET …/folder: a directory at head (worker/src/store/store.ts, FolderView). */
export interface FolderView {
  seq: number;
  dir: string;
  folders: { path: string; concepts: number; newest_ts: string | null }[];
  concepts: FolderConcept[];
  counts: { concepts: number; unverified: number; newest: { path: string; ts: string } | null };
}

export interface FolderConcept {
  path: string;
  title: string | null;
  description: string | null;
  seq: number;
  /** The current version: when, and by whom. */
  ts: string;
  actor: string;
  by: ActedBy | null;
  /** A person verified the current version (unused here since take 4). */
  verified: boolean;
  /** Open comment threads (unused here since take 4). */
  comments: number;
  stale?: "stale" | "stale_soon";
}

/** The folder view's cache key. Always head: the endpoint has no `at`. */
const folderKey = (urls: Urls, dir: string) => `folder ${urls.base} ${dir}`;

export function Folder({ urls: pinned, dir }: { urls: Urls; dir: string }) {
  // The view is of head, so its links are too.
  const urls = pinned.pinned(undefined);
  useTitle(`${folderName(dir)} · ${urls.slug}`);
  const loaded = useLoad(folderKey(urls, dir), () => api<FolderView>(urls.api("folder", { dir })));
  const seen = useLastSeen(urls);
  const head = loaded.state === "ready" ? loaded.data.seq : null;
  const agents = useAgentChanges(urls, head);
  const name = useAgentNames(
    urls,
    [...agents.changes.values()].map((a) => a.by?.agent),
  );
  const now = useNow(10_000);
  const frame = useFrame();
  // Live: a write, move or comment under this folder changes its rows.
  const under = (p: string | null) => p !== null && (dir === "" || p.startsWith(`${dir}/`));
  const reload = useTrailing(loaded.reload);
  useFeed(
    urls,
    head,
    (events) => {
      if (events.some((e) => under(e.path) || under(e.from_path))) reload();
    },
    reload,
  );
  if (loaded.state === "error" && loaded.error.status === 404) {
    return <NotFound urls={urls} path={dir} />;
  }
  return (
    <>
      <PageBar>
        <Crumbs urls={urls} path={dir} file={false} />
      </PageBar>
      <PageColumn>
        <Status loaded={loaded}>
          {(view) => (
            <FolderBody
              urls={urls}
              dir={dir}
              view={view}
              seen={seen}
              index={frame.index}
              live={(path) => {
                const a = agents.changes.get(path);
                return a && isLive(a, now) ? name(a.actor, a.by) : null;
              }}
            />
          )}
        </Status>
      </PageColumn>
    </>
  );
}

/** The page under its bar, for a given folder (exported for tests). */
export function FolderBody(props: {
  urls: Urls;
  dir: string;
  view: FolderView;
  /** The person's seen cursor, for the solid dot. */
  seen: number | null;
  /** Who is writing a concept now (an agent's write within the last minute), if anyone. */
  live?: (path: string) => string | null;
  /** The library's outline (the workspace's), for the files: `GET …/folder` lists concepts. */
  index?: OutlineFile[] | null;
}) {
  const { urls, view, seen, dir } = props;
  const subfolders = [...view.folders].sort((a, b) => a.path.localeCompare(b.path));
  const concepts = [...view.concepts].sort(byTitle);
  const attachments = (props.index ?? []).filter((f) => f.kind === "attachment");
  const files = attachments
    .filter((f) => dirOf(f.path) === dir)
    .sort((a, b) => baseName(a.path).localeCompare(baseName(b.path), undefined, { numeric: true }));
  /** A subfolder's size: its pages, or its files when it holds only files ("1 file"). */
  const size = (f: FolderView["folders"][number]) => {
    if (f.concepts > 0) return plural(f.concepts, "page");
    const n = attachments.filter((a) => a.path.startsWith(`${f.path}/`)).length;
    return n > 0 ? plural(n, "file") : plural(0, "page");
  };
  return (
    <div className="folder">
      <header className="view-head">
        <div className="view-head-main">
          <h1 className="view-title">{folderName(props.dir)}</h1>
        </div>
      </header>
      {subfolders.length + concepts.length + files.length === 0 ? (
        <p className="folder-empty">This folder is empty.</p>
      ) : (
        <ul className="folder-list">
          {subfolders.map((f) => (
            <li key={f.path}>
              <a className="folder-row folder-sub" href={urls.tree(f.path)}>
                <span className="folder-title">
                  <Icon name="folder" />
                  {folderName(f.path)}
                </span>
                <span className="folder-count">{size(f)}</span>
              </a>
            </li>
          ))}
          {concepts.map((c) => (
            <ConceptRow
              key={c.path}
              urls={urls}
              concept={c}
              changed={seen !== null && c.seq > seen}
              writing={props.live?.(c.path) ?? null}
            />
          ))}
          {files.map((f) => (
            <li key={f.path}>
              <a className="folder-row folder-file" href={urls.file(f.path)}>
                <span className="folder-title">
                  <Icon name="file" />
                  {baseName(f.path)}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
      <p className="folder-foot">
        For agents:{" "}
        <a href={urls.raw(props.dir === "" ? "index.md" : `${props.dir}/index.md`)}>index.md</a>
      </p>
    </div>
  );
}

const byTitle = (a: FolderConcept, b: FolderConcept) =>
  (a.title ?? a.path).localeCompare(b.title ?? b.path, undefined, { sensitivity: "base" });

/** A concept: its title with the dot, its one-line description, and who is writing it now. */
function ConceptRow(props: {
  urls: Urls;
  concept: FolderConcept;
  changed: boolean;
  writing: string | null;
}) {
  const { concept: c, writing } = props;
  return (
    <li>
      <a className="folder-row" href={props.urls.file(c.path)}>
        <span className="folder-main">
          <span className="folder-title">
            {c.title ?? c.path}
            {(writing || props.changed) && (
              <span
                className="folder-dot"
                title={writing ? `${writing} is editing` : "Changed since you last looked"}
              >
                <span className={writing ? "change-dot live" : "change-dot"} aria-hidden="true" />
                <span className="visually-hidden">
                  {writing ? "being written now" : "changed since you last looked"}
                </span>
              </span>
            )}
          </span>
          {c.description && <span className="folder-desc">{c.description}</span>}
        </span>
        {writing && <span className="folder-live">{writing} is editing</span>}
      </a>
    </li>
  );
}
