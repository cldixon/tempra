import { ApiError, api, useLoad } from "../api";
import {
  AtNotice,
  Chip,
  Crumbs,
  formatSize,
  LibNav,
  Status,
  TrustChip,
  useTitle,
  when,
} from "../ui";
import { baseName, type Urls } from "../urls";

interface Entry {
  path: string;
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
  return (
    <>
      <LibNav urls={urls} active="files" />
      <Status loaded={loaded}>
        {({ entries, stats, summary }) => (
          <Listing urls={urls} dir={dir} entries={entries} stats={stats} summary={summary} />
        )}
      </Status>
    </>
  );
}

function Listing(props: {
  urls: Urls;
  dir: string;
  entries: Entry[];
  stats: Stats;
  summary?: Summary;
}) {
  const { urls, dir, entries, stats, summary } = props;
  const dirs = entries.filter((e) => e.kind === "dir");
  const concepts = entries.filter((e) => e.kind === "concept");
  const attachments = entries.filter((e) => e.kind === "attachment");
  const index = dir === "" ? "index.md" : `${dir}/index.md`;
  return (
    <>
      <Crumbs urls={urls} path={dir} file={false} />
      <h1>{dir === "" ? urls.slug : `${baseName(dir)}/`}</h1>
      <AtNotice urls={urls} head={stats.seq} current={urls.pinned(undefined).tree(dir)} />
      {summary && <Overview urls={urls} summary={summary} stats={stats} />}
      {entries.length === 0 && (
        <p className="muted">Nothing here{urls.at ? " at this sequence" : ""}.</p>
      )}
      {(dirs.length > 0 || concepts.length > 0) && (
        <div className="table-wrap">
          <table className="list">
            <tbody>
              {dirs.map((d) => (
                <tr key={d.path}>
                  <td className="name">
                    <a href={urls.tree(d.path)}>
                      <strong>{baseName(d.path)}/</strong>
                    </a>
                  </td>
                  <td className="muted" colSpan={2}>
                    {d.files} file{d.files === 1 ? "" : "s"}
                  </td>
                </tr>
              ))}
              {concepts.map((c) => (
                <tr key={c.path}>
                  <td className="name">
                    <a href={urls.file(c.path)}>
                      <strong>{c.title || baseName(c.path)}</strong>
                    </a>
                    <div className="small muted">
                      {baseName(c.path)}
                      {c.description ? ` · ${c.description}` : ""}
                    </div>
                  </td>
                  <td>{c.type ? <Chip text={c.type} /> : <Chip text="no type" tone="bad" />}</td>
                  <td>
                    <div className="chips">
                      <TrustChip tier={c.trust_tier} />
                      {c.stale && <Chip text="stale" tone="bad" />}
                      {c.status && c.status !== "stable" && <Chip text={c.status} tone="warn" />}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {attachments.length > 0 && (
        <>
          <h2>Attachments</h2>
          <div className="table-wrap">
            <table className="list">
              <tbody>
                {attachments.map((a) => (
                  <tr key={a.path}>
                    <td className="name">
                      <a href={urls.file(a.path)}>{baseName(a.path)}</a>
                    </td>
                    <td className="muted">{a.media ?? "file"}</td>
                    <td className="muted">{formatSize(a.size ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="small muted">
        <a href={urls.raw(index)}>index.md</a> as agents see it
      </p>
    </>
  );
}

function Overview({ urls, summary: s, stats }: { urls: Urls; summary: Summary; stats: Stats }) {
  const types = Object.entries(s.types).sort((a, b) => b[1] - a[1]);
  const exp = stats.maintainers.export;
  const ops = [
    `${stats.events} events in ${stats.requests} requests`,
    stats.bytes !== null ? `${formatSize(stats.bytes)} stored` : "",
    exp.last_run
      ? `last nightly export ${when(exp.last_run)} (seq ${exp.cursor}${exp.lag ? `, ${exp.lag} events since` : ""})`
      : "no nightly export yet",
    stats.next_run ? `next run ${when(stats.next_run)} UTC` : "",
  ].filter(Boolean);
  return (
    <>
      <div className="stats">
        <div>
          <strong>{s.concepts}</strong> concepts
        </div>
        <div>
          <strong>{s.attachments}</strong> attachments
        </div>
        <div>
          <strong>{s.open_work}</strong> open work items
        </div>
        <div>
          <strong>{s.seq}</strong> ledger sequence
        </div>
      </div>
      {types.length > 0 && (
        <div className="chips">
          {types.map(([t, n]) => (
            <Chip key={t} text={`${t} · ${n}`} />
          ))}
        </div>
      )}
      <p className="small muted">
        {ops.join(" · ")} · <a href={urls.transfer()}>exports</a>
      </p>
    </>
  );
}
