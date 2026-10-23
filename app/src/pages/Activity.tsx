import { type FormEvent, Fragment, type ReactNode, useEffect, useState } from "react";
import {
  byPerson,
  type Entry,
  EntryRow,
  type EventRow,
  entryTime,
  eventRows,
  groupByDay,
  isLive,
  KINDS,
  type LedgerRequest,
  LIVE_MS,
  LiveEntry,
  type LiveWrite,
  NewDivider,
  titleOf,
  toEntry,
  useNow,
  useTitles,
} from "../activity";
import { agentLabel, useActors } from "../agents";
import { api, useLoad } from "../api";
import { isAgentChange } from "../changes";
import { Avatar, Icon } from "../chrome";
import { markSeen, useFeed, useLastSeen, useTrailing } from "../live";
import { useRole } from "../role";
import { type Done, navigate } from "../router";
import { plural, Status, useTitle } from "../ui";
import type { ActivityFilters, Urls, Who } from "../urls";
import { PageColumn } from "../Workspace";

/** Requests per page, as the ledger pages them. */
const PAGE = 30;

/** Events that made a version of a file, so a diff shows what they changed. */
const DIFFABLE = new Set(["put", "import", "revert", "attach"]);

interface Page {
  requests: LedgerRequest[];
  next: number | null;
}

/**
 * Activity (take 4, TEMPRA-115; tempra-dev: app/activity, decisions/three-activity-surfaces):
 * what happened in the library, in two views under one switch. The Summary (the default) tells
 * each request as a sentence, grouped by day, with an agent writing now as a live entry at the
 * top; Every event is the ledger as a table, with Download. `-/ledger` opens Every event. Both
 * follow the change feed, mark what came after the person's seen cursor, and move it forward.
 * The view and filters are in the URL, so a view can be linked and back and forward restore it.
 */
