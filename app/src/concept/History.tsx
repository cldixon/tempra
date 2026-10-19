import { useState } from "react";
import { Ago, ago, when } from "../ui";
import type { Urls } from "../urls";
import type { Namer } from "./Byline";
import { actedBy, CONTENT_OPS, type Concept, type HistoryEvent, standing } from "./data";

/**
 * Every event of the concept, newest first (the history menu's "All versions"): each version
 * with its number, who and why, a link to read it as it was and to its diff; verifications and
 * moves between them. The ledger and the raw file are linked at the foot, and on a pinned old
 * version, Restore.
 */
export function AllVersions(props: {
  urls: Urls;
  concept: Concept;
  head: number;
  events: HistoryEvent[];
  name: Namer;
}) {
  const { urls, concept: c, head, name } = props;
  // Comments are in the margin; history is the concept's versions and what happened to them.
  const events = props.events.filter((e) => e.op !== "comment");
  const numbers = new Map(standing(events, head).versions.map((v) => [v.event.seq, v.n]));
  const shown = [...events].reverse().slice(0, 100);
  const pinnedOld = urls.at !== undefined && urls.at < head;
  const [now] = useState(() => Date.now());
  return (
    <>
      <ol className="history">
        {shown.map((e) => {
          const note = typeof e.meta?.note === "string" ? e.meta.note : "";
          const from = typeof e.meta?.from_path === "string" ? `from ${e.meta.from_path}` : "";
          const n = numbers.get(e.seq);
          const what =
            e.op === "verify" ? "verified" : e.op === "move" ? "moved" : n ? `version ${n}` : e.op;
          const classes = [e.seq === c.seq ? "current" : "", e.op === "verify" ? "verify" : ""];
          return (
            <li key={e.seq} className={classes.filter(Boolean).join(" ") || undefined}>
              <span className="history-what">
                {e.op === "delete" ? (
                  what
                ) : (
                  <a href={urls.pinned(e.seq).file(e.path)} title="Read this version as it was">
                    {what}
                  </a>
                )}{" "}
                <span className="history-who">{name(e.actor, actedBy(e)).name}</span>
                {(note || from) && (
                  <span className="history-note">{[from, note].filter(Boolean).join(" · ")}</span>
                )}
              </span>
              <span className="history-when">
                {CONTENT_OPS.has(e.op) ? (
                  <a href={urls.diff(e.path, undefined, e.seq)} title={`Diff · ${when(e.ts)} UTC`}>
                    {ago(e.ts, now)}
                  </a>
                ) : (
                  <Ago ts={e.ts} now={now} />
                )}
              </span>
            </li>
          );
        })}
      </ol>
      {events.length > shown.length && (
        <p className="small muted">{events.length - shown.length} older events not shown.</p>
      )}
      <p className="dialog-foot">
        <a href={urls.ledger({ prefix: c.path })}>All {events.length} in the ledger</a>
        <a href={urls.raw(c.path)}>Raw file</a>
        {pinnedOld && (
          <>
            <a href={urls.pinned(undefined).file(c.path)}>Current version</a>
            <a href={urls.restore(c.path, urls.at as number)}>Restore this version…</a>
          </>
        )}
      </p>
    </>
  );
}
