import { useState } from "react";
import { type ActedBy, type ActorView, useActors } from "../agents";
import { api, useLoad } from "../api";
import { Avatar, Icon, Menu } from "../chrome";
import { useFeed, useTrailing } from "../live";
import { Crumbs, day, plural, recently, Status, useMe, useTitle, who } from "../ui";
import { folderName, type Urls } from "../urls";
import { PageBar, SheetPage } from "../Workspace";

/*
 * A folder (take 3, TEMPRA-106; tempra-dev: app/workspace): its subfolders and concepts as rows,
 * from one `GET …/folder`. It replaces the synthesized index.md as the folder's page; agents
 * still read index.md, and the "…" menu opens it as they do.
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
  /** A person verified the current version. */
  verified: boolean;
  /** Open comment threads. */
  comments: number;
  stale?: "stale" | "stale_soon";
}

type Sort = "recent" | "az";

/** The folder view's cache key. Always head: the endpoint has no `at`. */
const folderKey = (urls: Urls, dir: string) => `folder ${urls.base} ${dir}`;

export function Folder({ urls: pinned, dir }: { urls: Urls; dir: string }) {
  // The view is of head, so its links are too.
  const urls = pinned.pinned(undefined);
  useTitle(`${folderName(dir)} · ${urls.slug}`);
  const me = useMe();
  const actors = useActors(urls, me?.actor ?? null);
  const loaded = useLoad(folderKey(urls, dir), () => api<FolderView>(urls.api("folder", { dir })));
  // Live: a write, move or comment under this folder changes its rows.
  const under = (p: string | null) => p !== null && (dir === "" || p.startsWith(`${dir}/`));
  const reload = useTrailing(loaded.reload);
  useFeed(
    urls,
    loaded.state === "ready" ? loaded.data.seq : null,
    (events) => {
      if (events.some((e) => under(e.path) || under(e.from_path))) reload();
    },
    reload,
  );
  return (
    <>
      <PageBar
        actions={
          <Menu
            label={<Icon name="more" />}
            name="More"
            title="More"
            buttonClass="icon-button"
            align="end"
          >
            <a href={urls.raw(`${dir}/index.md`)}>Markdown (index.md)</a>
          </Menu>
        }
      >
        <Crumbs urls={urls} path={dir} file={false} />
      </PageBar>
      <SheetPage>
        <Status loaded={loaded}>
          {(view) => <FolderBody urls={urls} dir={dir} view={view} actor={actors.view} />}
        </Status>
      </SheetPage>
    </>
  );
}

/** The page under its bar, for a given folder (exported for tests). */
export function FolderBody(props: {
  urls: Urls;
  dir: string;
  view: FolderView;
  actor: (actor: string, by?: ActedBy | null) => ActorView;
}) {
  const { urls, view } = props;
  const [sort, setSort] = useState<Sort>("recent");
  const [unverified, setUnverified] = useState(false);
  const [threads, setThreads] = useState(false);
  const now = Date.now();
  const rows = view.concepts
    .filter((c) => (!unverified || !c.verified) && (!threads || c.comments > 0))
    .sort(sort === "recent" ? byRecent : byTitle);
  const filtered = unverified || threads;
  return (
    <div className="folder">
      <header className="view-head">
        <div className="view-head-main">
          <h1 className="view-title">{folderName(props.dir)}</h1>
          <Counts counts={view.counts} now={now} />
        </div>
      </header>
      {view.concepts.length > 0 && (
        <div className="view-filters">
          <fieldset className="segmented">
            <legend className="visually-hidden">Sort</legend>
            <button
              type="button"
              aria-pressed={sort === "recent"}
              onClick={() => setSort("recent")}
            >
              Recent
            </button>
            <button type="button" aria-pressed={sort === "az"} onClick={() => setSort("az")}>
              A–Z
            </button>
          </fieldset>
          <button
            type="button"
            className="pill-toggle"
            aria-pressed={unverified}
            onClick={() => setUnverified((on) => !on)}
          >
            Not verified
          </button>
          <button
            type="button"
            className="pill-toggle"
            aria-pressed={threads}
            onClick={() => setThreads((on) => !on)}
          >
            With open threads
          </button>
        </div>
      )}
      <ul className="folder-list">
        {!filtered &&
          [...view.folders]
            .sort((a, b) => a.path.localeCompare(b.path))
            .map((f) => <SubfolderRow key={f.path} urls={urls} folder={f} now={now} />)}
        {rows.map((c) => (
          <ConceptRow
            key={c.path}
            urls={urls}
            concept={c}
            who={props.actor(c.actor, c.by)}
            now={now}
          />
        ))}
      </ul>
      {filtered && rows.length === 0 && <p className="folder-empty">Nothing here matches.</p>}
      {!filtered && view.concepts.length === 0 && view.folders.length === 0 && (
        <p className="folder-empty">This folder is empty.</p>
      )}
      {rows.length > 0 && (
        <p className="folder-legend">
          <span className="folder-dot verified" aria-hidden="true" /> verified by a person ·{" "}
          <span className="folder-dot" aria-hidden="true" /> not yet verified
        </p>
      )}
    </div>
  );
}