export function Activity(props: {
  urls: Urls;
  actor: string;
  filters: ActivityFilters;
  done?: Done;
}) {
  const { urls, actor, filters } = props;
  useTitle(`Activity · ${urls.slug}`);
  const view = filters.view === "events" ? "events" : "summary";
  const prefix = filters.prefix ?? "";
  const exact = filters.actor ?? "";
  // Switching the view is a move of its own (back returns to the other); filters replace.
  const go = (change: ActivityFilters, replace = true) =>
    navigate(
      view === "events" && change.view === undefined && location.pathname.endsWith("/-/ledger")
        ? urls.ledger({ ...filters, ...change })
        : urls.activity({ ...filters, view, ...change }),
      { replace },
    );
  const titles = useTitles(urls);
  const key = `activity ${urls.base} ${prefix} ${exact}`;
  const loaded = useLoad(key, async () => {
    // The head first: the feed then replays anything that lands while the page loads.
    const { seq } = await api<{ seq: number }>(urls.api("stats"));
    const page = await api<Page>(
      urls.api("requests", {
        prefix: prefix || undefined,
        actor: exact || undefined,
        limit: PAGE,
      }),
    );
    return { ...page, head: seq };
  });

  // Live (tempra-dev: app/live): a write the filters may match reloads the newest page, once per
  // burst; titles follow too. An agent's write is remembered as writing now (the pulsing dot).
  const reload = useTrailing(loaded.reload);
  const reloadTitles = useTrailing(titles.reload, 1500);
  const [writing, setWriting] = useState<LiveWrite | null>(null);
  const [liveSeqs, setLiveSeqs] = useState<Map<number, number>>(new Map());
  useFeed(
    urls,
    loaded.state === "ready" ? loaded.data.head : null,
    (events) => {
      reloadTitles();
      const at = Date.now();
      const agents = events.filter(isAgentChange);
      const last = agents.at(-1);
      if (last) {
        setWriting({
          actor: last.actor,
          by: last.by ?? null,
          path: last.path,
          seq: last.seq,
          at,
        });
      }
      const fromAgents = events.filter((e) => !e.actor.startsWith("human:") || e.by?.agent);
      if (fromAgents.length > 0) {
        setLiveSeqs((m) => {
          const next = new Map(m);
          for (const e of fromAgents) next.set(e.seq, at);
          return next;
        });
      }
      const under = (p: string | null) =>
        !prefix || p === prefix || !!p?.startsWith(`${prefix.replace(/\/$/, "")}/`);
      const hit = events.some(
        (e) => (!exact || e.actor === exact) && (under(e.path) || under(e.from_path)),
      );
      if (hit) reload();
    },
    () => {
      setWriting(null);
      setLiveSeqs(new Map());
      reload();
    },
  );
  // A clock that ticks while something reads as live, so the dot stops when the writes do.
  const now = useNow(writing || liveSeqs.size > 0 ? 5000 : 30_000);

  // Looking moves the seen cursor forward; what was new when the page opened stays marked. Only
  // the whole ledger moves it: a filtered view (a folder, someone, a kind, text) shows part of
  // what came in, and moving the cursor past the rest would mark it seen (A-11, TEMPRA-121).
  const seen = useLastSeen(urls, true);
  const filtered =
    Boolean(prefix || exact) ||
    (filters.who !== undefined && filters.who !== "everyone") ||
    (view === "events" && Boolean(filters.kind || filters.q));
  const newest =
    loaded.state === "ready" && !filtered
      ? (loaded.data.requests[0]?.events.at(-1)?.seq ?? null)
      : null;
  useEffect(() => {
    if (newest !== null) markSeen(urls, newest);
  }, [newest, urls]);

  return (
    <PageColumn>
      <header className="view-head">
        <div className="view-head-main">
          <h1 className="view-title">Activity</h1>
        </div>
      </header>
      {props.done?.kind === "revert" && (
        <div className="notice ok">
          Reverted: {plural(props.done.n ?? 0, "change")}, recorded as a new change by you.
        </div>
      )}
      <div className="view-filters activity-filters">
        <fieldset className="segmented">
          <legend className="visually-hidden">View</legend>
          <button
            type="button"
            aria-pressed={view === "summary"}
            onClick={() => view !== "summary" && go({ view: "summary" }, false)}
          >
            Summary
          </button>
          <button
            type="button"
            aria-pressed={view === "events"}
            onClick={() => view !== "events" && go({ view: "events" }, false)}
          >
            Every event
          </button>
        </fieldset>
        <WhoFilter
          urls={urls}
          me={actor}
          view={view}
          who={filters.who ?? "everyone"}
          actor={exact}
          onChange={(who, a) => go({ who, actor: a || undefined })}
        />
        {view === "events" && (
          <EventFilters
            kind={filters.kind ?? ""}
            q={filters.q ?? ""}
            onChange={(change) => go(change)}
          />
        )}
        {view === "events" && (
          <a className="button activity-download" href={urls.ledgerJsonl()} download>
            <Icon name="download" />
            Download
          </a>
        )}
      </div>
      <Status loaded={loaded}>
        {(page) => (
          <Older key={key} urls={urls} prefix={prefix} actor={exact} first={page}>
            {(requests, more) =>
              view === "summary" ? (
                <Summary
                  urls={urls}
                  me={actor}
                  requests={requests}
                  empty={page.requests.length === 0}
                  titles={titles.state === "ready" ? titles.data.titles : {}}
                  seen={seen}
                  who={filters.who ?? "everyone"}
                  writing={isLive(writing, now) ? writing : null}
                  now={now}
                />
              ) : (
                <EveryEvent
                  urls={urls}
                  me={actor}
                  requests={requests}
                  empty={page.requests.length === 0}
                  seen={seen}
                  filter={{ who: filters.who, kind: filters.kind, q: filters.q }}
                  more={more}
                  live={liveSeqs}
                  now={now}
                />
              )
            }
          </Older>
        )}
      </Status>
    </PageColumn>
  );
}

/**
 * Who: Anyone, Agents or People, and in Every event each one who has worked here (one exact
 * actor, filtered by the server). A native select, so it works by keyboard and on a phone.
 */
function WhoFilter(props: {
  urls: Urls;
  me: string;
  view: "summary" | "events";
  who: Who;
  actor: string;
  onChange(who: Who, actor: string): void;
}) {
  const actors = useActors(props.urls, props.me || null);
  const value = props.actor ? `actor:${props.actor}` : props.who;
  const people = props.view === "events" ? actors.contributors : [];
  return (
    <select
      className="pill-select"
      aria-label="Who"
      value={value}
      onChange={(e) => {
        const v = e.currentTarget.value;
        if (v.startsWith("actor:")) props.onChange("everyone", v.slice("actor:".length));
        else props.onChange(v as Who, "");
      }}
    >
      <option value="everyone">Anyone</option>
      <option value="agents">Agents</option>
      <option value="people">People</option>
      {people.length > 0 && (
        <optgroup label="Who worked here">
          {people.map((c) => (
            <option key={c.actor} value={`actor:${c.actor}`}>
              {agentLabel(c)}
            </option>
          ))}
        </optgroup>
      )}
      {props.actor && !people.some((c) => c.actor === props.actor) && (
        <option value={`actor:${props.actor}`}>{props.actor}</option>
      )}
    </select>
  );
}

