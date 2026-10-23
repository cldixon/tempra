import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { byPerson, type LedgerRequest, type Touched, touchedBy, useTitles } from "../activity";
import { agentLabel, type Contributor, useAgentNames } from "../agents";
import { ApiError, api, field, useAction, useLoad } from "../api";
import { useConfirm } from "../Dialog";
import { useFeed, useTrailing } from "../live";
import { Moment } from "../Moment";
import { librariesChanged, type Role, useLibraries, useLibraryLabel, useRole } from "../role";
import { navigate } from "../router";
import {
  Crumbs,
  day,
  type Health,
  healthWords,
  localTime,
  plural,
  Status,
  useMe,
  useTitle,
} from "../ui";
import { baseName, dirOf, enc, folderName, type Urls } from "../urls";
import { PageBar, useFrame } from "../Workspace";
import { ConnectSteps } from "./Account";

/**
 * A library's management pages (TEMPRA-14; take 4 follow-ups, TEMPRA-124 and 135): For agents,
 * import and export, recovery, revert and restore, connecting an agent, members, deleting it.
 * Each acts through the REST API as the signed-in person, and speaks to people: agents by name,
 * pages by title, local times, no sequence numbers or storage words.
 */

const json = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });

/** Reloads a page (debounced) whenever the library changes, and once it loaded, after its head. */
function useLive(urls: Urls, head: number | null, reload: () => void) {
  const soon = useTrailing(reload);
  useFeed(urls, head, () => soon(), soon);
}

/** Pages' titles by path, from the index the tree loaded (the file name until it arrives). */
function useTitleOf() {
  const { index } = useFrame();
  return useMemo(() => {
    const titles = new Map<string, string>();
    for (const f of index ?? []) if (f.title) titles.set(f.path, f.title);
    return (path: string) => titles.get(path) ?? baseName(path).replace(/\.md$/, "");
  }, [index]);
}

/**
 * The owner's recovery tools (Import, Recovery, Revert, Restore; tempra-dev:
 * decisions/read-and-comment-only, its one exception): nothing until the role is known, and a
 * plain line for anyone else.
 */
function OwnerOnly({ urls, children }: { urls: Urls; children: ReactNode }) {
  const role = useRole(urls);
  if (role === null) return <p className="muted">Loading…</p>;
  if (role !== "owner") {
    return (
      <>
        <h1>Owner only</h1>
        <p>Only @{urls.owner}, the library's owner, can do this.</p>
      </>
    );
  }
  return <>{children}</>;
}

// ---------------------------------------------------------------- for agents

interface WorkItem {
  kind: string;
  path: string;
  since: string;
  detail: string;
  suggested_action: string;
  inbound_links: number;
  /** For a comment: its thread. */
  thread?: string;
}

const KINDS: [string | undefined, string][] = [
  [undefined, "Everything"],
  ["comment", "Comments"],
  ["stale", "Stale"],
  ["stale_soon", "Stale soon"],
  ["broken_link", "Broken links"],
  ["lint", "Lint"],
  ["structure", "Structure"],
];

const KIND_WORDS: Record<string, string> = {
  comment: "Open comment",
  stale: "Stale",
  stale_soon: "Stale soon",
  broken_link: "Broken link",
  lint: "Lint",
  structure: "Structure",
};

/**
 * For agents (S-7): the housekeeping agents pick up with the `work` tool (open comments, stale
 * pages, broken links, lint, structure), a quiet list in the views' style under the daily
 * check's line (TEMPRA-66).
 */
