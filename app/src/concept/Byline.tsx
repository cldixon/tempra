import { useState } from "react";
import type { ActedBy, ActorView } from "../agents";
import { warmth } from "../changes";
import { Avatar, Icon, Menu } from "../chrome";
import { Dialog } from "../Dialog";
import { day, plural, recently, useAgo } from "../ui";
import type { Urls } from "../urls";
import { actedBy, type Concept, type HistoryEvent, type Standing, standing } from "./data";
import { AllVersions } from "./History";

/** Names an actor (an agent for its person, the signed-in person as "You"). */
export type Namer = (actor: string, by?: ActedBy | null) => ActorView;

/**
 * The concept's byline (take 3; tempra-dev: app/reader, The byline): who wrote the version on
 * screen and when, its versions (the history menu), and on the right where it stands with the
 * reader: verified, changed since, or not yet verified, with Review when there is something to
 * review.
 */
export function Byline(props: {
  urls: Urls;
  concept: Concept;
  history: HistoryEvent[];
  head: number;
  name: Namer;
  /** The page is current (not a pinned old version), so it can be reviewed. */
  current: boolean;
  /** The page is in review mode already (its bar has Verify): no Review button. */
  reviewing: boolean;
}) {
  const { urls, concept: c, name } = props;
  const s = standing(props.history, c.seq);
  const author = s.current?.event;
  const who = author ? name(author.actor, actedBy(author)) : null;
  const ago = useAgo(author?.ts ?? new Date().toISOString());
  const [now] = useState(() => Date.now());
  const warm = who?.agent && author ? warmth({ at: Date.parse(author.ts) }, now) : null;
  const toReview = s.verified === null || s.since > 0;
  return (
    <div className="byline">
      <div className="byline-who">
        {who && (
          <>
            <Avatar name={who.name} agent={who.agent} />
            <span className="byline-name">
              <strong>{who.name}</strong>
              {who.for && <span className="muted"> for {who.for}</span>}
            </span>
            {warm && (
              <span className={`change-dot ${warm}`} title="Changed by an agent lately">
                <span className="visually-hidden">Changed by an agent lately</span>
              </span>
            )}
            <span className="byline-sep" aria-hidden="true">
              ·
            </span>
            <span className="muted">updated {ago} ago</span>
            <span className="byline-sep" aria-hidden="true">
              ·
            </span>
          </>
        )}
        <HistoryMenu
          urls={urls}
          concept={c}
          standing={s}
          name={name}
          head={props.head}
          history={props.history}
        />
      </div>
      <div className="byline-state">
        <Verification urls={urls} concept={c} standing={s} name={name} current={props.current} />
        {props.current && toReview && !props.reviewing && (
          <a className="button primary" href={urls.review(c.path)}>
            Review
          </a>
        )}
      </div>
    </div>
  );
}

/** "Verified by you, Oct 9", "2 changes since you verified", "Not yet verified". */
function Verification(props: {
  urls: Urls;
  concept: Concept;
  standing: Standing;
  name: Namer;
  current: boolean;
}) {
  const { urls, concept: c, standing: s, name } = props;
  const v = s.verified;
  const by = v ? name(v.event.actor, actedBy(v.event)) : null;
  const whom = by?.you ? "you" : by?.name;
  const words =
    !v || !by
      ? "Not yet verified"
      : s.since === 0
        ? `Verified by ${whom}, ${day(v.event.ts)}`
        : `${plural(s.since, "change")} since ${whom} verified`;
  const mark = v && s.since === 0 ? "verified" : "unverified";
  const content = (
    <>
      <span className={`state-mark ${mark}`} aria-hidden="true" />
      {words}
    </>
  );
  // The state itself opens review, as the button does, when there is something to review.
  return props.current && mark === "unverified" ? (
    <a className="verification" href={urls.review(c.path)}>
      {content}
    </a>
  ) : (
    <span className="verification">{content}</span>
  );
}

/**
 * "6 versions": the history menu under the byline. Its first line is the last verification; then
 * the latest versions, each opening the changes since it in place; then all of them.
 */
function HistoryMenu(props: {
  urls: Urls;
  concept: Concept;
  standing: Standing;
  history: HistoryEvent[];
  head: number;
  name: Namer;
}) {
  const { urls, concept: c, standing: s, name } = props;
  const [all, setAll] = useState(false);
  const latest = [...s.versions].reverse().slice(0, 5);
  const v = s.verified;
  const verifier = v ? name(v.event.actor, actedBy(v.event)) : null;
  return (
    <>
      <Menu
        label={plural(s.versions.length, "version")}
        buttonClass="byline-versions"
        title="History"
      >
        <div className="history-head">
          {v && verifier
            ? `Verified by ${verifier.you ? "you" : verifier.name} on ${day(v.event.ts)}${v.version ? `, at version ${v.version.n}` : ""}`
            : "Not yet verified by a person"}
        </div>
        {latest.map((version) => {
          const e = version.event;
          const who = name(e.actor, actedBy(e));
          const note = typeof e.meta?.note === "string" ? e.meta.note : "";
          const isCurrent = e.seq === s.current?.event.seq;
          return (
            <a
              key={e.seq}
              className={isCurrent ? "history-row current" : "history-row"}
              href={isCurrent ? urls.pinned(undefined).file(c.path) : urls.since(c.path, e.seq)}
              title={isCurrent ? "The version on screen" : `Changes since version ${version.n}`}
            >
              <span className="history-n">{version.n}</span>
              <span className="history-what">
                <span className="history-who">{who.name}</span>
                {note && <span className="history-note">{note}</span>}
              </span>
              <span className="history-when">
                <When ts={e.ts} />
              </span>
            </a>
          );
        })}
        <button type="button" className="history-all" onClick={() => setAll(true)}>
          <Icon name="history" size={14} /> All versions
        </button>
      </Menu>
      <Dialog title="All versions" open={all} onClose={() => setAll(false)} wide>
        <AllVersions urls={urls} concept={c} head={props.head} events={props.history} name={name} />
      </Dialog>
    </>
  );
}

/** "14 min" within a day, else the day. */
function When({ ts }: { ts: string }) {
  const ago = useAgo(ts);
  return <time dateTime={ts}>{Date.now() - Date.parse(ts) < 86_400_000 ? ago : day(ts)}</time>;
}