/** Every event's own filters: the kind, and text to find in the path or the note. */
function EventFilters(props: {
  kind: string;
  q: string;
  onChange(change: { kind?: string; q?: string }): void;
}) {
  const [text, setText] = useState(props.q);
  useEffect(() => setText(props.q), [props.q]);
  // The text goes to the URL a moment after typing stops, or at once on Enter.
  useEffect(() => {
    if (text.trim() === props.q) return;
    const t = setTimeout(() => props.onChange({ q: text.trim() || undefined }), 300);
    return () => clearTimeout(t);
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    props.onChange({ q: text.trim() || undefined });
  };
  return (
    <>
      <select
        className="pill-select"
        aria-label="Kind"
        value={props.kind}
        onChange={(e) => props.onChange({ kind: e.currentTarget.value || undefined })}
      >
        <option value="">Any kind</option>
        {KINDS.map((k) => (
          <option key={k} value={k}>
            {k}
          </option>
        ))}
      </select>
      <form className="activity-find" onSubmit={submit}>
        <Icon name="search" />
        <input
          type="search"
          aria-label="Filter by path or note"
          placeholder="Filter by path or note"
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
        />
      </form>
    </>
  );
}

/**
 * The first page and the older ones "Older" pages back to, as one list of requests (both views
 * draw from it). Keyed by the server's filters, so changing them starts afresh.
 */
function Older(props: {
  urls: Urls;
  prefix: string;
  actor: string;
  first: Page;
  /** The requests loaded so far, and whether there are older ones to page to. */
  children: (requests: LedgerRequest[], more: boolean) => ReactNode;
}) {
  const { urls, first } = props;
  const [older, setOlder] = useState<Page>({ requests: [], next: null });
  const [paging, setPaging] = useState(false);
  const next = older.requests.length > 0 ? older.next : first.next;
  const loadOlder = () => {
    if (next === null) return;
    setPaging(true);
    api<Page>(
      urls.api("requests", {
        prefix: props.prefix || undefined,
        actor: props.actor || undefined,
        before: next,
        limit: PAGE,
      }),
    )
      .then((p) => setOlder((o) => ({ requests: [...o.requests, ...p.requests], next: p.next })))
      .catch(() => {})
      .finally(() => setPaging(false));
  };
  return (
    <>
      {props.children([...first.requests, ...older.requests], next !== null)}
      {next !== null && (
        <p className="view-more">
          <button type="button" onClick={loadOlder} disabled={paging}>
            {paging ? "Loading…" : "Older"}
          </button>
        </p>
      )}
    </>
  );
}

/** The Summary: the live entry, then one entry per request, by day. */
function Summary(props: {
  urls: Urls;
  me: string;
  requests: LedgerRequest[];
  empty: boolean;
  titles: Record<string, string>;
  seen: number | null;
  who: Who;
  writing: LiveWrite | null;
  now: number;
}) {
  const { urls, titles, seen, who, writing, now } = props;
  const actors = useActors(urls, props.me || null);
  const ids = new Set<string>();
  const entries: Entry[] = [];
  for (const r of props.requests) {
    if (ids.has(r.request_id)) continue;
    ids.add(r.request_id);
    if (who === "people" && !byPerson(r)) continue;
    if (who === "agents" && byPerson(r)) continue;
    const e = toEntry(r, titles);
    if (e) entries.push(e);
  }
  const live = writing && who !== "people" ? writing : null;
  const days = groupByDay(entries, now);
  // The live entry heads today's entries (a day of its own when nothing else happened today).
  if (live && days[0]?.label !== "Today") days.unshift({ label: "Today", items: [] });
  // The divider goes under the last entry after the cursor, when earlier ones follow it (a first
  // look, or everything loaded being new, marks nothing).
  const firstSeen = seen === null ? -1 : entries.findIndex((e) => e.last <= seen);
  const lastNew = firstSeen > 0 ? entries[firstSeen - 1]?.id : undefined;
  return (
    <>
      {entries.length === 0 && !live && (
        <p className="view-empty">
          {props.empty ? "Nothing has happened here yet." : "Nothing matches."}
        </p>
      )}
      {days.map((day, i) => (
        <section key={day.label} className="activity-day" aria-label={day.label}>
          <h2 className="view-section-title">{day.label}</h2>
          {i === 0 && live && (
            <LiveEntry
              write={live}
              urls={urls}
              actor={actors.view(live.actor, live.by)}
              title={titleOf(live.path, titles)}
            />
          )}
          {day.items.map((e) => (
            <Fragment key={e.id}>
              <EntryRow
                entry={e}
                urls={urls}
                actor={actors.view(e.actor, e.by)}
                now={now}
                isNew={seen !== null && e.last > seen}
              />
              {e.id === lastNew && <NewDivider />}
            </Fragment>
          ))}
        </section>
      ))}
    </>
  );
}

/**
 * Every event: the ledger as a table, newest first. Who and when are named on a request's first
 * row; the newest rows carry the dot, solid after the seen cursor and pulsing while an agent's
 * write is fresh. A request's first row links its revert for those who may write.
 */
function EveryEvent(props: {
  urls: Urls;
  me: string;
  requests: LedgerRequest[];
  empty: boolean;
  seen: number | null;
  filter: { who?: Who; kind?: string; q?: string };
  /** Older requests are still to load ("Older"). */
  more: boolean;
  live: Map<number, number>;
  now: number;
}) {
  const { urls, seen, live, now } = props;
  const actors = useActors(urls, props.me || null);
  const role = useRole(urls);
  const rows = eventRows(props.requests, props.filter);
  // Who (Agents, People), the kind and the text filter what is loaded, not the whole ledger: say
  // so while older requests remain, and "Older" pages on.
  const f = props.filter;
  const partial =
    props.more &&
    (Boolean(f.kind) || Boolean(f.q) || (f.who !== undefined && f.who !== "everyone"));
  const scope = `in the latest ${plural(props.requests.length, "request")}`;
  if (rows.length === 0) {
    return (
      <p className="view-empty">
        {props.empty
          ? "Nothing has happened here yet."
          : partial
            ? `No events match ${scope}.`
            : "No events match."}
      </p>
    );
  }
  return (
    <>
      {partial && <p className="view-meta events-scope">Matching events {scope}</p>}
      <div className="table-wrap">
        <table className="events-table">
          <thead>
            <tr>
              <th scope="col">Seq</th>
              <th scope="col">When</th>
              <th scope="col">Who</th>
              <th scope="col">Kind</th>
              <th scope="col">Path and note</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <EventLine
                key={row.event.seq}
                row={row}
                urls={urls}
                actor={actors.view(row.request.actor, row.request.by)}
                dot={
                  (live.get(row.event.seq) ?? 0) > now - LIVE_MS
                    ? "live"
                    : seen !== null && row.event.seq > seen
                      ? "new"
                      : null
                }
                revert={
                  // Revert is one of the owner's recovery tools (TEMPRA-124).
                  row.lead &&
                  role === "owner" &&
                  row.request.events.some((e) => e.op !== "verify" && e.op !== "comment")
                }
                now={now}
              />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function EventLine(props: {
  row: EventRow;
  urls: Urls;
  actor: ReturnType<ReturnType<typeof useActors>["view"]>;
  dot: "live" | "new" | null;
  revert: boolean;
  now: number;
}) {
  const { row, urls, actor, dot, now } = props;
  const e = row.event;
  // A deleted file is shown as it was just before; a comment opens on its page.
  const href =
    e.op === "comment"
      ? urls.file(e.path)
      : urls.pinned(e.op === "delete" ? e.seq - 1 : e.seq).file(e.path);
  return (
    <tr className={row.lead ? "lead" : undefined}>
      <td className="events-seq">
        {dot && (
          <span className={dot === "live" ? "change-dot live" : "change-dot"}>
            <span className="visually-hidden">
              {dot === "live" ? "Being written now" : "New since you looked"}
            </span>
          </span>
        )}
        {e.seq}
      </td>
      <td className="events-when">
        {row.lead && <time dateTime={e.ts}>{entryTime(e.ts, now, true)}</time>}
      </td>
      <td className="events-who">
        {row.lead && (
          <span className="events-person">
            <Avatar name={actor.mark} agent={actor.agent} />
            <span>
              {actor.name}
              {actor.for && <span className="entry-for"> for {actor.for}</span>}
            </span>
          </span>
        )}
      </td>
      <td className="events-kind">{row.kind}</td>
      <td className="events-path">
        <a href={href}>
          <code>{e.path}</code>
        </a>
        {row.note && <span className="events-note">{row.note}</span>}
        {DIFFABLE.has(e.op) && e.path.endsWith(".md") && (
          // This version as it was, on the concept's own page (History marks it there).
          <a className="events-aside" href={urls.diff(e.path, undefined, e.seq)}>
            Version
          </a>
        )}
        {props.revert && (
          <a className="events-aside" href={urls.revert(row.request.request_id)}>
            Revert…
          </a>
        )}
      </td>
    </tr>
  );
}
