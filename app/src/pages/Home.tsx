import { useMemo } from "react";
import {
  byPerson,
  dayLabel,
  type LedgerEvent,
  type LedgerRequest,
  useNow,
  whoWorksHere,
} from "../activity";
import { type ActedBy, type ActorView, actorAgentName, actorText, useActors } from "../agents";
import { api, useLoad } from "../api";
import { Icon } from "../chrome";
import {
  type Card,
  forYouCards,
  type InboxPage,
  type PageTitles,
  useAgentLabels,
  useLibraryInbox,
  withNames,
} from "../inbox";
import { useFeed, useSeenCursor, useTrailing } from "../live";
import { Moment } from "../Moment";
import { type Needs, useNeeds } from "../needs";
import { libraryLabel, type Role, useLibraries, useRole } from "../role";
import { fileLabel, type OutlineFile, topLevel } from "../Tree";
import { clip, plural, Status, useCopy, useMe, useTitle } from "../ui";
import { dirOf, folderName, type Urls } from "../urls";
import { PageColumn, useFrame } from "../Workspace";

/** The requests read for Recently changed and the empty library's line. */
const READ = 20;

/** How many pages Recently changed lists. */
const RECENT = 5;

/** The most events read for "Since you last looked" (one page of the ledger). */
const SINCE_READ = 1000;

/**
 * The library's home (take 4, TEMPRA-117, TEMPRA-121; tempra-dev: app/home): its title and
 * description, one quiet line (who works here, the page count, the guide), one line on what
 * changed since the person last looked, up to three of their open Inbox items here with the way
 * to the Inbox, the pages changed most recently, every top-level section with its count and the
 * solid dot, and at the foot the agents' housekeeping (`GET …/needs`). An empty library shows how
 * to connect an agent instead (to those who can). Each part loads on its own, so one that fails
 * leaves the rest (H-7). It does not move the seen cursor (Activity does).
 */
