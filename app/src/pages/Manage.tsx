import { type FormEvent, useState } from "react";
import { ApiError, api, field, useAction, useLoad } from "../api";
import { useFeed, useTrailing } from "../live";
import { navigate } from "../router";
import { Chip, Crumbs, plural, Status, useTitle, when } from "../ui";
import { baseName, type Urls } from "../urls";
import { ConnectSteps } from "./Account";
import { DiffLines } from "./Diff";
import { CONTENT_OPS } from "./File";

/**
 * A library's management pages (TEMPRA-14): work queue, import and export, recovery, revert
 * and restore, connecting an agent, deleting it. Each acts through the REST API as the
 * signed-in person.
 */

interface LedgerEvent {
  seq: number;
  op: string;
  path: string;
  meta: { from_path?: unknown } | null;
}

interface LedgerRequest {
  request_id: string;
  ts: string;
  actor: string;
  note: string | null;
  events: LedgerEvent[];
}

const json = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });

/** Reloads a page (debounced) whenever the library changes, and once it loaded, after its head. */
function useLive(urls: Urls, head: number | null, reload: () => void) {
  const soon = useTrailing(reload);
  useFeed(urls, head, () => soon(), soon);
}

// ---------------------------------------------------------------- work queue

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
  [undefined, "All"],
  ["comment", "Comments"],
  ["stale", "Stale"],
  ["broken_link", "Broken links"],
  ["lint", "Lint"],
];

