import { useState } from "react";
import { actorText } from "../agents";
import { Moment } from "../Moment";
import type { Urls } from "../urls";
import type { Namer } from "./Byline";
import { actedBy, type Concept, type Standing, type Version } from "./data";

/** How many versions the History panel lists at first, and adds with each "older versions". */
const PAGE = 10;

/**
 * Where a version in History leads: that version as it was (`?at=`, or the plain page for the
 * latest) with what it changed drawn in its text, the word diff from the version before it
 * (`?since=`); the first version has nothing before it and opens as it was. History stays open.
 */
export function versionHref(urls: Urls, path: string, versions: Version[], n: number): string {
  const i = versions.findIndex((v) => v.n === n);
  const version = versions[i];
  if (!version) return urls.pinned(undefined).file(path);
  const latest = i === versions.length - 1;
  const page = urls.pinned(latest ? undefined : version.event.seq).file(path);
  const before = versions[i - 1];
  const params = new URLSearchParams();
  if (before) params.set("since", String(before.event.seq));
  params.set("panel", "history");
  return `${page}${page.includes("?") ? "&" : "?"}${params}`;
}

/**
 * The History panel (take 4, TEMPRA-114; tempra-dev: app/reader, The panels): the concept's
 * versions, newest first (number, note, who and when). Each opens that version with what it
 * changed drawn in its text (`versionHref`). Verification is in Properties, not here
 * (decisions/verification-out-of-the-way).
 */
export function HistoryList(props: {
  urls: Urls;
  concept: Concept;
  standing: Standing;
  name: Namer;
  /** Whether the version on screen has its changes drawn (`?since=`). */
  comparing: boolean;
}) {
  const { urls, concept: c, standing: s, name } = props;
  const [shown, setShown] = useState(PAGE);
  const versions = [...s.versions].reverse();
  const older = versions.length - shown;
  return (
    <>
      <ol className="versions">
        {versions.slice(0, shown).map((version) => {
          const e = version.event;
          const who = name(e.actor, actedBy(e));
          const note = typeof e.meta?.note === "string" ? e.meta.note : "";
          const onScreen = e.seq === s.current?.event.seq;
          const chosen = onScreen && props.comparing;
          return (
            <li key={e.seq}>
              <a
                className={chosen ? "version chosen" : onScreen ? "version current" : "version"}
                href={versionHref(urls, c.path, s.versions, version.n)}
                aria-current={onScreen ? "true" : undefined}
                title={version.n === 1 ? "The first version" : `What version ${version.n} changed`}
              >
                <span className="version-n">v{version.n}</span>
                <span className="version-what">
                  <span className="version-note">
                    {note || (version.n === 1 ? "Created" : "Edited")}
                  </span>
                  <span className="version-who">
                    {actorText(who)} · <Moment ts={e.ts} />
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
