import { type ReactNode, useEffect, useRef, useState } from "react";
import { type ActorView, useActors } from "../agents";
import { api, useAction, useLoad } from "../api";
import { Avatar } from "../chrome";
import { type Needs, useNeeds } from "../needs";
import { Ago, ago, calendarDay, clip, day, plural, Status, useMe, useTitle, who } from "../ui";
import type { Urls } from "../urls";
import { SheetPage } from "../Workspace";

/*
 * Needs you (take 3, TEMPRA-106; tempra-dev: app/needs-you): what only a person can do in a
 * library, from `GET …/needs`. It replaces the work queue as the person's view; the agents' share
 * of the queue is one collapsed line. useNeeds follows the feed, so the page stays current.
 */

/** Concepts to verify per page, as the server pages them by default. */
const PAGE = 20;

type View = (actor: string, by?: Needs["replies"][number]["last"]["by"]) => ActorView;

export function NeedsYou({ urls }: { urls: Urls }) {
  useTitle(`Needs you · ${urls.slug}`);
  const me = useMe();
  const actors = useActors(urls, me?.actor ?? null);
  const loaded = useNeeds(urls);
  return (
    <SheetPage>
      <div className="needs">
        <header className="view-head">
          <div className="view-head-main">
            <h1 className="view-title">Needs you</h1>
            <p className="view-meta">
              What only a person can do here: answer, verify, decide. Agents look after the rest.
            </p>
          </div>
        </header>
        <Status loaded={loaded}>
          {(needs) => (
            <NeedsBody
              urls={urls}
              needs={needs}
              view={actors.view}
              me={me?.actor ?? null}
              reload={loaded.reload}
            />
          )}
        </Status>
      </div>
    </SheetPage>
  );
}

/** The page under its header, for given needs (exported for tests). */
export function NeedsBody(props: {
  urls: Urls;
  needs: Needs;
  view: View;
  me: string | null;
  reload(): void;
}) {
  const { urls, needs, view } = props;
  const now = Date.now();
  const nothing =
    needs.replies.length === 0 && needs.verify.total === 0 && needs.stale.length === 0;
  return (
    <>
      {nothing && <p className="needs-empty">Nothing needs you right now.</p>}
      {needs.replies.length > 0 && (
        <Section id="needs-replies" title="Waiting on your reply" count={needs.replies.length}>
          <ul className="needs-box">
            {needs.replies.map((r) => (
              <ReplyRow key={r.thread} urls={urls} reply={r} view={view} now={now} />
            ))}
          </ul>
        </Section>
      )}
      {needs.verify.total > 0 && (
        <ToVerify urls={urls} needs={needs} view={view} me={props.me} now={now} />
      )}
      {needs.stale.length > 0 && (
        <Section id="needs-stale" title="Going stale" count={needs.stale.length}>
          <ul className="needs-box">
            {needs.stale.map((s) => (
              <StaleRow key={s.path} urls={urls} item={s} onAsked={props.reload} />
            ))}
          </ul>
        </Section>
      )}
      {needs.unverified.total > 0 && <NotYetVerified total={needs.unverified.total} />}
      {needs.housekeeping.total > 0 && <Housekeeping urls={urls} counts={needs.housekeeping} />}
    </>
  );
}

/** A section's heading with its count beside it, and an optional note after. */
function Section(props: {
  id: string;
  title: string;
  count: number;
  note?: string;
  children: ReactNode;
}) {
  return (
    <section className="needs-section" aria-labelledby={props.id}>
      <div className="needs-section-head">
        <h2 id={props.id}>
          {props.title} <span className="needs-count">· {props.count}</span>
        </h2>
        {props.note && <span className="needs-note">{props.note}</span>}
      </div>
      {props.children}
    </section>
  );
}

/** Who acted, as a row names them: "Claude Code for @cl_dixon", "You", "ann". */
function Who({ actor }: { actor: ActorView }) {
  return (
    <>
      <b>{actor.name}</b>
      {actor.for && <span className="needs-for"> for {actor.for}</span>}
    </>
  );
}

/** A thread where someone else spoke last: whose words, on which concept, and where in it. */
function ReplyRow(props: { urls: Urls; reply: Needs["replies"][number]; view: View; now: number }) {
  const { reply } = props;
  const actor = props.view(reply.last.actor, reply.last.by);
  const title = reply.title ?? reply.path;
  return (
    <li>
      <a className="needs-row needs-reply" href={props.urls.thread(reply.path, reply.thread)}>
        <Avatar name={actor.agent ? actor.name : who(reply.last.actor)} agent={actor.agent} />
        <span className="needs-main">
          <span>
            <Who actor={actor} /> on <b>{title}</b>: "{clip(reply.last.body, 140)}"
          </span>
          <span className="needs-meta">
            {reply.quote ? `Thread on "${clip(reply.quote, 60)}"` : "Thread on the whole concept"}
          </span>
        </span>
        <span className="needs-when">
          <Ago ts={reply.last.ts} now={props.now} />
        </span>
      </a>
    </li>
  );
}

/**
 * Concepts changed since a person verified them. The first page comes with the needs; "More"
 * loads the rest in place, and what it loaded is asked again when the needs change.
 */
