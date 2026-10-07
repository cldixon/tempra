import { useEffect } from "react";
import { ApiError, api, useLoad } from "../api";
import { lastSeen, markSeen, useFeed, useTrailing } from "../live";
import { AtNotice, Crumbs, formatSize, plural, Status, useTitle } from "../ui";
import { baseName, type Urls } from "../urls";

interface Entry {
  path: string;
  seq?: number;
  kind: "concept" | "attachment" | "dir";
  files?: number;
  type?: string;
  title?: string | null;
  description?: string | null;
  status?: string;
  trust_tier?: string;
  stale?: boolean;
  size?: number;
  media?: string | null;
}

interface Summary {
  seq: number;
  concepts: number;
  attachments: number;
  open_work: number;
  types: Record<string, number>;
}

interface Stats {
  seq: number;
  events: number;
  requests: number;
  bytes: number | null;
  maintainers: { export: { cursor: number; lag: number; last_run: string | null } };
  next_run: string | null;
}

export function Directory({ urls, dir }: { urls: Urls; dir: string }) {
  useTitle(dir === "" ? urls.slug : `${dir}/ · ${urls.slug}`);
  const atRoot = dir === "" && urls.at === undefined;
  const loaded = useLoad(`dir ${urls.tree(dir)}`, async () => {
    const [tree, stats, summary] = await Promise.all([
      api<{ seq: number; entries: Entry[] }>(
        urls.api("tree", { prefix: dir || undefined, depth: 1, at: urls.at }),
      ),
      api<Stats>(urls.api("stats")),
      atRoot ? api<Summary>(urls.api("summary")) : Promise.resolve(undefined),
    ]);
    if (dir !== "" && tree.entries.length === 0) {
      throw new ApiError(404, "not_found", `There is no directory ${dir}/ in ${urls.slug}.`);
    }
    return { entries: tree.entries, stats, summary };
  });
  // Live: anything written under this directory reloads it in place (tempra-dev: app/live).
  const under = (p: string | null) =>
    p !== null && (dir === "" || p === dir || p.startsWith(`${dir}/`));
  const head = loaded.state === "ready" ? loaded.data.stats.seq : null;
  const reload = useTrailing(loaded.reload);
  useFeed(
    urls,
    urls.at === undefined ? head : null,
    (events) => {
      if (urls.at === undefined && events.some((e) => under(e.path) || under(e.from_path))) {
        reload();
      }
    },
    reload,
  );
  const seen = lastSeen(urls);
  useEffect(() => {
    if (head !== null && urls.at === undefined) markSeen(urls, head);
  }, [head, urls]);
  return (
    <Status loaded={loaded}>
      {({ entries, stats, summary }) => (
        <Listing
          urls={urls}
          dir={dir}
          entries={entries}
          stats={stats}
          summary={summary}
          seen={seen}
        />
      )}
    </Status>
  );
}

function Listing(props: {
  urls: Urls;
  dir: string;
  entries: Entry[];
  stats: Stats;
  summary?: Summary;
  /** The ledger sequence last seen here on this browser: later rows are marked new. */
  seen: number | null;
}) {
  const { urls, dir, entries, stats, summary, seen } = props;
  const isNew = (e: Entry) => seen !== null && e.seq !== undefined && e.seq > seen;
  const dirs = entries.filter((e) => e.kind === "dir");
  const concepts = entries.filter((e) => e.kind === "concept");
  const attachments = entries.filter((e) => e.kind === "attachment");
  const index = dir === "" ? "index.md" : `${dir}/index.md`;
  /** What is worth a word beside a concept: its type, and anything that is not the norm. */
  const notes = (c: Entry) =>
    [
      c.type ?? "no type",
      isNew(c) ? "new" : "",
      c.trust_tier === "human-reviewed" ? "human-reviewed" : "",
      c.stale ? "stale" : "",
      c.status && c.status !== "stable" ? c.status : "",
    ]
      .filter(Boolean)
      .join(" · ");
  return (
    <>
      <Crumbs urls={urls} path={dir} file={false} />
      <h1>{dir === "" ? urls.slug : `${baseName(dir)}/`}</h1>
      <AtNotice urls={urls} head={stats.seq} current={urls.pinned(undefined).tree(dir)} />
      {summary && <Overview summary={summary} />}
      {entries.length === 0 && (
        <p className="muted">Nothing here{urls.at ? " at this sequence" : ""}.</p>
      )}
      {(dirs.length > 0 || concepts.length > 0) && (
        <ul className="file-list">
          {dirs.map((d) => (
            <li key={d.path}>
              <a href={urls.tree(d.path)}>
                <span className="name">{baseName(d.path)}/</span>
                <span className="meta">
                  {d.files} file{d.files === 1 ? "" : "s"}
                </span>
              </a>
            </li>
          ))}
          {concepts.map((c) => (
            <li key={c.path}>
              <a href={urls.file(c.path)} title={c.path}>
                <span className="name">{c.title || baseName(c.path)}</span>
                <span className="meta">{notes(c)}</span>
                {c.description && <span className="line">{c.description}</span>}
              </a>
            </li>
          ))}
        </ul>
      )}
      {attachments.length > 0 && (
        <>
          <h2 className="label">Attachments</h2>
          <ul className="file-list">
            {attachments.map((a) => (
              <li key={a.path}>
                <a href={urls.file(a.path)}>
                  <span className="name">{baseName(a.path)}</span>
                  <span className="meta">
                    {[isNew(a) ? "new" : "", a.media ?? "file", formatSize(a.size ?? 0)]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="small faint">
        <a href={urls.raw(index)}>index.md</a> as agents read it
      </p>
    </>
  );
}

/** The library in one line: how many concepts and attachments, and of which types. */
function Overview({ summary: s }: { summary: Summary }) {
  const types = Object.entries(s.types)
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `${t} ${n}`);
  return (
    <p className="small muted">
      {[plural(s.concepts, "concept"), plural(s.attachments, "attachment"), ...types].join(" · ")}
    </p>
  );
}
