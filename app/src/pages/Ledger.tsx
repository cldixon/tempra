import type { FormEvent } from "react";
import { useEffect } from "react";
import { api, useLoad } from "../api";
import { markSeen, useFeed, useLastSeen, useTrailing } from "../live";
import { type Done, navigate } from "../router";
import { Chip, plural, Status, useTitle, when } from "../ui";
import type { LedgerFilters, Urls } from "../urls";
import { CONTENT_OPS } from "./File";
import { agentLabel, type Contributor } from "./Manage";

interface LedgerEvent {
  seq: number;
  op: string;
  path: string;
  meta: { from_path?: unknown; comment?: unknown } | null;
}

interface LedgerRequest {
  request_id: string;
  ts: string;
  actor: string;
  note: string | null;
  /** The person and agent behind the actor (TEMPRA-75), by id. */
  by?: { person: string; agent?: string } | null;
  events: LedgerEvent[];
}

export function Ledger(props: { urls: Urls; filters: LedgerFilters; done: Done; actor: string }) {
  const { urls, filters: f } = props;
  useTitle(`Ledger · ${urls.slug}`);
  const loaded = useLoad(`ledger ${urls.ledger(f)}`, async () => {
    const [page, stats, agents] = await Promise.all([
      api<{ requests: LedgerRequest[]; next: number | null }>(
        urls.api("requests", { ...f, limit: 30 }),
      ),
      api<{ seq: number }>(urls.api("stats")),
      api<{ contributors: Contributor[] }>(urls.api("agents")),
    ]);
    // Agents named for whom they work: "Claude for @ann" (tempra-dev: agents act for a person).
    const names: Record<string, string> = {};
    for (const c of agents.contributors) if (c.agent) names[c.agent.id] = agentLabel(c);
    return { ...page, head: stats.seq, names };
  });
  // Live tail (tempra-dev: app/live): on the newest page, a new request that the filters may
  // match reloads the list; the server applies the filters.
  const reload = useTrailing(loaded.reload);
  const tailing = f.before === undefined;
  useFeed(
    urls,
    tailing && loaded.state === "ready" ? loaded.data.head : null,
    (events) => {
      if (!tailing) return;
      const under = (p: string | null) =>
        p !== null &&
        (!f.prefix || p === f.prefix || p.startsWith(`${f.prefix.replace(/\/$/, "")}/`));
      const hit = events.some(
        (e) => (!f.actor || e.actor === f.actor) && (under(e.path) || under(e.from_path)),
      );
      if (hit) reload();
    },
    reload,
  );
  const seen = useLastSeen(urls);
  const newest =
    loaded.state === "ready" ? (loaded.data.requests[0]?.events.at(-1)?.seq ?? null) : null;
  useEffect(() => {
    if (newest !== null && f.before === undefined) markSeen(urls, newest);
  }, [newest, urls, f.before]);
  const filter = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const s = (k: string) => String(form.get(k) ?? "").trim() || undefined;
    navigate(urls.ledger({ prefix: s("prefix"), actor: s("actor"), from: s("from"), to: s("to") }));
  };
  return (
    <>
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
        {({ requests, next, names }) => (
          <>
            {requests.length === 0 ? (
              <p className="muted">No requests match.</p>
            ) : (
              <ol className="ledger">
                {requests.map((r) => (
                  <Request
                    key={r.request_id}
                    urls={urls}
                    filters={f}
                    request={r}
                    isNew={seen !== null && (r.events[0]?.seq ?? 0) > seen}
                    agent={r.by?.agent ? names[r.by.agent] : undefined}
                  />
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
  isNew,
  agent,
}: {
  urls: Urls;
  filters: LedgerFilters;
  request: LedgerRequest;
  /** Made after the person last looked at this library. */
  isNew: boolean;
  /** Who the agent works for, when an agent made the request. */
  agent?: string;
}) {
  const shown = r.events.slice(0, 12);
  const more = r.events.length - shown.length;
  // Verifications and comments are not content; there is nothing of theirs to revert.
  const revertible = r.events.some((e) => e.op !== "verify" && e.op !== "comment");
  const first = r.events[0]?.seq;
  const last = r.events.at(-1)?.seq;
  return (
    <li className="request">
      <div className="req-head">
        {isNew && (
          <>
            <Chip text="new" tone="ok" title="Since you last looked" />{" "}
          </>
        )}
        <span className="muted small">{when(r.ts)}</span>{" "}
        <a href={urls.ledger({ ...filters, actor: r.actor, before: undefined })}>{r.actor}</a>{" "}
        {agent && <span className="muted small">{agent}</span>}{" "}
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

/** What a comment event did: "replied", "resolved"…, and the start of what was said. */
const COMMENT_VERBS: Record<string, string> = {
  open: "commented",
  reply: "replied",
  resolve: "resolved a thread",
  reopen: "reopened a thread",
};

function EventLine({ urls, event: e }: { urls: Urls; event: LedgerEvent }) {
  const comment = e.meta?.comment as { kind?: string; body?: string } | undefined;
  if (e.op === "comment" && comment) {
    const said = typeof comment.body === "string" ? comment.body.replace(/\s+/g, " ") : "";
    return (
      <li>
        <span className="op op-comment">comment</span>{" "}
        <a href={`${urls.pinned(undefined).file(e.path)}#comments`}>{e.path}</a>{" "}
        <span className="muted">
          {COMMENT_VERBS[comment.kind ?? ""] ?? comment.kind}
          {said ? `: ${said.length > 120 ? `${said.slice(0, 119)}…` : said}` : ""}
        </span>
      </li>
    );
  }
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
