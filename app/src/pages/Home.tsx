import type { ReactNode } from "react";
import {
  agoWords,
  EntryRow,
  entryTime,
  type LedgerRequest,
  momentText,
  toEntry,
  useNow,
  useTitles,
  whoWorksHere,
} from "../activity";
import { type Contributor, useActors } from "../agents";
import { api, useLoad } from "../api";
import { Avatar, type Glyph, Icon } from "../chrome";
import { useFeed, useLastSeen, useTrailing } from "../live";
import { type Needs, useNeeds } from "../needs";
import { clip, day, plural, Status, useMe, useTitle } from "../ui";
import type { Urls } from "../urls";
import { SheetPage } from "../Workspace";

/** How many entries "Since you last looked" shows, and how many requests it reads for them. */
const SINCE = 5;
const READ = 20;

/** Avatars in the header before the rest are left to the words. */
const FACES = 4;

/**
 * The library's home (take 3, TEMPRA-106; tempra-dev: app/home): its name, who works here, the
 * first few things that need the person, and what happened since they last looked. Quiet on
 * purpose. It does not move the seen cursor: Activity does.
 */
export function Home({ urls }: { urls: Urls }) {
  useTitle(urls.slug);
  const me = useMe();
  const loaded = useLoad(`home ${urls.base}`, async () => {
    const summary = await api<{ seq: number; concepts: number }>(urls.api("summary"));
    const page = await api<{ requests: LedgerRequest[] }>(urls.api("requests", { limit: READ }));
    return { head: summary.seq, concepts: summary.concepts, requests: page.requests };
  });
  const reload = useTrailing(loaded.reload, 1500);
  useFeed(urls, loaded.state === "ready" ? loaded.data.head : null, reload, reload);
  return (
    <SheetPage>
      <Status loaded={loaded}>
        {(home) => (
          <>
            <HomeHead
              urls={urls}
              me={me?.actor ?? null}
              concepts={home.concepts}
              latest={home.requests[0]}
            />
            <NeedsSection urls={urls} me={me?.actor ?? null} />
            <SinceSection urls={urls} me={me?.actor ?? null} requests={home.requests} />
          </>
        )}
      </Status>
    </SheetPage>
  );
}

/** The title, then one quiet line: who works here, how many concepts, when it last changed. */
function HomeHead(props: {
  urls: Urls;
  me: string | null;
  concepts: number;
  latest: LedgerRequest | undefined;
}) {
  const { urls, me } = props;
  const actors = useActors(urls, me);
  const now = useNow();
  const handle = me?.replace(/^human:/, "") ?? null;
  const people = actors.contributors.filter((c) => !c.agent && c.person);
  const agents = actors.contributors.filter((c) => c.agent);
  const you = people.some((c) => c.person === handle);
  const others = people.filter((c) => c.person !== handle).length;
  // The person first, then whoever acted most recently (the list comes newest first).
  const faces: Contributor[] = [
    ...people.filter((c) => c.person === handle),
    ...actors.contributors.filter((c) => c.person !== handle || c.agent),
  ].slice(0, FACES);
  const changed = props.latest?.events.at(-1)?.ts ?? props.latest?.ts;
  return (
    <header className="view-head home-head">
      <div className="view-head-main">
        <h1 className="view-title">{urls.slug}</h1>
        <p className="view-meta home-who">
          {faces.length > 0 && (
            <span className="face-stack">
              {faces.map((c) => (
                <Avatar
                  key={`${c.person}/${c.agent?.id ?? ""}`}
                  name={c.agent ? (c.agent.name ?? c.actor) : (c.person ?? "?")}
                  agent={!!c.agent}
                />
              ))}
            </span>
          )}
          <span>
            {whoWorksHere(you, others, agents.length)} · {plural(props.concepts, "concept")}
            {changed && ` · updated ${agoWords(changed, now)}`}
          </span>
        </p>
      </div>
    </header>
  );
}

/** A section of the home: its heading, something beside it, a link to the full view. */
function HomeSection(props: {
  id: string;
  title: string;
  beside?: ReactNode;
  link?: { href: string; label: string };
  children: ReactNode;
}) {
  return (
    <section className="home-section" aria-labelledby={props.id}>
      <div className="view-section-head">
        <h2 id={props.id} className="view-section-title">
          {props.title}
        </h2>
        {props.beside}
        {props.link && (
          <a className="view-aside" href={props.link.href}>
            {props.link.label}
          </a>
        )}
      </div>
      {props.children}
    </section>
  );
}

/** One thing that needs the person, as a row linking to where they do it. */
interface NeedRow {
  key: string;
  icon: Glyph;
  href: string;
  line: ReactNode;
  detail: string | null;
  when: string;
}

/** A sentence's quote, on one line and kept short. */