export function Home({ urls }: { urls: Urls }) {
  const libs = useLibraries();
  const lib =
    libs.state === "ready"
      ? libs.data.libraries.find((l) => l.owner === urls.owner && l.slug === urls.slug)
      : undefined;
  const name = libraryLabel(lib ?? urls);
  useTitle(name);
  const me = useMe();
  const role = useRole(urls);
  const actors = useActors(urls, me?.actor ?? null);
  const frame = useFrame();
  const cursor = useSeenCursor(urls);
  const seen = cursor.seen;
  const now = useNow();
  const loaded = useLoad(`home ${urls.base}`, async () => {
    const [summary, page] = await Promise.all([
      api<{ seq: number; concepts: number }>(urls.api("summary")),
      api<{ requests: LedgerRequest[] }>(urls.api("requests", { limit: READ })),
    ]);
    return {
      head: summary.seq,
      concepts: summary.concepts,
      requests: page.requests,
      latest: page.requests.find((r) => !byPerson(r)) ?? null,
      // No agent among the newest requests, and no older ones: no agent has written here yet.
      noAgentYet: page.requests.length < READ && !page.requests.some((r) => !byPerson(r)),
    };
  });
  // Who works here: only the header's quiet line needs it, so a failure drops only that line.
  const members = useLoad(`home people ${urls.base}`, () =>
    api<{ owner: string; members: { handle: string }[] }>(urls.api("members")).then((m) => [
      m.owner,
      ...m.members.map((x) => x.handle),
    ]),
  );
  // What came in since the person last looked (the event at the cursor too, for its date).
  const since = useLoad(`home since ${urls.base} ${seen}`, async () =>
    seen === null
      ? null
      : api<{ events: LedgerEvent[]; next: number | null }>(
          urls.api("events", { since: Math.max(0, seen - 1), limit: SINCE_READ }),
        ),
  );
  const reloadAll = () => {
    loaded.reload();
    since.reload();
  };
  const reload = useTrailing(reloadAll, 1500);
  useFeed(urls, loaded.state === "ready" ? loaded.data.head : null, reload, reload);
  const needs = useNeeds(urls);
  const inbox = useLibraryInbox(`${urls.owner}/${urls.slug}`);
  // A reply's item names its page by path; the tree's outline has its title.
  const titles = useMemo(() => {
    const out: PageTitles = {};
    for (const f of frame.index ?? []) {
      if (f.title) out[`${urls.owner}/${urls.slug} ${f.path}`] = f.title;
    }
    return out;
  }, [frame.index, urls]);
  return (
    <PageColumn>
      <Status loaded={loaded}>
        {(home) => {
          const files = frame.index;
          // The tree's outline when it has arrived (it follows the feed), else the summary.
          const empty = files === null ? home.concepts === 0 : files.length === 0;
          const handle = me?.handle ?? null;
          const people = members.state === "ready" ? members.data : null;
          const you = handle !== null && (people?.includes(handle) ?? false);
          const agents = actors.contributors.filter((c) => c.agent).length;
          const guide = files?.some((f) => f.path === "guide.md" && f.kind === "concept");
          // A first look: the page count goes on the line of what is here so far.
          const firstLook = cursor.known && seen === null;
          const who =
            people === null ? null : whoWorksHere(you, people.length - (you ? 1 : 0), agents);
          const meta = [who, firstLook ? null : plural(home.concepts, "page")].filter(
            (p): p is string => p !== null,
          );
          const canWrite = role === "owner" || role === "write";
          return (
            <>
              <header className="view-head home-head">
                <div className="view-head-main">
                  <h1 className="view-title">{name}</h1>
                  {lib?.description && <p className="view-lede">{lib.description}</p>}
                  {!empty && (meta.length > 0 || guide) && (
                    <p className="view-meta home-who">
                      {meta.join(" · ")}
                      {guide && (
                        <>
                          {meta.length > 0 && " · "}
                          <a href={urls.file("guide.md")}>Start with the guide</a>
                        </>
                      )}
                    </p>
                  )}
                  {!empty && firstLook && (
                    <p className="view-meta home-since">
                      {plural(home.concepts, "page")} so far ·{" "}
                      <a href={urls.activity()}>See Activity</a>
                    </p>
                  )}
                  {!empty && since.state === "ready" && since.data && seen !== null && (
                    <SinceLine
                      urls={urls}
                      what={sinceYouLooked(since.data.events, seen, me?.actor ?? null, {
                        more: since.data.next !== null,
                      })}
                      name={(a, by) => actors.view(a, by).name}
                      now={now}
                    />
                  )}
                </div>
              </header>
              {empty ? (
                <EmptyLibrary
                  urls={urls}
                  access={role}
                  latest={home.latest}
                  who={home.latest ? actors.view(home.latest.actor, home.latest.by) : null}
                  now={now}
                />
              ) : (
                <>
                  {/* A first library with only its start-here note: how to connect an agent. */}
                  {home.noAgentYet && canWrite && (
                    <EmptyLibrary
                      urls={urls}
                      access={role}
                      latest={null}
                      who={null}
                      now={now}
                      heading="Connect an agent"
                    />
                  )}
                  {inbox.state === "ready" && (
                    <ForYou urls={urls} inbox={inbox.data} titles={titles} />
                  )}
                  {inbox.state === "error" && (
                    <p className="home-section view-meta home-failed">
                      Couldn't load what's for you here.{" "}
                      <button type="button" onClick={inbox.reload}>
                        Retry
                      </button>
                    </p>
                  )}
                  {files !== null && (
                    <RecentlyChanged
                      urls={urls}
                      changed={recentlyChanged(home.requests, files)}
                      view={(a, by) => actors.view(a, by)}
                    />
                  )}
                  {files !== null && <HomeSections urls={urls} files={files} seen={seen} />}
                  {needs.state === "ready" && <HomeFoot urls={urls} needs={needs.data} />}
                  {needs.state === "error" && (
                    <p className="home-foot view-meta home-failed">
                      Couldn't load the agents' housekeeping.
                    </p>
                  )}
                </>
              )}
            </>
          );
        }}
      </Status>
    </PageColumn>
  );
}

// ---------------------------------------------------------------- since you last looked

