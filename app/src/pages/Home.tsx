import { useMemo } from "react";
import { agoWords, byPerson, type LedgerRequest, useNow, whoWorksHere } from "../activity";
import { type ActorView, useActors } from "../agents";
import { api, useLoad } from "../api";
import { Icon } from "../chrome";
import { type Card, forYouCards, type InboxPage, type PageTitles, useLibraryInbox } from "../inbox";
import { useFeed, useLastSeen, useTrailing } from "../live";
import { type Needs, useNeeds } from "../needs";
import { useLibraries } from "../role";
import { fileLabel, type OutlineFile, topLevel } from "../Tree";
import { clip, plural, Status, useCopy, useMe, useTitle } from "../ui";
import { dirOf, folderName, type Urls } from "../urls";
import { PageColumn, useFrame } from "../Workspace";

/** The requests read for the empty library's line (the newest agent write among them). */
const READ = 20;

/**
 * The library's home (take 4, TEMPRA-117; tempra-dev: app/home): its title and description, one
 * quiet line (who works here, the page count, the guide), up to three of the person's open Inbox
 * items here (`GET /api/v1/inbox?library=`, so what is done in the Inbox leaves the home too)
 * with the way to the Inbox, every top-level section with its count and the solid dot, and at
 * the foot the agents' housekeeping (`GET …/needs`). An empty library shows how to connect an
 * agent instead of the sections. Quiet on purpose; it does not move the seen cursor (Activity
 * does).
 */
export function Home({ urls }: { urls: Urls }) {
  const libs = useLibraries();
  const lib =
    libs.state === "ready"
      ? libs.data.libraries.find((l) => l.owner === urls.owner && l.slug === urls.slug)
      : undefined;
  const name = lib?.title || urls.slug;
  useTitle(name);
  const me = useMe();
  const actors = useActors(urls, me?.actor ?? null);
  const frame = useFrame();
  const seen = useLastSeen(urls);
  const now = useNow();
  const loaded = useLoad(`home ${urls.base}`, async () => {
    const [summary, page, members] = await Promise.all([
      api<{ seq: number; concepts: number }>(urls.api("summary")),
      api<{ requests: LedgerRequest[] }>(urls.api("requests", { limit: READ })),
      api<{ owner: string; members: { handle: string }[] }>(urls.api("members")),
    ]);
    return {
      head: summary.seq,
      concepts: summary.concepts,
      latest: page.requests.find((r) => !byPerson(r)) ?? null,
      people: [members.owner, ...members.members.map((m) => m.handle)],
    };
  });
  const reload = useTrailing(loaded.reload, 1500);
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
          const you = handle !== null && home.people.includes(handle);
          const agents = actors.contributors.filter((c) => c.agent).length;
          const guide = files?.some((f) => f.path === "guide.md" && f.kind === "concept");
          return (
            <>
              <header className="view-head home-head">
                <div className="view-head-main">
                  <h1 className="view-title">{name}</h1>
                  {lib?.description && <p className="view-lede">{lib.description}</p>}
                  {!empty && (
                    <p className="view-meta home-who">
                      {whoWorksHere(you, home.people.length - (you ? 1 : 0), agents)} ·{" "}
                      {plural(home.concepts, "page")}
                      {guide && (
                        <>
                          {" · "}
                          <a href={urls.file("guide.md")}>Start with the guide</a>
                        </>
                      )}
                    </p>
                  )}
                </div>
              </header>
              {empty ? (
                <EmptyLibrary
                  urls={urls}
                  latest={home.latest}
                  who={home.latest ? actors.view(home.latest.actor, home.latest.by) : null}
                  now={now}
                />
              ) : (
                <>
                  {inbox.state === "ready" && (
                    <ForYou urls={urls} inbox={inbox.data} titles={titles} />
                  )}
                  {files !== null && <HomeSections urls={urls} files={files} seen={seen} />}
                  {needs.state === "ready" && <HomeFoot urls={urls} needs={needs.data} />}
                </>
              )}
            </>
          );
        }}
      </Status>
    </PageColumn>
  );
}

/** The Inbox filtered to this library (TEMPRA-116 makes the filter work). */
export const inboxHref = (urls: Urls) =>
  `/inbox?library=${encodeURIComponent(urls.owner)}/${encodeURIComponent(urls.slug)}`;

/**
 * For you here: up to three cards from the person's open Inbox items in this library, and "All n
 * in Inbox" (the same count the filtered Inbox shows); nothing when there is nothing.
 */
export function ForYou(props: { urls: Urls; inbox: InboxPage; titles?: PageTitles }) {
  const cards: Card[] = forYouCards(props.inbox.items, props.titles);
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
 * Sections: every top-level folder in the tree's order, with its count of concepts and the solid
 * dot when something under it changed since the person last looked; each opens its folder view.
 * A library with no folders yet (a first library's start-here note) lists its pages instead.
 */
export function HomeSections(props: { urls: Urls; files: OutlineFile[]; seen: number | null }) {
  const { urls, files, seen } = props;
  const top = topLevel(files);
  const folders = top.filter(({ entry }) => entry.kind === "dir");
  const pages = folders.length === 0;
  const rows = pages ? top.filter(({ entry }) => entry.kind === "concept") : folders;
  if (rows.length === 0) return null;
  const changed = new Set<string>();
  if (seen !== null) {
    for (const f of files) {
      if (typeof f.seq !== "number" || f.seq <= seen) continue;
      let top = f.path;
      for (let d = dirOf(top); d !== ""; d = dirOf(d)) top = d;
      changed.add(top);
    }
  }
  return (
    <section className="home-section" aria-labelledby="home-sections">
      <div className="view-section-head">
        <h2 id="home-sections" className="view-section-title">
          {pages ? "Pages" : "Sections"}
        </h2>
      </div>
      <ul className="home-sections">
        {rows.map(({ entry, count }) => (
          <li key={entry.path}>
            <a
              className="home-section-row"
              href={pages ? urls.file(entry.path) : urls.tree(entry.path)}
            >
              <span className="home-section-name">
                {pages ? fileLabel(entry) : folderName(entry.path)}
              </span>
              <span className="home-section-end">
                {!pages && <span className="home-section-count">{count}</span>}
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
        ))}
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

/**
 * A library with no pages (board 31): the steps to connect an agent, the MCP URL to copy, then
 * "Waiting for the first write" with the pulsing dot until an agent writes (the home reloads on
 * the feed, so it fills in live), and Import a bundle.
 */
export function EmptyLibrary(props: {
  urls: Urls;
  latest: LedgerRequest | null;
  who: ActorView | null;
  now: number;
}) {
  const { urls, latest } = props;
  const mcp = `${typeof location === "undefined" ? "" : location.origin}/mcp`;
  const copied = useCopy();
  return (
    <>
      <section className="empty-library" aria-labelledby="empty-title">
        <h2 id="empty-title" className="view-section-title">
          Nothing here yet
        </h2>
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
              Ask it to start, for example: “In my {urls.slug} library, keep a page for each book I
              mention.”
            </span>
          </li>
        </ol>
        <p className="empty-wait" aria-live="polite">
          {latest ? (
            <>
              <span className="change-dot" aria-hidden="true" />
              <span>
                Last write by {props.who?.name ?? latest.actor}, {agoWords(latest.ts, props.now)}
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
      </section>
      <p className="empty-more">
        <a href={urls.transfer()}>Import a bundle</a> ·{" "}
        <a href={urls.connect()}>Other ways to connect</a>
      </p>
    </>
  );
}