export function Work({ urls, kind }: { urls: Urls; kind?: string }) {
  useTitle(`For agents · ${useLibraryLabel(urls)}`);
  const titleOf = useTitleOf();
  const loaded = useLoad(`work ${urls.work(kind)}`, async () => {
    const [w, stats, health] = await Promise.all([
      api<{ items: WorkItem[]; total: number }>(urls.api("work", { kind, limit: 200 })),
      api<{ seq: number }>(urls.api("stats")),
      api<Health>(urls.api("health")),
    ]);
    return { ...w, head: stats.seq, health };
  });
  useLive(urls, loaded.state === "ready" ? loaded.data.head : null, loaded.reload);
  return (
    <div className="folder">
      <header className="view-head">
        <div className="view-head-main">
          <h1 className="view-title">For agents</h1>
          <p className="view-meta">Housekeeping your agents pick up when they work here.</p>
        </div>
        <select
          className="pill-select"
          aria-label="Kind"
          value={kind ?? ""}
          onChange={(e) => navigate(urls.work(e.currentTarget.value || undefined))}
        >
          {KINDS.map(([k, label]) => (
            <option key={label} value={k ?? ""}>
              {label}
            </option>
          ))}
        </select>
      </header>
      <Status loaded={loaded}>
        {({ items, total, health }) => (
          <>
            <HealthLine urls={urls} health={health} />
            {items.length === 0 ? (
              <p className="view-empty">Nothing to do.</p>
            ) : (
              <ul className="folder-list">
                {items.map((i) => (
                  <li key={i.thread ?? `${i.kind} ${i.path} ${i.detail}`}>
                    {/* A comment opens on its thread. */}
                    <a
                      className="folder-row"
                      href={i.thread ? urls.thread(i.path, i.thread) : urls.file(i.path)}
                    >
                      <span className="folder-main">
                        <span className="folder-title">{titleOf(i.path)}</span>
                        <span className="folder-desc">{i.detail}</span>
                      </span>
                      <span className="folder-count">{KIND_WORDS[i.kind] ?? i.kind}</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
            {total > items.length && (
              <p className="folder-foot">{total - items.length} more not shown.</p>
            )}
          </>
        )}
      </Status>
    </div>
  );
}

/**
 * The daily check's summary, quietly: when it ran, what it counted, and the newest changes
 * nobody has verified since. The list below is live; this line is as of the check.
 */
function HealthLine({ urls, health: h }: { urls: Urls; health: Health }) {
  const words = healthWords(h.counts);
  const newest = h.unverified.newest.slice(0, 3);
  return (
    <p className="small muted">
      Checked <Moment ts={h.at} />: {words || "nothing open"}.
      {h.unverified.total > 0 && (
        <>
          {" "}
          {h.unverified.total} unverified, newest{" "}
          {newest.map((c, i) => (
            <span key={c.path}>
              {i > 0 && ", "}
              <a href={urls.file(c.path)}>{c.path}</a>
            </span>
          ))}
          .
        </>
      )}
    </p>
  );
}

// ---------------------------------------------------------------- import and export

interface Nightly {
  date: string;
  seq: number | null;
  files: number | null;
}

/**
 * An export's name as a person reads it: "Sep 30", or "Sep 30, 2026, 6:02 PM, before a restore"
 * (local time) for the copy a restore saves first.
 */
function exportLabel(folder: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})-pre-restore-(\d{2})(\d{2})(\d{2})\d{3}(-[0-9a-f]{4})?$/.exec(
    folder,
  );
  if (m) return `${localTime(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`)}, before a restore`;
  return /^\d{4}-\d{2}-\d{2}$/.test(folder) ? day(`${folder}T00:00:00Z`, "UTC") : folder;
}

function NightlyLinks({ urls, date }: { urls: Urls; date: string }) {
  return (
    <>
      <a href={urls.nightly(date, "bundle.tar")}>Bundle</a> ·{" "}
      <a href={urls.nightly(date, "ledger.jsonl")}>History</a>
    </>
  );
}

/** Export a bundle, import one as a single change, and the nightly exports (owner only). */
export function Transfer({ urls }: { urls: Urls }) {
  useTitle(`Import & export · ${useLibraryLabel(urls)}`);
  return (
    <OwnerOnly urls={urls}>
      <TransferPage urls={urls} />
    </OwnerOnly>
  );
}

function TransferPage({ urls }: { urls: Urls }) {
  const loaded = useLoad(`transfer ${urls.base}`, async () => {
    const nightly = await api<{ exports: Nightly[] }>(urls.api("exports"));
    return { nightly: nightly.exports };
  });
  const action = useAction();
  const [result, setResult] = useState<ReactNode>(null);
  const upload = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const file = (form.elements.namedItem("bundle") as HTMLInputElement).files?.[0];
    const strip = Number(field(form, "strip")) || 0;
    const note = field(form, "note");
    void action.run(async () => {
      if (!file) throw new Error("Choose a .tar or .tar.gz file to import.");
      setResult(null);
      const res = await api<{ files: number; seq: number; warnings: unknown[] }>(
        urls.api("import", { strip, source: `upload:${file.name}` }),
        {
          method: "POST",
          body: file,
          headers: {
            "Content-Type": "application/x-tar",
            "X-Note": encodeURIComponent(note || `Import ${file.name}`),
          },
        },
      );
      const linted = res.warnings.length;
      setResult(
        <>
          Imported {plural(res.files, "file")} from {file.name} as one change
          {linted > 0 && (
            <>
              ; {plural(linted, "file")} need tidying, listed <a href={urls.work()}>for agents</a>
            </>
          )}
          . <a href={urls.activity({ view: "events" })}>See it in Activity</a>.
        </>,
      );
      form.reset();
      loaded.reload();
    });
  };
  const exportNow = () =>
    action.run(async () => {
      const res = await api<{ export: string | null }>(urls.api("maintain"), { method: "POST" });
      setResult(
        res.export
          ? "Export saved. It is listed under Nightly exports."
          : "Nothing changed since the last export, so none was saved.",
      );
      loaded.reload();
    });
  return (
    <>
      <h1>Import &amp; export</h1>
      {result && <div className="notice ok">{result}</div>}
      {action.error && <div className="notice">{action.error}</div>}
      <div className="panel-box">
        <h2>Export</h2>
        <p>Every page and file as they are now, as one .tar bundle.</p>
        {/* A plain link: the browser downloads the signed export link it redirects to. */}
        <a className="button primary" href={urls.exportTar()}>
          Download .tar
        </a>
      </div>
      <div className="panel-box">
        <h2>Import</h2>
        <p>A .tar or .tar.gz bundle, as one change you can revert.</p>
        <form onSubmit={upload}>
          <p>
            <input
              type="file"
              name="bundle"
              aria-label="Bundle"
              accept=".tar,.tgz,.gz,application/x-tar,application/gzip"
              required
            />
          </p>
          <p>
            <label className="small">
              Leading folders to drop{" "}
              <input type="number" name="strip" min={0} max={10} defaultValue={0} />
            </label>
          </p>
          <p>
            <input type="text" name="note" aria-label="Note" placeholder="Note (optional)" />
          </p>
          <button className="primary" type="submit" disabled={action.busy}>
            Import
          </button>
        </form>
      </div>
      <Status loaded={loaded}>
        {({ nightly }) => (
          <div className="panel-box">
            <h2>Nightly exports</h2>
            {nightly.length === 0 ? (
              <p>None yet.</p>
            ) : (
              <div className="table-wrap">
                <table className="list">
                  <thead className="visually-hidden">
                    <tr>
                      <th>Export</th>
                      <th>Files</th>
                      <th>Downloads</th>
                    </tr>
                  </thead>
                  <tbody>
                    {nightly.map((n) => (
                      <tr key={n.date}>
                        <td>
                          <strong>{exportLabel(n.date)}</strong>
                        </td>
                        <td className="muted small">
                          {n.files !== null ? plural(n.files, "file") : ""}
                        </td>
                        <td>
                          <NightlyLinks urls={urls} date={n.date} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <button type="button" disabled={action.busy} onClick={() => void exportNow()}>
              Export now
            </button>
          </div>
        )}
      </Status>
    </>
  );
}

// ---------------------------------------------------------------- recovery

interface RestoreRow {
  id: string;
  kind: "restore" | "undo";
  to: string;
  requested_at: string;
  actor: string;
  seq_before: number;
  export: string;
  undoes?: string;
}

/** A restore id (20260930T180211042Z) as an ISO time, to the second. */
function restoreTime(id: string): string {
  return id.replace(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})\d{3}Z(-[0-9a-f]{4})?$/,
    "$1-$2-$3T$4:$5:$6Z",
  );
}

/** "you" for the signed-in person, an agent by its name, another person by their handle. */
function useNamer(urls: Urls) {
  const me = useMe();
  const names = useAgentNames(urls);
  return (actor: string, by?: LedgerRequest["by"]) =>
    me && actor === me.actor && !by?.agent ? "you" : names(actor, by);
}

/** Point-in-time restore of the whole library, and undoing one (owner only). */
export function Recovery({ urls }: { urls: Urls }) {
  useTitle(`Recovery · ${useLibraryLabel(urls)}`);
  return (
    <OwnerOnly urls={urls}>
      <RecoveryPage urls={urls} />
    </OwnerOnly>
  );
}

function RecoveryPage({ urls }: { urls: Urls }) {
  const loaded = useLoad(`recovery ${urls.base}`, async () => {
    const [recent, restores] = await Promise.all([
      api<{ requests: LedgerRequest[] }>(urls.api("requests", { limit: 10 })),
      api<{ restores: RestoreRow[] }>(urls.api("restores")),
    ]);
    return { recent: recent.requests, restores: restores.restores };
  });
  const name = useNamer(urls);
  const action = useAction();
  const { confirm, dialog } = useConfirm();
  const [result, setResult] = useState<ReactNode>(null);
  const restore = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const raw = field(e.currentTarget, "to");
    // The field is the person's local time; the server takes an ISO moment.
    const at = new Date(raw);
    if (Number.isNaN(at.getTime())) {
      action.setError("Choose a date and time.");
      return;
    }
    const to = at.toISOString();
    confirm({
      title: "Restore this library?",
      body: (
        <p>
          Every page goes back to how it was on {localTime(to)}. What is there now is saved first,
          and you can undo the restore.
        </p>
      ),
      action: "Restore",
      run: () =>
        action.run(async () => {
          setResult(null);
          const r = await api<RestoreRow>(urls.api("restore"), json({ to }));
          setResult(
            <>
              Restored to {localTime(r.to)}. What was there before is saved under Past restores
              below.
            </>,
          );
          loaded.reload();
        }),
    });
  };
  const undo = (r: RestoreRow) =>
    confirm({
      title: "Undo this restore?",
      body: <p>The library goes back to how it was just before the restore.</p>,
      action: "Undo restore",
      run: () =>
        action.run(async () => {
          setResult(null);
          await api(urls.api("restore"), json({ undo: r.id }));
          setResult("Undone: the library is back to how it was before that restore.");
          loaded.reload();
        }),
    });
  return (
    <>
      <h1>Recovery</h1>
      {dialog}
      {result && <div className="notice ok">{result}</div>}
      {action.error && <div className="notice">{action.error}</div>}
      <Status loaded={loaded}>
        {({ recent, restores }) => (
          <>
            <div className="panel-box">
              <h2>Restore this library to a point in time</h2>
              <p>
                Rewinds the whole library to how it was between 2 minutes and 30 days ago. What is
                there now is saved first, and the restore can be undone. To undo one change instead,
                revert it from <a href={urls.activity({ view: "events" })}>Activity, Every event</a>
                .
              </p>
              <form onSubmit={restore}>
                <p>
                  <label className="small">
                    Time, in your time zone{" "}
                    <input type="datetime-local" name="to" step={1} required />
                  </label>
                </p>
                <button className="primary" type="submit" disabled={action.busy}>
                  Restore…
                </button>
              </form>
              {recent.length > 0 && (
                <>
                  <h2>Latest changes</h2>
                  <ul className="small">
                    {recent.map((r) => (
                      <li key={r.request_id}>
                        <span className="muted" title={localTime(r.ts)}>
                          {localTime(r.ts)}
                        </span>{" "}
                        {name(r.actor, r.by)}
                        {r.note ? `: ${r.note}` : ""}{" "}
                        <span className="muted">({plural(r.events.length, "change")})</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
            <div className="panel-box">
              <h2>Past restores</h2>
              {restores.length === 0 ? (
                <p>None.</p>
              ) : (
                <div className="table-wrap">
                  <table className="list">
                    <thead className="visually-hidden">
                      <tr>
                        <th>Restore</th>
                        <th>What was there before</th>
                        <th>Undo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {restores.map((r) => (
                        <tr key={r.id}>
                          <td>
                            <strong>
                              {r.kind === "undo"
                                ? `Undid the restore made ${localTime(r.undoes ? restoreTime(r.undoes) : r.to)}`
                                : `Restored to ${localTime(r.to)}`}
                            </strong>
                            <div className="small muted">
                              <Moment ts={r.requested_at} />, by {name(r.actor)}
                            </div>
                          </td>
                          <td className="small">
                            Before it:{" "}
                            <NightlyLinks urls={urls} date={r.export.split("/").at(-2) ?? ""} />
                          </td>
                          <td>
                            <button type="button" disabled={action.busy} onClick={() => undo(r)}>
                              Undo…
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </Status>
    </>
  );
}

// ---------------------------------------------------------------- revert and restore

const WHAT_WORDS: Record<Touched["what"], string> = {
  added: "Added",
  edited: "Edited",
  rewrote: "Rewrote",
  moved: "Moved",
  deleted: "Deleted",
  reverted: "Reverted",
};

/** Where a moved page was: its folder by name. */
const folderOf = (path: string) => (dirOf(path) ? folderName(dirOf(path)) : "the top level");

/** Undoing one change (a ledger request), as a new change by the owner (owner only). */
export function Revert({ urls, request }: { urls: Urls; request: string; actor: string }) {
  useTitle(`Revert · ${useLibraryLabel(urls)}`);
  return (
    <>
      <PageBar>
        <nav className="crumbs" aria-label="Path">
          <a href={urls.activity({ view: "events" })}>Activity</a>
          <span aria-hidden="true">/</span>
          <span className="here" aria-current="page">
            Revert
          </span>
        </nav>
      </PageBar>
      <OwnerOnly urls={urls}>
        <RevertPage urls={urls} request={request} />
      </OwnerOnly>
    </>
  );
}

function RevertPage({ urls, request }: { urls: Urls; request: string }) {
  const loaded = useLoad(`revert ${urls.revert(request)}`, () =>
    api<LedgerRequest>(urls.api(`requests/${encodeURIComponent(request)}`)),
  );
  const titles = useTitles(urls);
  const name = useNamer(urls);
  const action = useAction();
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const note = field(e.currentTarget, "note");
    void action.run(async () => {
      const res = await api<{ results: unknown[] }>(
        urls.api("revert"),
        json({ request_id: request, note }),
      );
      navigate(`${urls.ledger()}?done=revert&n=${res.results.length}`);
    });
  };
  return (
    <Status loaded={loaded}>
      {(r) => {
        const touched = touchedBy(r.events, titles.state === "ready" ? titles.data.titles : {});
        return (
          <>
            <h1>Revert this change?</h1>
            <p>
              By {name(r.actor, r.by)}, <Moment ts={r.ts} />
              {r.note ? `: ${r.note}` : ""}
            </p>
            <ul className="events">
              {touched.map((t) => (
                <li key={t.path}>
                  {WHAT_WORDS[t.what]}{" "}
                  <a
                    href={
                      t.what === "deleted"
                        ? urls.pinned(t.seq - 1).file(t.path)
                        : urls.since(t.path, t.seq)
                    }
                  >
                    {t.title}
                  </a>
                  {t.from && <span className="muted"> from {folderOf(t.from)}</span>}
                </li>
              ))}
            </ul>
            <div className="panel-box">
              <p>Undoes every change in it, as a new change by you. Nothing is erased.</p>
              {action.error && <div className="notice">{action.error}</div>}
              <form onSubmit={submit}>
                <label>
                  Note{" "}
                  <input type="text" name="note" defaultValue={`Revert: ${r.note ?? "a change"}`} />
                </label>
                <p className="actions">
                  <button className="primary" type="submit" disabled={action.busy}>
                    Revert
                  </button>
                  <a className="button" href={urls.activity({ view: "events" })}>
                    Cancel
                  </a>
                </p>
              </form>
            </div>
          </>
        );
      }}
    </Status>
  );
}

interface HistoryRow {
  seq: number;
  ts: string;
  op: string;
}

/** Writing back one page's earlier version, as a revert by the owner (owner only). */
export function Restore(props: { urls: Urls; path: string; to?: number; actor: string }) {
  const { urls, path } = props;
  const titleOf = useTitleOf();
  const title = titleOf(path);
  useTitle(`Restore ${title} · ${useLibraryLabel(urls)}`);
  return (
    <>
      <PageBar>
        <Crumbs urls={urls} path={path} file title={title} />
      </PageBar>
      <OwnerOnly urls={urls}>
        <RestorePage urls={urls} path={path} to={props.to} title={title} />
      </OwnerOnly>
    </>
  );
}

function RestorePage(props: { urls: Urls; path: string; to?: number; title: string }) {
  const { urls, path, to, title } = props;
  const loaded = useLoad(`restore ${urls.base} ${path} ${to}`, async () => {
    if (to === undefined) throw new ApiError(400, "bad_param", "No version was chosen.");
    const h = await api<{ events: HistoryRow[] }>(urls.api(`history/${enc(path)}`));
    // The version shown at `to`: the latest content event up to it, numbered from the first.
    const versions = h.events.filter(
      (e) => e.op !== "verify" && e.op !== "comment" && e.op !== "move",
    );
    let i = versions.length - 1;
    while (i >= 0 && (versions[i]?.seq ?? 0) > to) i--;
    const v = versions[i];
    if (!v) throw new ApiError(404, "not_found", "That version is not in this page's history.");
    return { n: i + 1, ts: v.ts };
  });
  const action = useAction();
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const note = field(e.currentTarget, "note");
    void action.run(async () => {
      await api(urls.api("revert"), json({ path, to_seq: to, note }));
      navigate(`${urls.pinned(undefined).file(path)}?done=restore`);
    });
  };
  return (
    <Status loaded={loaded}>
      {(v) => (
        <>
          <h1>
            Restore {title} to version {v.n}?
          </h1>
          <p>
            Version {v.n} is from <Moment ts={v.ts} />.{" "}
            <a href={urls.pinned(to).file(path)}>Read it as it was</a>.
          </p>
          <div className="panel-box">
            <p>Writes that version back as a new change by you. Nothing is erased.</p>
            {action.error && <div className="notice">{action.error}</div>}
            <form onSubmit={submit}>
              <label>
                Note <input type="text" name="note" defaultValue={`Restore version ${v.n}`} />
              </label>
              <p className="actions">
                <button className="primary" type="submit" disabled={action.busy}>
                  Restore
                </button>
                <a className="button" href={urls.pinned(undefined).file(path)}>
                  Cancel
                </a>
              </p>
            </form>
          </div>
        </>
      )}
    </Status>
  );
}

// ---------------------------------------------------------------- connect and delete

/** A library's Connect tab: the steps naming it, and (live) whether an agent has written yet. */
export function ConnectLibrary({ urls }: { urls: Urls }) {
  useTitle(`Connect · ${useLibraryLabel(urls)}`);
  const loaded = useLoad(`connect ${urls.base}`, async () => {
    const [recent, stats] = await Promise.all([
      api<{ requests: LedgerRequest[] }>(urls.api("requests", { limit: 50 })),
      api<{ seq: number }>(urls.api("stats")),
    ]);
    // The newest change by an agent, not a person (the rule the home uses too): "waiting for
    // your agent" (v2 spec: Onboarding).
    return { latest: recent.requests.find((r) => !byPerson(r)) ?? null, head: stats.seq };
  });
  useLive(urls, loaded.state === "ready" ? loaded.data.head : null, loaded.reload);
  const role = useRole(urls);
  const names = useAgentNames(urls);
  return (
    <>
      <h1>Connect an agent</h1>
      {role && role !== "owner" && (
        <p>
          This library is @{urls.owner}'s, shared with you to{" "}
          {role === "write" ? "read and write" : "read and comment"}. Your agents reach it at most
          with the same access; pick it by name when you connect.
        </p>
      )}
      <ConnectSteps slug={urls.slug} library={`${urls.owner}/${urls.slug}`} />
      <h2>Status</h2>
      <Status loaded={loaded}>
        {({ latest }) => (
          <p id="status">
            {latest ? (
              <>
                Last agent write: {names(latest.actor, latest.by)}, <Moment ts={latest.ts} />
                {latest.note ? `, “${latest.note}”` : ""}.{" "}
                <a href={urls.activity()}>See Activity</a>
              </>
            ) : (
              "No agent has written yet. This updates when one does."
            )}
          </p>
        )}
      </Status>
    </>
  );
}

/**
 * General (take 4's first settings tab; TEMPRA-102): the library's title and description, which
 * the owner edits under the limits create_library enforces; a write member reads them. A read
 * member's settings are Members alone, so General sends them there.
 */
export function General({ urls }: { urls: Urls }) {
  useTitle(`General · ${useLibraryLabel(urls)}`);
  const libs = useLibraries();
  const role = useRole(urls);
  const action = useAction();
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (role === "read") navigate(urls.members(), { replace: true });
  }, [role, urls]);
  const lib =
    libs.state === "ready"
      ? libs.data.libraries.find((l) => l.owner === urls.owner && l.slug === urls.slug)
      : undefined;
  const save = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const title = field(form, "title").trim();
    const description = field(form, "description").trim();
    void action.run(async () => {
      await api(urls.apiRoot(), {
        method: "PATCH",
        body: JSON.stringify({ title: title || null, description: description || null }),
      });
      setNotice("Saved.");
      librariesChanged();
    });
  };
  if (role === null || role === "read") return <p className="muted">Loading…</p>;
  return (
    <>
      <h1>General</h1>
      {notice && <div className="notice ok">{notice}</div>}
      {action.error && <div className="notice">{action.error}</div>}
      {role === "owner" ? (
        <form className="stack" onSubmit={save} key={`${lib?.title}|${lib?.description}`}>
          <p className="field">
            <label htmlFor="library-title">Title</label>
            <input
              id="library-title"
              name="title"
              type="text"
              maxLength={120}
              defaultValue={lib?.title ?? ""}
              placeholder={urls.slug}
            />
          </p>
          <p className="field">
            <label htmlFor="library-description">Description</label>
            <input
              id="library-description"
              name="description"
              type="text"
              maxLength={300}
              defaultValue={lib?.description ?? ""}
              placeholder="What this library is for, in one line"
            />
          </p>
          <p className="small muted">
            The library's address stays {urls.owner}/{urls.slug}.
          </p>
          <p>
            <button type="submit" className="primary" disabled={action.busy}>
              Save
            </button>
          </p>
        </form>
      ) : (
        <dl className="facts">
          <dt>Title</dt>
          <dd>{lib?.title ?? <span className="muted">{urls.slug}</span>}</dd>
          <dt>Description</dt>
          <dd>{lib?.description ?? <span className="muted">None</span>}</dd>
          <dt>Address</dt>
          <dd>
            {urls.owner}/{urls.slug}
          </dd>
        </dl>
      )}
    </>
  );
}

/** Deleting the library, typing its name (v2 spec: Accounts; owner only). */
export function DeleteLibrary({ urls }: { urls: Urls }) {
  const label = useLibraryLabel(urls);
  useTitle(`Delete · ${label}`);
  const action = useAction();
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const confirm = field(e.currentTarget, "confirm");
    void action.run(async () => {
      if (confirm !== urls.slug) throw new Error(`Type ${urls.slug} to confirm.`);
      await api(urls.api("delete"), json({ confirm }));
      // A full load: the library list, or first run if it was the last one.
      location.assign("/");
    });
  };
  return (
    <OwnerOnly urls={urls}>
      <h1>Delete {label}</h1>
      {action.error && <div className="notice">{action.error}</div>}
      <p>
        Deletes every page, attachment, export and token of this library.{" "}
        <a href={urls.exportTar()}>Export it first</a>.
      </p>
      <form onSubmit={submit}>
        <p>
          <label>
            Type {urls.slug} to confirm{" "}
            <input type="text" name="confirm" autoComplete="off" required />
          </label>
        </p>
        <p>
          <button type="submit" disabled={action.busy}>
            Delete library
          </button>
        </p>
      </form>
    </OwnerOnly>
  );
}

// ---------------------------------------------------------------- members

interface MembersData {
  owner: string;
  role: Role;
  members: { handle: string; role: "read" | "write"; created: string }[];
  /** The owner's view only. */
  invitations?: { id: string; handle: string; role: "read" | "write"; expires: string }[];
}

const ROLE_WORDS = { read: "Read and comment", write: "Read and write" } as const;

/**
 * Who is in the library (tempra-dev: v2/sharing): the owner, members with their access, and the
 * agents that have worked here, each for its person. The owner invites, changes access and
 * removes; a member may leave. Each of those asks first (S-4).
 */
export function Members({ urls, me }: { urls: Urls; me: string | null }) {
  useTitle(`Members · ${useLibraryLabel(urls)}`);
  const loaded = useLoad(`members ${urls.base}`, async () => {
    const [m, a] = await Promise.all([
      api<MembersData>(urls.api("members")),
      api<{ contributors: Contributor[] }>(urls.api("agents")),
    ]);
    return { ...m, contributors: a.contributors };
  });
  const action = useAction();
  const { confirm, dialog } = useConfirm();
  const [notice, setNotice] = useState<string | null>(null);
  const done = (text: string) => {
    setNotice(text);
    loaded.reload();
  };
  const invite = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const to = field(form, "to");
    const role = field(form, "role");
    void action.run(async () => {
      const r = await api<{ sent: string; handle?: string }>(
        urls.api("invitations"),
        json({ to, role }),
      );
      form.reset();
      done(
        r.sent === "invited"
          ? `Invited @${r.handle}. They accept it from their Inbox.`
          : "If that address has a Tempra account, they will get the invitation.",
      );
    });
  };
  const member = (handle: string) => urls.api(`members/${encodeURIComponent(handle)}`);
  const setRole = (handle: string, role: "read" | "write") =>
    confirm({
      title: `Change @${handle}'s access?`,
      body: (
        <p>
          @{handle} and their agents will {role === "write" ? "read and write" : "read and comment"}{" "}
          here, from their next request.
        </p>
      ),
      action: "Change access",
      run: () =>
        action.run(async () => {
          await api(member(handle), { method: "PUT", body: JSON.stringify({ role }) });
          done(`@${handle} now has ${role} access.`);
        }),
    });
  const remove = (handle: string) =>
    confirm({
      title: `Remove @${handle}?`,
      body: <p>@{handle} and their agents lose access to this library at once.</p>,
      action: "Remove",
      run: () =>
        action.run(async () => {
          await api(member(handle), { method: "DELETE" });
          done(`Removed @${handle}.`);
        }),
    });
  const leave = (handle: string) =>
    confirm({
      title: "Leave this library?",
      body: <p>You and your agents lose access at once. Only @{urls.owner} can invite you back.</p>,
      action: "Leave",
      run: () =>
        action.run(async () => {
          await api(member(handle), { method: "DELETE" });
          location.assign("/");
        }),
    });
  const withdraw = (id: string, handle: string) =>
    confirm({
      title: "Withdraw the invitation?",
      body: <p>@{handle} can no longer accept it.</p>,
      action: "Withdraw",
      run: () =>
        action.run(async () => {
          await api(urls.api(`invitations/${encodeURIComponent(id)}`), { method: "DELETE" });
          done("Invitation withdrawn.");
        }),
    });
  return (
    <>
      <h1>Members</h1>
      {dialog}
      {notice && <div className="notice ok">{notice}</div>}
      {action.error && <div className="notice">{action.error}</div>}
      <Status loaded={loaded}>
        {(d) => {
          const owner = d.role === "owner";
          return (
            <>
              <div className="table-wrap">
                <table className="list">
                  <thead>
                    <tr>
                      <th>Person</th>
                      <th>Access</th>
                      <th>
                        <span className="visually-hidden">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="name">@{d.owner}</td>
                      <td>Owner</td>
                      <td />
                    </tr>
                    {d.members.map((m) => (
                      <tr key={m.handle}>
                        <td className="name">@{m.handle}</td>
                        <td>
                          {owner ? (
                            <select
                              aria-label={`Access for @${m.handle}`}
                              value={m.role}
                              disabled={action.busy}
                              onChange={(e) =>
                                setRole(m.handle, e.currentTarget.value as "read" | "write")
                              }
                            >
                              <option value="read">{ROLE_WORDS.read}</option>
                              <option value="write">{ROLE_WORDS.write}</option>
                            </select>
                          ) : (
                            ROLE_WORDS[m.role]
                          )}
                        </td>
                        <td>
                          {owner ? (
                            <button
                              type="button"
                              disabled={action.busy}
                              onClick={() => remove(m.handle)}
                            >
                              Remove…
                            </button>
                          ) : (
                            m.handle === me && (
                              <button
                                type="button"
                                disabled={action.busy}
                                onClick={() => leave(m.handle)}
                              >
                                Leave…
                              </button>
                            )
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {owner && (
                <>
                  <h2>Invite</h2>
                  <form className="token" onSubmit={invite}>
                    <p>
                      <label>
                        Handle or email{" "}
                        <input
                          type="text"
                          name="to"
                          required
                          autoComplete="off"
                          placeholder="@ann"
                        />
                      </label>{" "}
                      <label>
                        Access{" "}
                        <select name="role" defaultValue="read">
                          <option value="read">{ROLE_WORDS.read}</option>
                          <option value="write">{ROLE_WORDS.write}</option>
                        </select>
                      </label>{" "}
                      <button className="primary" type="submit" disabled={action.busy}>
                        Invite
                      </button>
                    </p>
                    <p className="small muted">
                      Only people with a Tempra account. Their agents reach this library at most at
                      their access.
                    </p>
                  </form>
                  {(d.invitations ?? []).length > 0 && (
                    <>
                      <h2>Waiting</h2>
                      <ul>
                        {(d.invitations ?? []).map((i) => (
                          <li key={i.id}>
                            @{i.handle}, {ROLE_WORDS[i.role].toLowerCase()}, open until{" "}
                            {day(i.expires)}{" "}
                            <button
                              type="button"
                              disabled={action.busy}
                              onClick={() => withdraw(i.id, i.handle)}
                            >
                              Withdraw…
                            </button>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </>
              )}

              <h2>Who has worked here</h2>
              {d.contributors.length === 0 ? (
                <p className="muted">Nobody yet.</p>
              ) : (
                <ul>
                  {d.contributors.map((c) => (
                    <li key={`${c.person}|${c.agent?.id ?? ""}`}>
                      <a href={urls.activity({ view: "events", actor: c.actor })}>
                        {agentLabel(c)}
                      </a>{" "}
                      <span className="small muted">
                        {plural(c.requests, "change")}, last <Moment ts={c.last_ts} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          );
        }}
      </Status>
    </>
  );
}