/** What came in since the person's seen cursor, as the home's one line tells it. */
export interface SinceYouLooked {
  /** When the person last looked (the event at their cursor), when the ledger has it. */
  from: string | null;
  /** Who changed things, in order of their first change: each actor once. */
  who: { actor: string; by: ActedBy | null }[];
  pages: number;
  files: number;
  comments: number;
  /** More came in than was read: the counts are a floor. */
  more: boolean;
}

const actedBy = (e: LedgerEvent): ActedBy | null => {
  const by = e.meta?.by as ActedBy | undefined;
  return typeof by?.person === "string" ? by : null;
};

/**
 * The events after `seen` (`GET …/events?since=seen-1`, so the one at the cursor dates the
 * line), by anyone but the person acting in the app themselves: the pages and files changed, the
 * comments, and who.
 */
export function sinceYouLooked(
  events: LedgerEvent[],
  seen: number,
  me: string | null,
  opts: { more?: boolean } = {},
): SinceYouLooked {
  const at = events.find((e) => e.seq === seen);
  const pages = new Set<string>();
  const files = new Set<string>();
  let comments = 0;
  const who = new Map<string, { actor: string; by: ActedBy | null }>();
  for (const e of events) {
    if (e.seq <= seen) continue;
    const by = actedBy(e);
    if (me !== null && e.actor === me && !by?.agent) continue;
    if (e.op === "verify") continue;
    if (e.op === "comment") comments++;
    else (e.path.endsWith(".md") ? pages : files).add(e.path);
    const key = by?.agent ?? e.actor;
    if (!who.has(key)) who.set(key, { actor: e.actor, by });
  }
  return {
    from: at?.ts ?? null,
    who: [...who.values()],
    pages: pages.size,
    files: files.size,
    comments,
    more: opts.more ?? false,
  };
}

/** "Claude Code", "Claude Code and you", "Claude Code and 2 others". */
const names = (list: string[]) =>
  list.length <= 2 ? list.join(" and ") : `${list[0]} and ${list.length - 1} others`;

/**
 * "Since yesterday: Claude Code changed 4 pages · See Activity"; nothing when nothing came in.
 * The when is the day the person last looked, in Activity's words.
 */
export function SinceLine(props: {
  urls: Urls;
  what: SinceYouLooked;
  name(actor: string, by: ActedBy | null): string;
  now: number;
}) {
  const { what } = props;
  const plus = what.more ? "+" : "";
  const changed = [
    what.pages > 0 && `${what.pages}${plus} ${what.pages === 1 && !plus ? "page" : "pages"}`,
    what.files > 0 && plural(what.files, "file"),
  ].filter(Boolean);
  const clauses = [
    changed.length > 0 && `changed ${changed.join(" and ")}`,
    what.comments > 0 && `left ${plural(what.comments, "comment")}`,
  ].filter(Boolean);
  if (clauses.length === 0 || what.who.length === 0) return null;
  const day = what.from === null ? null : dayLabel(what.from, props.now);
  const when =
    day === null
      ? "Since you last looked"
      : day === "Today"
        ? "Since earlier today"
        : day === "Yesterday"
          ? "Since yesterday"
          : `Since ${day}`;
  const who = names(what.who.map((w) => props.name(w.actor, w.by)));
  return (
    <p className="view-meta home-since">
      {when}: {who} {clauses.join(" and ")} · <a href={props.urls.activity()}>See Activity</a>
    </p>
  );
}

// ---------------------------------------------------------------- recently changed

/** A page an agent or a person changed lately, as Recently changed lists it. */
export interface Changed {
  path: string;
  title: string;
  ts: string;
  actor: string;
  by: ActedBy | null;
}

/** Events that make a new version of a page (not a comment, a verification or a delete). */
const CHANGES = new Set(["put", "import", "move", "revert"]);

/**
 * The pages changed most recently, newest first, each once, from the newest requests: only
 * pages still in the library (by the path they have now), each with who changed it and when.
 */
