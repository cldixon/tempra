import { useState } from "react";
import { recently, useAgo } from "../ui";
import type { Urls } from "../urls";
import type { Namer } from "./Byline";
import { actedBy, type Concept, type Standing } from "./data";

/** How many versions the History panel lists at first, and adds with each "older versions". */
const PAGE = 10;

/**
 * The History panel (take 4, TEMPRA-114; tempra-dev: app/reader, The panels): the concept's
 * versions, newest first (number, note, who and when). Each opens what it changed in the text
 * (`?since=`, the word diff to the version on screen); the version on screen goes back to the
 * latest. Verification is in Properties, not here (decisions/verification-out-of-the-way).
 */
export function HistoryList(props: {
  urls: Urls;
  concept: Concept;
  standing: Standing;
  name: Namer;
  /** The version whose changes are drawn (`?since=`), if any. */
  since: number | null;
}) {
  const { urls, concept: c, standing: s, name } = props;
  const [shown, setShown] = useState(PAGE);
  const versions = [...s.versions].reverse();
  const older = versions.length - shown;
  const latest = urls.pinned(undefined).file(c.path);
  return (
    <>
      <ol className="versions">
        {versions.slice(0, shown).map((version) => {
          const e = version.event;
          const who = name(e.actor, actedBy(e));
          const note = typeof e.meta?.note === "string" ? e.meta.note : "";
          const isCurrent = e.seq === s.current?.event.seq;
          const chosen = props.since === e.seq;
          return (
            <li key={e.seq}>
              <a
                className={chosen ? "version chosen" : isCurrent ? "version current" : "version"}
                href={isCurrent ? latest : urls.since(c.path, e.seq)}
                aria-current={chosen ? "true" : undefined}
                title={isCurrent ? "The version on screen" : `What version ${version.n} changed`}
              >
                <span className="version-n">v{version.n}</span>
                <span className="version-what">
                  <span className="version-note">{note || (isCurrent ? "Latest" : "No note")}</span>
                  <span className="version-who">
                    {who.name}
                    {who.for && ` for ${who.for}`} · <When ts={e.ts} />
                  </span>
                </span>
              </a>
            </li>
          );
        })}
      </ol>
      {older > 0 && (
        <button
          type="button"
          className="ghost older-versions"
          onClick={() => setShown((n) => n + PAGE)}
        >
          {older} older version{older === 1 ? "" : "s"}
        </button>
      )}
    </>
  );
}

/** "14 min" within a day, else the day; kept current as time passes. */
function When({ ts }: { ts: string }) {
  useAgo(ts);
  return <time dateTime={ts}>{recently(ts, Date.now())}</time>;
}
