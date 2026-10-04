import type { FormEvent } from "react";
import { api, useLoad } from "../api";
import { type Done, navigate } from "../router";
import { LibNav, plural, Status, useTitle, when } from "../ui";
import type { LedgerFilters, Urls } from "../urls";
import { CONTENT_OPS } from "./File";

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

export function Ledger(props: { urls: Urls; filters: LedgerFilters; done: Done; actor: string }) {
  const { urls, filters: f } = props;
  useTitle(`Ledger · ${urls.slug}`);
  const loaded = useLoad(`ledger ${urls.ledger(f)}`, () =>
    api<{ requests: LedgerRequest[]; next: number | null }>(
      urls.api("requests", { ...f, limit: 30 }),
    ),
  );
  const filter = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const s = (k: string) => String(form.get(k) ?? "").trim() || undefined;
    navigate(urls.ledger({ prefix: s("prefix"), actor: s("actor"), from: s("from"), to: s("to") }));
  };
  return (
    <>
      <LibNav urls={urls} active="ledger" />
      <h1>Ledger</h1>
      {props.done?.kind === "revert" && (
        <div className="notice ok">
          Reverted: {plural(props.done.n ?? 0, "change")}, recorded as a new request by{" "}
          {props.actor}.
        </div>
      )}
      <form className="filters" onSubmit={filter} key={urls.ledger(f)}>
        <label>
          Directory <input type="text" name="prefix" defaultValue={f.prefix} placeholder="all" />
        </label>{" "}
        <label>
          Actor <input type="text" name="actor" defaultValue={f.actor} placeholder="anyone" />
        </label>{" "}
        <label>
          From <input type="date" name="from" defaultValue={f.from} />
        </label>{" "}
        <label>
          To <input type="date" name="to" defaultValue={f.to} />
        </label>{" "}
        <button type="submit">Filter</button>{" "}
        <a className="small" href={urls.ledger()}>
          Clear
        </a>
      </form>
      <Status loaded={loaded}>
        {({ requests, next }) => (
          <>
            {requests.length === 0 ? (
              <p className="muted">No requests match.</p>
            ) : (
              <ol className="ledger">
                {requests.map((r) => (
                  <Request key={r.request_id} urls={urls} filters={f} request={r} />
                ))}
              </ol>
            )}
            {next !== null && (
              <p>
                <a href={urls.ledger({ ...f, before: next })}>Older requests →</a>
              </p>
            )}
          </>
        )}
      </Status>
    </>
  );
}

function Request({
  urls,
  filters,
  request: r,
}: {
  urls: Urls;
  filters: LedgerFilters;
  request: LedgerRequest;
}) {
  const shown = r.events.slice(0, 12);
  const more = r.events.length - shown.length;
  const revertible = r.events.some((e) => e.op !== "verify");
  const first = r.events[0]?.seq;
  const last = r.events.at(-1)?.seq;
  return (
    <li className="request">
      <div className="req-head">
        <span className="muted small">{when(r.ts)}</span>{" "}
        <a href={urls.ledger({ ...filters, actor: r.actor, before: undefined })}>{r.actor}</a>{" "}
        <span className="muted small">
          seq {first}
          {r.events.length > 1 ? `–${last}` : ""}
        </span>{" "}
        {revertible && (
          <a className="small revert" href={urls.revert(r.request_id)}>
            Revert…
          </a>
        )}
      </div>
      {r.note && <div className="note">{r.note}</div>}
      <ul className="events">
        {shown.map((e) => (
          <EventLine key={e.seq} urls={urls} event={e} />
        ))}
      </ul>
      {more > 0 && <p className="small muted">… and {more} more</p>}
    </li>
  );
}

function EventLine({ urls, event: e }: { urls: Urls; event: LedgerEvent }) {
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
          {" "}
          ·{" "}
          <a className="small" href={urls.diff(e.path, undefined, e.seq)}>
            diff
          </a>
        </>
      )}
    </li>
  );
}