export function recentlyChanged(
  requests: LedgerRequest[],
  files: OutlineFile[],
  max = RECENT,
): Changed[] {
  const here = new Map(files.filter((f) => f.kind === "concept").map((f) => [f.path, f]));
  const out: Changed[] = [];
  const listed = new Set<string>();
  for (const r of requests) {
    for (const e of [...r.events].reverse()) {
      if (!CHANGES.has(e.op) || listed.has(e.path)) continue;
      const f = here.get(e.path);
      if (!f) continue;
      listed.add(e.path);
      out.push({ path: e.path, title: fileLabel(f), ts: e.ts, actor: r.actor, by: r.by ?? null });
      if (out.length === max) return out;
    }
  }
  return out;
}

/** Recently changed: the last few pages edited, each with who and when; absent when none. */
export function RecentlyChanged(props: {
  urls: Urls;
  changed: Changed[];
  view(actor: string, by: ActedBy | null): ActorView;
}) {
  if (props.changed.length === 0) return null;
  return (
    <section className="home-section" aria-labelledby="home-recent">
      <div className="view-section-head">
        <h2 id="home-recent" className="view-section-title">
          Recently changed
        </h2>
      </div>
      <ul className="home-recent">
        {props.changed.map((c) => {
          const who = props.view(c.actor, c.by);
          const folder = dirOf(c.path);
          return (
            <li key={c.path} className="home-recent-row">
              <a className="home-recent-title" href={props.urls.file(c.path)}>
                {c.title}
              </a>
              <span className="home-recent-meta">
                {folder && <span>{folderName(folder)} · </span>}
                {who.name}
                {who.for && ` for ${who.for}`} · <Moment ts={c.ts} />
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------- for you, sections, foot

/** The Inbox filtered to this library (TEMPRA-116 makes the filter work). */
export const inboxHref = (urls: Urls) =>
  `/inbox?library=${encodeURIComponent(urls.owner)}/${encodeURIComponent(urls.slug)}`;

/**
 * For you here: up to three cards from the person's open Inbox items in this library, and "All n
 * in Inbox" (the same count the filtered Inbox shows); nothing when there is nothing.
 */
export function ForYou(props: { urls: Urls; inbox: InboxPage; titles?: PageTitles }) {
  const labels = useAgentLabels(props.inbox.items);
  const cards: Card[] = forYouCards(withNames(props.inbox.items, labels), props.titles);
  if (cards.length === 0) return null;
  return (
    <section className="home-section" aria-labelledby="home-for-you">
      <div className="view-section-head">
        <h2 id="home-for-you" className="view-section-title">
          For you here
        </h2>
        <a className="view-aside" href={inboxHref(props.urls)}>
          All {Math.max(props.inbox.open, cards.length)} in Inbox
        </a>
      </div>
      <ul className="home-cards">
        {cards.map((c) => (
          <li key={c.key}>
            <a className="home-card" href={c.href}>
              <span className="home-card-kind">{c.kind}</span>
              <span className="home-card-title">{c.title}</span>
              {c.detail && <span className="home-card-detail">{c.detail}</span>}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Sections: every top-level folder in the tree's order, with its count of concepts (or of files,
 * for a folder that holds only files: "1 file", H-2) and the solid dot when something under it
 * changed since the person last looked; each opens its folder view. A library with no folders
 * yet (a first library's start-here note) lists its pages instead.
 */
export function HomeSections(props: { urls: Urls; files: OutlineFile[]; seen: number | null }) {
  const { urls, files, seen } = props;
  const top = topLevel(files);
  const folders = top.filter(({ entry }) => entry.kind === "dir");
  const pages = folders.length === 0;
  const rows = pages ? top.filter(({ entry }) => entry.kind === "concept") : folders;
  if (rows.length === 0) return null;
  const changed = new Set<string>();
  const attachments = new Map<string, number>();
  for (const f of files) {
    let top = f.path;
    for (let d = dirOf(top); d !== ""; d = dirOf(d)) top = d;
    if (f.kind === "attachment") attachments.set(top, (attachments.get(top) ?? 0) + 1);
    if (seen !== null && typeof f.seq === "number" && f.seq > seen) changed.add(top);
  }
  return (
    <section className="home-section" aria-labelledby="home-sections">
      <div className="view-section-head">
        <h2 id="home-sections" className="view-section-title">
          {pages ? "Pages" : "Sections"}
        </h2>
      </div>
      <ul className="home-sections">
        {rows.map(({ entry, count }) => {
          const only = attachments.get(entry.path) ?? 0;
          return (
            <li key={entry.path}>
              <a
                className="home-section-row"
                href={pages ? urls.file(entry.path) : urls.tree(entry.path)}
              >
                <span className="home-section-name">
                  {pages ? fileLabel(entry) : folderName(entry.path)}
                </span>
                <span className="home-section-end">
                  {!pages &&
                    (count === 0 && only > 0 ? (
                      <span className="home-section-count">{plural(only, "file")}</span>
                    ) : (
                      <span className="home-section-count">{count}</span>
                    ))}
                  {changed.has(entry.path) ? (
                    <span className="home-section-dot" title="Changed since you last looked">
                      <span className="change-dot" aria-hidden="true" />
                      <span className="visually-hidden">changed since you last looked</span>
                    </span>
                  ) : (
                    <span className="home-section-dot" aria-hidden="true" />
                  )}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The foot, quietly: the agents' housekeeping, linking For agents. */
export function HomeFoot({ urls, needs }: { urls: Urls; needs: Needs }) {
  const n = needs.housekeeping.total;
  if (n === 0) return null;
  return (
    <p className="home-foot">
      <a href={urls.work()}>
        {plural(n, "housekeeping item")} for agents
        <Icon name="chevron" size={14} />
      </a>
    </p>
  );
}

// ---------------------------------------------------------------- an empty library

/**
 * A library with no pages (board 31): the steps to connect an agent, the MCP URL to copy, then
 * "Waiting for the first write" with the pulsing dot until an agent writes (the home reloads on
 * the feed, so it fills in live), and Import a bundle. By role (H-11): a read member, who can
 * neither connect an agent here nor import, sees only that nothing is here yet; Import is the
 * owner's (TEMPRA-124). `heading` names the box when it heads a library with pages but no agent.
 */
export function EmptyLibrary(props: {
  urls: Urls;
  access: Role | null;
  latest: LedgerRequest | null;
  who: ActorView | null;
  now: number;
  heading?: string;
}) {
  const { urls, latest, access: role } = props;
  const mcp = `${typeof location === "undefined" ? "" : location.origin}/mcp`;
  const copied = useCopy();
  const canWrite = role === "owner" || role === "write";
  const wait = (
    <p className="empty-wait" aria-live="polite">
      {latest ? (
        <>
          <span className="change-dot" aria-hidden="true" />
          <span>
            Last write by {props.who ? actorText(props.who) : actorAgentName(latest.actor)},{" "}
            <Moment ts={latest.ts} now={props.now} />
            {latest.note ? `: ${clip(latest.note, 80)}` : ""}
          </span>
        </>
      ) : (
        <>
          <span className="change-dot live" aria-hidden="true" />
          <span>Waiting for the first write…</span>
        </>
      )}
    </p>
  );
  return (
    <>
      <section className="empty-library" aria-labelledby="empty-title">
        <h2 id="empty-title" className="view-section-title">
          {props.heading ?? "Nothing here yet"}
        </h2>
        {role === "read" && (
          <p className="view-empty">Pages appear here when an agent writes them.</p>
        )}
        {canWrite && (
          <ol className="empty-steps">
            <li>
              <span>Add Tempra to your agent:</span>
              <span className="copy-field">
                <code>{mcp}</code>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Copy the MCP URL"
                  title={copied.state === "copied" ? "Copied" : "Copy"}
                  onClick={() => void copied.copy(mcp)}
                >
                  <Icon name={copied.state === "copied" ? "check" : "copy"} />
                </button>
              </span>
            </li>
            <li>
              <span>
                Ask it to start, for example: “In my {urls.slug} library, keep a page for each book
                I mention.”
              </span>
            </li>
          </ol>
        )}
        {(canWrite || !props.heading) && wait}
      </section>
      {canWrite && (
        <p className="empty-more">
          {role === "owner" && (
            <>
              <a href={urls.transfer()}>Import a bundle</a> ·{" "}
            </>
          )}
          <a href={urls.connect()}>Other ways to connect</a>
        </p>
      )}
    </>
  );
}