/** What needs doing: open comments, stale concepts, broken links, lint (as `work` shows agents). */
export function Work({ urls, kind }: { urls: Urls; kind?: string }) {
  useTitle(`Work queue · ${urls.slug}`);
  const loaded = useLoad(`work ${urls.work(kind)}`, async () => {
    const [w, stats] = await Promise.all([
      api<{ items: WorkItem[]; total: number }>(urls.api("work", { kind, limit: 200 })),
      api<{ seq: number }>(urls.api("stats")),
    ]);
    return { ...w, head: stats.seq };
  });
  useLive(urls, loaded.state === "ready" ? loaded.data.head : null, loaded.reload);
  return (
    <>
      <h1>Work queue</h1>
      <p className="small">
        {KINDS.map(([k, label], i) => (
          <span key={label}>
            {i > 0 && " · "}
            {k === kind ? <strong>{label}</strong> : <a href={urls.work(k)}>{label}</a>}
          </span>
        ))}
      </p>
      <Status loaded={loaded}>
        {({ items, total }) =>
          items.length === 0 ? (
            <p>
              <Chip text="nothing to do" tone="ok" />
            </p>
          ) : (
            <>
              <div className="table-wrap">
                <table className="list">
                  <tbody>
                    {items.map((i) => (
                      <tr key={i.thread ?? `${i.kind} ${i.path} ${i.detail}`}>
                        <td>
                          <Chip
                            text={i.kind.replace("_", " ")}
                            tone={i.kind === "comment" ? "" : i.kind === "lint" ? "warn" : "bad"}
                          />
                        </td>
                        <td className="name">
                          {/* A comment opens on its thread; its suggested action is for agents. */}
                          <a href={i.thread ? `${urls.file(i.path)}#comments` : urls.file(i.path)}>
                            {i.path}
                          </a>
                          <div className="small muted">{i.detail}</div>
                          {!i.thread && <div className="small">→ {i.suggested_action}</div>}
                        </td>
                        <td className="muted small">{i.inbound_links} inbound</td>
                        <td className="muted small">{when(i.since)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {total > items.length && (
                <p className="small muted">{total - items.length} more not shown.</p>
              )}
            </>
          )
        }
      </Status>
    </>
  );
}

// ---------------------------------------------------------------- import and export

interface Nightly {
  date: string;
  seq: number | null;
  files: number | null;
}

/** "2026-09-30", or "2026-09-30 18:02:11 UTC, before a restore" for a pre-restore export. */
function exportLabel(folder: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})-pre-restore-(\d{2})(\d{2})(\d{2})\d{3}(-[0-9a-f]{4})?$/.exec(
    folder,
  );
  return m ? `${m[1]} ${m[2]}:${m[3]}:${m[4]} UTC, before a restore` : folder;
}

function NightlyLinks({ urls, date }: { urls: Urls; date: string }) {
  return (
    <>
      <a href={urls.nightly(date, "bundle.tar")}>bundle.tar</a> ·{" "}
      <a href={urls.nightly(date, "ledger.jsonl")}>ledger.jsonl</a>
    </>
  );
}

/** Export a bundle, import one as a single request, and the nightly exports. */
export function Transfer({ urls }: { urls: Urls }) {
  useTitle(`Import & export · ${urls.slug}`);
  const loaded = useLoad(`transfer ${urls.base}`, async () => {
    const [stats, nightly] = await Promise.all([
      api<{ seq: number }>(urls.api("stats")),
      api<{ exports: Nightly[] }>(urls.api("exports")),
    ]);
    return { head: stats.seq, nightly: nightly.exports };
  });
  const action = useAction();
  const [result, setResult] = useState<React.ReactNode>(null);
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
          Imported {plural(res.files, "file")} from {file.name} as one request (up to seq {res.seq})
          {linted > 0 && (
            <>
              ; {plural(linted, "file")} with lint, see the <a href={urls.work()}>work queue</a>
            </>
          )}
          . <a href={urls.ledger()}>See it in the ledger</a>.
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
        res.export ? (
          <>
            Exported to R2 at <code>{res.export}</code>.
          </>
        ) : (
          "Nothing changed since the last export, so none was written."
        ),
      );
      loaded.reload();
    });
  return (
    <>
      <h1>Import &amp; export</h1>
      {result && <div className="notice ok">{result}</div>}
      {action.error && <div className="notice">{action.error}</div>}
      <Status loaded={loaded}>
        {({ head, nightly }) => (
          <>
            <div className="panel-box">
              <h2>Export</h2>
              {/* A plain form: the browser downloads the signed export link it redirects to. */}
              <form className="inline" method="get" action={urls.exportTar()}>
                <label className="small" htmlFor="at">
                  As of sequence
                </label>{" "}
                <input
                  id="at"
                  name="at"
                  type="number"
                  min={0}
                  max={head}
                  placeholder={`${head} (now)`}
                />{" "}
                <button className="primary" type="submit">
                  Download .tar
                </button>
              </form>
            </div>
            <div className="panel-box">
              <h2>Import</h2>
              <p>A .tar or .tar.gz, as one revertible request.</p>
              <form onSubmit={upload}>
                <p>
                  <input
                    type="file"
                    name="bundle"
                    accept=".tar,.tgz,.gz,application/x-tar,application/gzip"
                    required
                  />
                </p>
                <p>
                  <label className="small">
                    Leading directories to drop{" "}
                    <input type="number" name="strip" min={0} max={10} defaultValue={0} />
                  </label>
                </p>
                <p>
                  <input type="text" name="note" placeholder="Note (optional)" />
                </p>
                <button className="primary" type="submit" disabled={action.busy}>
                  Import
                </button>
              </form>
            </div>
            <div className="panel-box">
              <h2>Nightly exports</h2>
              {nightly.length === 0 ? (
                <p>None yet.</p>
              ) : (
                <div className="table-wrap">
                  <table className="list">
                    <tbody>
                      {nightly.map((n) => (
                        <tr key={n.date}>
                          <td>
                            <strong>{exportLabel(n.date)}</strong>
                          </td>
                          <td className="muted small">
                            {n.seq !== null ? `seq ${n.seq}` : ""}
                            {n.files !== null ? ` · ${n.files} files` : ""}
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
          </>
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

/** A datetime-local value (no offset, maybe no seconds) as UTC, which the field is. */
function utc(raw: string): string {
  if (!raw || /(Z|[+-]\d{2}:\d{2})$/.test(raw)) return raw;
  return `${raw}${/T\d{2}:\d{2}$/.test(raw) ? ":00" : ""}Z`;
}

/** Point-in-time restore of the whole library, and undoing one (spec: Backups and recovery). */
export function Recovery({ urls }: { urls: Urls }) {
  useTitle(`Recovery · ${urls.slug}`);
  const loaded = useLoad(`recovery ${urls.base}`, async () => {
    const [recent, restores] = await Promise.all([
      api<{ requests: LedgerRequest[] }>(urls.api("requests", { limit: 10 })),
      api<{ restores: RestoreRow[] }>(urls.api("restores")),
    ]);
    return { recent: recent.requests, restores: restores.restores };
  });
  const action = useAction();
  const [result, setResult] = useState<React.ReactNode>(null);
  const confirmed = (form: HTMLFormElement) => {
    if (field(form, "confirm") !== urls.slug) {
      throw new Error(`Type the library's name, ${urls.slug}, to confirm.`);
    }
  };
  const restore = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    void action.run(async () => {
      confirmed(form);
      setResult(null);
      const r = await api<RestoreRow>(urls.api("restore"), json({ to: utc(field(form, "to")) }));
      setResult(
        <>
          Restored {urls.slug} to {r.to}. What was there before is exported to R2 at{" "}
          <code>{r.export}</code>.
        </>,
      );
      loaded.reload();
    });
  };
  const undo = (e: FormEvent<HTMLFormElement>, id: string) => {
    e.preventDefault();
    const form = e.currentTarget;
    void action.run(async () => {
      confirmed(form);
      setResult(null);
      await api(urls.api("restore"), json({ undo: id }));
      setResult(<>Undone: {urls.slug} is back to how it was before that restore.</>);
      loaded.reload();
    });
  };
  const confirm = (
    <label className="small">
      Type <code>{urls.slug}</code> to confirm{" "}
      <input type="text" name="confirm" autoComplete="off" required />
    </label>
  );
  return (
    <>
      <h1>Recovery</h1>
      {result && <div className="notice ok">{result}</div>}
      {action.error && <div className="notice">{action.error}</div>}
      <Status loaded={loaded}>
        {({ recent, restores }) => (
          <>
            <div className="panel-box">
              <h2>Restore this library to a point in time</h2>
              <p>
                Rewinds the whole library, ledger included, to a time 2 minutes to 30 days ago. The
                current state is exported first, and the restore can be undone. To undo one change,
                revert it in the <a href={urls.ledger()}>ledger</a>.
              </p>
              <form onSubmit={restore}>
                <p>
                  <label className="small">
                    Time (UTC) <input type="datetime-local" name="to" step={1} required />
                  </label>
                </p>
                <p>{confirm}</p>
                <button className="primary" type="submit" disabled={action.busy}>
                  Restore
                </button>
              </form>
              {recent.length > 0 && (
                <>
                  <h2>Recent requests</h2>
                  <ul className="small">
                    {recent.map((r) => (
                      <li key={r.request_id}>
                        <span className="muted">{when(r.ts)}</span> {r.actor}
                        {r.note ? ` · ${r.note}` : ""}{" "}
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
                    <tbody>
                      {restores.map((r) => (
                        <tr key={r.id}>
                          <td>
                            <strong>
                              {r.kind === "undo"
                                ? `Undid the restore made ${when(r.undoes ? restoreTime(r.undoes) : r.to)} UTC`
                                : `Restored to ${when(r.to)} UTC`}
                            </strong>
                            <div className="small muted">
                              {when(r.requested_at)} UTC by {r.actor} · ledger was at seq{" "}
                              {r.seq_before}
                            </div>
                          </td>
                          <td className="small">
                            <NightlyLinks urls={urls} date={r.export.split("/").at(-2) ?? ""} />
                          </td>
                          <td>
                            <form className="inline" onSubmit={(e) => undo(e, r.id)}>
                              {confirm}{" "}
                              <button type="submit" disabled={action.busy}>
                                Undo
                              </button>
                            </form>
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

function EventLine({ urls, e }: { urls: Urls; e: LedgerEvent }) {
  // A deleted file is shown as it was just before.
  const view = urls.pinned(e.op === "delete" ? e.seq - 1 : e.seq).file(e.path);
  return (
    <li>
      <span className={`op op-${e.op}`}>{e.op}</span> <a href={view}>{e.path}</a>
      {typeof e.meta?.from_path === "string" && (
        <span className="muted"> from {e.meta.from_path}</span>
      )}
      {CONTENT_OPS.has(e.op) && (
        <>
          {" · "}
          <a className="small" href={urls.diff(e.path, undefined, e.seq)}>
            diff
          </a>
        </>
      )}
    </li>
  );
}

/** Undoing one request of the ledger, as a new request by the person (spec: The ledger). */
export function Revert({ urls, request, actor }: { urls: Urls; request: string; actor: string }) {
  useTitle(`Revert · ${urls.slug}`);
  const loaded = useLoad(`revert ${urls.revert(request)}`, async () => {
    const r = await api<LedgerRequest>(urls.api(`requests/${encodeURIComponent(request)}`));
    const content = r.events.filter((e) => e.op !== "verify" && e.op !== "move").slice(0, 20);
    const diffs = await Promise.all(
      content.map(async (e) => ({
        path: e.path,
        diff: (await api<{ diff: string }>(urls.api("diff", { path: e.path, to: e.seq }))).diff,
      })),
    );
    return { r, diffs };
  });
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
      {({ r, diffs }) => (
        <>
          <h1>Revert this request?</h1>
          <p>
            {when(r.ts)} by <strong>{r.actor}</strong>
            {r.note ? `: ${r.note}` : ""}
          </p>
          <ul className="events">
            {r.events.map((e) => (
              <EventLine key={e.seq} urls={urls} e={e} />
            ))}
          </ul>
          <div className="panel-box">
            <p>Undoes every change in this request, as a new request by {actor}.</p>
            {action.error && <div className="notice">{action.error}</div>}
            <form onSubmit={submit}>
              <label>
                Note{" "}
                <input type="text" name="note" defaultValue={`Revert: ${r.note ?? r.request_id}`} />
              </label>
              <p>
                <button className="primary" type="submit" disabled={action.busy}>
                  Revert
                </button>{" "}
                <a href={urls.ledger()}>Cancel</a>
              </p>
            </form>
          </div>
          <p className="small muted">What this request changed:</p>
          {diffs.map((d) => (
            <div key={d.path}>
              <h2>{d.path}</h2>
              <DiffLines diff={d.diff} />
            </div>
          ))}
        </>
      )}
    </Status>
  );
}

/** Writing back one file's version from an earlier sequence, as a revert. */
export function Restore(props: { urls: Urls; path: string; to?: number; actor: string }) {
  const { urls, path, to } = props;
  useTitle(`Restore ${path} · ${urls.slug}`);
  const loaded = useLoad(`restore ${urls.base} ${path} ${to}`, async () => {
    if (to === undefined) throw new ApiError(400, "bad_param", "`to` is required.");
    const stats = await api<{ seq: number }>(urls.api("stats"));
    return api<{ path: string; diff: string }>(urls.api("diff", { path, from: stats.seq, to }));
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
      {(d) => (
        <>
          <Crumbs urls={urls} path={d.path} file />
          <h1>
            Restore {baseName(d.path)} as of seq {to}?
          </h1>
          <div className="panel-box">
            <p>
              Writes back the version from seq {to}, as a revert by {props.actor}.
            </p>
            {action.error && <div className="notice">{action.error}</div>}
            <form onSubmit={submit}>
              <label>
                Note{" "}
                <input type="text" name="note" defaultValue={`Restore ${d.path} to seq ${to}`} />
              </label>
              <p>
                <button className="primary" type="submit" disabled={action.busy}>
                  Restore
                </button>{" "}
                <a href={urls.pinned(to).file(d.path)}>Cancel</a>
              </p>
            </form>
          </div>
          <p className="small muted">Current version → version at seq {to}:</p>
          <DiffLines diff={d.diff} />
        </>
      )}
    </Status>
  );
}

// ---------------------------------------------------------------- connect and delete

/** A library's Connect tab: the steps naming it, and (live) whether an agent has written yet. */
export function ConnectLibrary({ urls }: { urls: Urls }) {
  useTitle(`Connect · ${urls.slug}`);
  const loaded = useLoad(`connect ${urls.base}`, async () => {
    const [recent, stats] = await Promise.all([
      api<{ requests: LedgerRequest[] }>(urls.api("requests", { limit: 50 })),
      api<{ seq: number }>(urls.api("stats")),
    ]);
    // The newest change by an agent, not a person: "waiting for your agent" (v2 spec: Onboarding).
    return {
      latest: recent.requests.find((r) => !r.actor.startsWith("human:")) ?? null,
      head: stats.seq,
    };
  });
  useLive(urls, loaded.state === "ready" ? loaded.data.head : null, loaded.reload);
  return (
    <>
      <h1>Connect an agent</h1>
      <p>
        Connections belong to your account. <a href="/connect">Connect an agent</a> covers every
        library.
      </p>
      <ConnectSteps slug={urls.slug} />
      <h2>Status</h2>
      <Status loaded={loaded}>
        {({ latest }) => (
          <p id="status">
            {latest ? (
              <>
                Last agent write: {latest.actor}, {when(latest.ts)} UTC
                {latest.note ? `, "${latest.note}"` : ""}. <a href={urls.ledger()}>Ledger</a>
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

/** Deleting the library, typing its name (v2 spec: Accounts). */
export function DeleteLibrary({ urls }: { urls: Urls }) {
  useTitle(`Delete · ${urls.slug}`);
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
    <>
      <h1>Delete {urls.slug}</h1>
      {action.error && <div className="notice">{action.error}</div>}
      <p>
        Deletes every concept, attachment, export and token of this library.{" "}
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
    </>
  );
}
