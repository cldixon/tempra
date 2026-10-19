import { useEffect, useState } from "react";
import {
  byPerson,
  type Entry,
  EntryRow,
  groupByDay,
  type LedgerRequest,
  toEntry,
  useNow,
  useTitles,
} from "../activity";
import { useActors } from "../agents";
import { api, useLoad } from "../api";
import { markSeen, useFeed, useLastSeen, useTrailing } from "../live";
import { navigate } from "../router";
import { Status, useTitle } from "../ui";
import { type ActivityFilters, folderName, type Urls } from "../urls";
import { SheetPage } from "../Workspace";

/** Requests per page, as the ledger pages them. */
const PAGE = 30;

type Who = NonNullable<ActivityFilters["who"]>;

interface Page {
  requests: LedgerRequest[];
  next: number | null;
}

/**
 * Activity (take 3, TEMPRA-106; tempra-dev: app/activity): what happened in the library, for
 * people. One entry per request, grouped by day, newest first; new entries arrive live, and
 * those after the person's seen cursor are marked. Looking moves the cursor forward, as the
 * ledger does; the ledger stays as the audit view behind "The full ledger". The filters are in
 * the URL, so a filtered view can be linked and back and forward restore it.
 */
export function Activity(props: { urls: Urls; actor: string; filters: ActivityFilters }) {
  const { urls, actor, filters } = props;
  useTitle(`Activity · ${urls.slug}`);
  const who: Who = filters.who ?? "everyone";
  const folder = filters.prefix ?? "";
  const hideComments = filters.hideComments ?? false;
  const filter = (change: ActivityFilters) =>
    navigate(urls.activity({ ...filters, ...change }), { replace: true });
  const titles = useTitles(urls);
  const loaded = useLoad(`activity ${urls.base} ${folder}`, async () => {
    // The head first: the feed then replays anything that lands while the page loads.
    const { seq } = await api<{ seq: number }>(urls.api("stats"));
    const page = await api<Page>(
      urls.api("requests", { prefix: folder || undefined, limit: PAGE }),
    );
    return { ...page, head: seq };
  });

  // Live (tempra-dev: app/live): a write under the folder reloads the newest page, once per
  // burst; titles follow too (a new concept's, a renamed one's).
  const reload = useTrailing(loaded.reload);
  const reloadTitles = useTrailing(titles.reload, 1500);
  useFeed(
    urls,
    loaded.state === "ready" ? loaded.data.head : null,
    (events) => {
      reloadTitles();
      const under = (p: string | null) => !folder || !!p?.startsWith(`${folder}/`);
      if (events.some((e) => under(e.path) || under(e.from_path))) reload();
    },
    reload,
  );

  // Looking moves the seen cursor forward; what was new when the page opened stays marked.
  const seen = useLastSeen(urls);
  const newest =
    loaded.state === "ready" ? (loaded.data.requests[0]?.events.at(-1)?.seq ?? null) : null;
  useEffect(() => {
    if (newest !== null) markSeen(urls, newest);
  }, [newest, urls]);

  return (
    <SheetPage>
      <header className="view-head">
        <div className="view-head-main">
          <h1 className="view-title">Activity</h1>
          <p className="view-meta view-live">Live · new since you looked are marked</p>
        </div>
        <a className="view-aside" href={urls.ledger()}>
          The full ledger
        </a>
      </header>
      <div className="view-filters">
        <WhoFilter value={who} onChange={(w) => filter({ who: w })} />
        <select
          className="pill-select"
          aria-label="Folder"
          value={folder}
          onChange={(e) => filter({ prefix: e.currentTarget.value || undefined })}
        >
          <option value="">All folders</option>
          {(titles.state === "ready" ? titles.data.folders : []).map((f) => (
            <option key={f} value={f}>
              {folderName(f)}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="pill-toggle"
          aria-pressed={hideComments}
          onClick={() => filter({ hideComments: !hideComments })}
        >
          Hide comments
        </button>
      </div>
      <Status loaded={loaded}>
        {(page) => (
          <Entries
            key={folder}
            urls={urls}
            actor={actor}
            folder={folder}
            first={page}
            titles={titles.state === "ready" ? titles.data.titles : {}}
            seen={seen}
            filter={{ who, hideComments }}
          />
        )}
      </Status>
    </SheetPage>
  );
}

/** Everyone, Agents or People: a segmented control. */
function WhoFilter({ value, onChange }: { value: Who; onChange(w: Who): void }) {
  const options: [Who, string][] = [
    ["everyone", "Everyone"],
    ["agents", "Agents"],
    ["people", "People"],
  ];
  return (
    <fieldset className="segmented">
      <legend className="visually-hidden">Who</legend>
      {options.map(([w, label]) => (
        <button key={w} type="button" aria-pressed={value === w} onClick={() => onChange(w)}>
          {label}
        </button>
      ))}
    </fieldset>
  );
}

/**
 * The entries, by day, with "Older" paging back through the ledger. Who and comments are
 * filtered here (the server filters by folder), so a page may hold fewer entries than requests.
 */
function Entries(props: {
  urls: Urls;
  actor: string;
  folder: string;
  first: Page;
  titles: Record<string, string>;
  seen: number | null;
  filter: { who: Who; hideComments: boolean };
}) {
  const { urls, first, titles, seen, filter } = props;
  const actors = useActors(urls, props.actor || null);
  const now = useNow();
  const [older, setOlder] = useState<Page>({ requests: [], next: null });
  const [paging, setPaging] = useState(false);
  const next = older.requests.length > 0 ? older.next : first.next;

  const loadOlder = () => {
    if (next === null) return;
    setPaging(true);
    api<Page>(
      urls.api("requests", { prefix: props.folder || undefined, before: next, limit: PAGE }),
    )
      .then((p) => setOlder((o) => ({ requests: [...o.requests, ...p.requests], next: p.next })))
      .catch(() => {})
      .finally(() => setPaging(false));
  };

  const ids = new Set<string>();
  const entries: Entry[] = [];
  for (const r of [...first.requests, ...older.requests]) {
    if (ids.has(r.request_id)) continue;
    ids.add(r.request_id);
    if (filter.who === "people" && !byPerson(r)) continue;
    if (filter.who === "agents" && byPerson(r)) continue;
    const e = toEntry(r, titles, { hideComments: filter.hideComments });
    if (e) entries.push(e);
  }

  return (
    <>
      {entries.length === 0 && (
        <p className="view-empty">
          {first.requests.length === 0 ? "Nothing has happened here yet." : "Nothing matches."}
        </p>
      )}
      {groupByDay(entries, now).map((day) => (
        <section key={day.label} className="activity-day" aria-label={day.label}>
          <h2 className="view-section-title">{day.label}</h2>
          {day.items.map((e) => (
            <EntryRow
              key={e.id}
              entry={e}
              urls={urls}
              actor={actors.view(e.actor, e.by)}
              now={now}
              isNew={seen !== null && e.first > seen}
            />
          ))}
        </section>
      ))}
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