/** "goes stale in 6 days", "is stale". */
function staleWords(iso: string, now: number): string {
  const days = Math.ceil((Date.parse(iso) - now) / 86_400_000);
  if (days <= 0) return "is stale";
  return days === 1 ? "goes stale tomorrow" : `goes stale in ${days} days`;
}

/** The first three things on the Needs you page, in its order: replies, verifying, staleness. */
function NeedsSection({ urls, me }: { urls: Urls; me: string | null }) {
  const loaded = useNeeds(urls);
  const actors = useActors(urls, me);
  const now = useNow();
  const rows = (needs: Needs): NeedRow[] => {
    const out: NeedRow[] = needs.replies.map((r) => {
      const by = actors.view(r.last.actor, r.last.by);
      return {
        key: `reply ${r.thread}`,
        icon: "comments",
        href: urls.thread(r.path, r.thread),
        line: (
          <>
            {/* The thread may be theirs or a reply to the person's: "commented" fits both. */}
            <b className="entry-who">{by.name}</b> commented on{" "}
            <b className="entry-who">{r.title ?? r.path}</b>
          </>
        ),
        detail: r.last.body ? `“${clip(r.last.body, 140)}”` : null,
        when: entryTime(r.last.ts, now, true),
      };
    });
    const v = needs.verify;
    const first = v.items[0];
    if (v.total > 0 && first) {
      const titles = v.items.slice(0, 4).map((i) => i.title ?? i.path);
      const rest = v.total - titles.length;
      out.push({
        key: "verify",
        icon: "needs",
        href: v.total === 1 ? urls.review(first.path) : urls.needs(),
        line: `${plural(v.total, "change")} to verify`,
        detail: titles.join(" · ") + (rest > 0 ? ` · ${rest} more` : ""),
        when: entryTime(first.ts, now, true),
      });
    }
    for (const s of needs.stale) {
      out.push({
        key: `stale ${s.path}`,
        icon: "stale",
        href: urls.file(s.path),
        line: `${s.title ?? s.path} ${staleWords(s.stale_after, now)}`,
        detail: "Ask an agent to review it.",
        when: day(s.stale_after),
      });
    }
    return out.slice(0, 3);
  };
  return (
    <HomeSection
      id="home-needs"
      title="Needs you"
      link={
        loaded.state === "ready" && loaded.data.count > 0
          ? { href: urls.needs(), label: `All ${loaded.data.count}` }
          : undefined
      }
    >
      <Status loaded={loaded}>
        {(needs) => {
          const list = rows(needs);
          if (list.length === 0) return <p className="view-empty">Nothing needs you here.</p>;
          return (
            <ul className="need-rows">
              {list.map((r) => (
                <li key={r.key}>
                  <a className="need-row" href={r.href}>
                    <Icon name={r.icon} />
                    <span className="need-text">
                      <span className="need-line">{r.line}</span>
                      {r.detail && <span className="need-detail">{r.detail}</span>}
                    </span>
                    <span className="need-when">{r.when}</span>
                  </a>
                </li>
              ))}
            </ul>
          );
        }}
      </Status>
    </HomeSection>
  );
}

/** The latest few Activity entries after the seen cursor, with the cursor's time. */
function SinceSection(props: { urls: Urls; me: string | null; requests: LedgerRequest[] }) {
  const { urls } = props;
  const seen = useLastSeen(urls);
  const titles = useTitles(urls);
  const actors = useActors(urls, props.me);
  const now = useNow();
  // When the person last looked: the time of the event at their cursor.
  const at = useLoad(`seen-at ${urls.base} ${seen}`, async () => {
    if (seen === null || seen < 1) return null;
    const r = await api<{ events: { ts: string }[] }>(
      urls.api("events", { since: seen - 1, limit: 1 }),
    );
    return r.events[0]?.ts ?? null;
  });
  const names = titles.state === "ready" ? titles.data.titles : {};
  const fresh = props.requests
    .filter((r) => seen === null || (r.events[0]?.seq ?? 0) > seen)
    .slice(0, SINCE)
    .map((r) => toEntry(r, names))
    .filter((e) => e !== null);
  const looked = at.state === "ready" && at.data ? momentText(at.data, now) : null;
  return (
    <HomeSection
      id="home-since"
      title="Since you last looked"
      beside={looked && <span className="view-meta">{looked}</span>}
      link={{ href: urls.activity(), label: "Activity" }}
    >
      {fresh.length === 0 ? (
        <p className="view-empty">Nothing new since you last looked.</p>
      ) : (
        <div className="home-entries">
          {fresh.map((e) => (
            <EntryRow
              key={e.id}
              entry={e}
              urls={urls}
              actor={actors.view(e.actor, e.by)}
              now={now}
              isNew={false}
              compact
            />
          ))}
        </div>
      )}
    </HomeSection>
  );
}