const byRecent = (a: FolderConcept, b: FolderConcept) =>
  b.ts.localeCompare(a.ts) || a.path.localeCompare(b.path);

const byTitle = (a: FolderConcept, b: FolderConcept) =>
  (a.title ?? a.path).localeCompare(b.title ?? b.path, undefined, { sensitivity: "base" });

/** "10 concepts · 4 not verified · newest change 14 min ago". */
function Counts({ counts, now }: { counts: FolderView["counts"]; now: number }) {
  const parts = [plural(counts.concepts, "concept")];
  if (counts.unverified > 0) parts.push(`${counts.unverified} not verified`);
  if (counts.newest) {
    const ts = counts.newest.ts;
    const t = recently(ts, now);
    parts.push(`newest change ${t === day(ts) ? t : `${t} ago`}`);
  }
  return <p className="view-meta">{parts.join(" · ")}</p>;
}

function SubfolderRow(props: { urls: Urls; folder: FolderView["folders"][number]; now: number }) {
  const { folder } = props;
  return (
    <li>
      <a className="folder-row folder-sub" href={props.urls.tree(folder.path)}>
        <span className="folder-main">
          <span className="folder-title">
            <Icon name="folder" />
            {folderName(folder.path)}
          </span>
        </span>
        <span className="folder-by">
          {plural(folder.concepts, "concept")}
          {folder.newest_ts && ` · ${recently(folder.newest_ts, props.now)}`}
        </span>
      </a>
    </li>
  );
}

/** A concept: title and description, who wrote its current version, open threads, trust. */
function ConceptRow(props: { urls: Urls; concept: FolderConcept; who: ActorView; now: number }) {
  const { concept: c, who: by } = props;
  return (
    <li>
      <a className="folder-row" href={props.urls.file(c.path)}>
        <span className="folder-main">
          <span className="folder-title">{c.title ?? c.path}</span>
          {c.description && <span className="folder-desc">{c.description}</span>}
        </span>
        <span className="folder-by">
          {c.ts && (
            <>
              <Avatar name={by.agent ? by.name : who(c.actor)} agent={by.agent} />
              {by.name} · {recently(c.ts, props.now)}
            </>
          )}
        </span>
        <span className="folder-marks">
          {c.comments > 0 && (
            <span className="folder-threads" title={plural(c.comments, "open thread")}>
              <Icon name="comments" size={12} />
              {c.comments}
              <span className="visually-hidden"> open threads</span>
            </span>
          )}
          <span
            className={c.verified ? "folder-dot verified" : "folder-dot"}
            title={c.verified ? "Verified" : "Not verified"}
          >
            <span className="visually-hidden">{c.verified ? "Verified" : "Not verified"}</span>
          </span>
        </span>
      </a>
    </li>
  );
}