function ToVerify(props: { urls: Urls; needs: Needs; view: View; me: string | null; now: number }) {
  const { urls, needs } = props;
  const [pages, setPages] = useState(0);
  const more = useLoad(`needs-more ${urls.base} ${pages}`, () =>
    pages === 0
      ? Promise.resolve(null)
      : api<Needs>(urls.api("needs", { offset: PAGE, limit: PAGE * pages })),
  );
  // A write changed the needs: the extra pages follow.
  const seq = useRef(needs.seq);
  useEffect(() => {
    if (seq.current === needs.seq) return;
    seq.current = needs.seq;
    if (pages > 0) more.reload();
  }, [needs.seq, pages, more.reload]);
  // What the last page load showed stays while the next, longer one loads (no rows vanish).
  const shown = useRef<Needs["verify"] | null>(null);
  if (more.state === "ready") shown.current = more.data?.verify ?? null;
  const extra = shown.current;
  // Pages are read at different moments: a concept that moved up is shown once.
  const byPath = new Map<string, Needs["verify"]["items"][number]>();
  for (const v of [...needs.verify.items, ...(extra?.items ?? [])]) {
    if (!byPath.has(v.path)) byPath.set(v.path, v);
  }
  const items = [...byPath.values()];
  const next = pages === 0 ? needs.verify.next_offset : (extra?.next_offset ?? null);
  const loading = pages > 0 && more.state === "loading";
  return (
    <Section
      id="needs-verify"
      title="To verify"
      count={needs.verify.total}
      note="changed since a person verified them"
    >
      <ul className="needs-box">
        {items.map((v) => (
          <VerifyRow
            key={v.path}
            urls={urls}
            item={v}
            view={props.view}
            me={props.me}
            now={props.now}
          />
        ))}
      </ul>
      {(next !== null || loading) && (
        <button
          type="button"
          className="needs-more"
          disabled={loading}
          onClick={() => setPages((p) => p + 1)}
        >
          {loading ? "Loading…" : "More"}
        </button>
      )}
      {more.state === "error" && <p className="needs-error">{more.error.message}</p>}
    </Section>
  );
}

/** "2 changes since you verified on Oct 5". */
function sinceVerified(item: Needs["verify"]["items"][number], me: string | null): string {
  const by = item.verified.actor === me ? "you" : `@${who(item.verified.actor)}`;
  return `${plural(item.changes, "change")} since ${by} verified on ${day(item.verified.ts)}`;
}

function VerifyRow(props: {
  urls: Urls;
  item: Needs["verify"]["items"][number];
  view: View;
  me: string | null;
  now: number;
}) {
  const { item } = props;
  const actor = props.view(item.actor, item.by);
  return (
    <li className="needs-row needs-verify">
      <span className="needs-main">
        <a className="needs-title" href={props.urls.file(item.path)}>
          {item.title ?? item.path}
        </a>
        <span className="needs-meta">{sinceVerified(item, props.me)}</span>
      </span>
      <span className="needs-by">
        {actor.name} · {ago(item.ts, props.now)}
      </span>
      <a className="button" href={props.urls.review(item.path)}>
        Review
      </a>
    </li>
  );
}

/** Concepts asked about in this page load, so the row says so until it leaves the list. */
const asked = new Set<string>();

/**
 * A concept stale or going stale. "Ask an agent to review" leaves a comment on the concept: open
 * threads are work for agents, and their reply comes back here as a thread waiting on the person.
 * ("Still true" waits for a human path to set `stale_after`.)
 */
function StaleRow(props: { urls: Urls; item: Needs["stale"][number]; onAsked(): void }) {
  const { urls, item } = props;
  const key = `${urls.base}${item.path}`;
  const [done, setDone] = useState(asked.has(key));
  const action = useAction();
  const date = calendarDay(item.stale_after);
  const ask = () =>
    action.run(async () => {
      const body =
        item.stale === "stale"
          ? `Please review this: it went stale on ${date}.`
          : `Please review this: it goes stale on ${date}.`;
      await api(urls.api("comments"), {
        method: "POST",
        body: JSON.stringify({ path: item.path, body, anchor: null }),
      });
      asked.add(key);
      setDone(true);
      props.onAsked();
    });
  return (
    <li className="needs-row needs-stale">
      <span className="needs-main">
        <a className="needs-title" href={urls.file(item.path)}>
          {item.title ?? item.path}
        </a>
        <span className="needs-meta">
          {item.stale === "stale" ? `Went stale on ${date}.` : `Its review date is ${date}.`}
        </span>
        {action.error && <span className="needs-error">{action.error}</span>}
      </span>
      {done ? (
        <span className="needs-asked">Asked an agent</span>
      ) : (
        <button type="button" disabled={action.busy} onClick={ask}>
          Ask an agent to review
        </button>
      )}
    </li>
  );
}

/**
 * Concepts no person has verified (TEMPRA-111): a standing, not a request. A library an agent has
 * just built is all of them, so they are counted on one collapsed line, outside the sidebar's count.
 */
function NotYetVerified({ total }: { total: number }) {
  return (
    <details className="needs-counted needs-unverified">
      <summary>
        Not yet verified · {plural(total, "concept")}. Verify them as you come to rely on them.
      </summary>
      <p>Each folder shows which of its concepts a person has verified.</p>
    </details>
  );
}

/** The agents' share of the work queue: counted, collapsed, nothing for the person to do. */
function Housekeeping(props: { urls: Urls; counts: Needs["housekeeping"] }) {
  const c = props.counts;
  const kinds = [
    c.structure > 0 && `${c.structure} structure`,
    c.lint > 0 && `${c.lint} lint`,
    c.broken_link > 0 && plural(c.broken_link, "broken link"),
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <details className="needs-counted needs-housekeeping">
      <summary>
        Agents' housekeeping · {plural(c.total, "item")} ({kinds}). You don't need to act.
      </summary>
      <p>
        Agents fix these as they work. <a href={props.urls.work()}>The work queue</a> lists them.
      </p>
    </details>
  );
}
