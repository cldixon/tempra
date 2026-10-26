import { byPerson, type LedgerRequest, useNow, whoWorksHere } from "../activity";
import { type ActedBy, type ActorView, actorAgentName, actorText, useActors } from "../agents";
import { api, useLoad } from "../api";
import { Icon } from "../chrome";
import { useFeed, useTrailing } from "../live";
import { Moment } from "../Moment";
import { libraryLabel, type Role, useLibraries, useRole } from "../role";
import { fileLabel, type OutlineFile } from "../Tree";
import { clip, plural, Status, useCopy, useMe, useTitle } from "../ui";
import { dirOf, folderName, type Urls } from "../urls";
import { PageColumn, useFrame } from "../Workspace";

/** The requests read for Recently changed and the empty library's line. */
const READ = 20;

/** How many pages Recently changed lists. */
const RECENT = 5;

/**
 * The library's home (take 4, TEMPRA-117, TEMPRA-121; tempra-dev: app/home): its title and
 * description, one quiet line (who works here, the page count, the guide), and the pages changed
 * most recently. No sections: the tree beside it lists the folders (TEMPRA-138); no housekeeping,
 * which is the agents' (TEMPRA-144); no notifications, which are the Inbox's, and no "since you
 * last looked", which is Activity's to show when asked (TEMPRA-173). An empty library shows how to
 * connect an agent instead (to those who can). Each part loads on its own, so one that fails
 * leaves the rest (H-7).
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
  const reload = useTrailing(loaded.reload, 1500);
  useFeed(urls, loaded.state === "ready" ? loaded.data.head : null, reload, reload);
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
          const who =
            people === null ? null : whoWorksHere(you, people.length - (you ? 1 : 0), agents);
          const meta = [who, plural(home.concepts, "page")].filter((p): p is string => p !== null);
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
                  {files !== null && (
                    <RecentlyChanged
                      urls={urls}
                      changed={recentlyChanged(home.requests, files)}
                      view={(a, by) => actors.view(a, by)}
                    />
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
