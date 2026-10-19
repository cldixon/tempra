import { useCallback, useEffect, useState } from "react";
import { useAgentNames } from "../agents";
import { Icon, Menu } from "../chrome";
import { type FeedEvent, useFeed } from "../live";
import { useAgo } from "../ui";
import { dirOf, type Urls } from "../urls";
import { CONTENT_OPS, type FileData } from "./data";

/*
 * Live (tempra-dev: app/live): someone else's change to the open file shows as a pulsing glyph
 * beside the page's controls, and the new version swaps in by itself only while the reader is
 * idle. A move or a delete is a notice in the sheet instead. Pinned versions stay put.
 */

/**
 * Follows the open file on the change feed: someone else's change to it (null when there is
 * none), and its comments' changes (`onComment`). The change swaps in once the reader is idle.
 */
export function useLiveFile(
  urls: Urls,
  shown: FileData | null,
  actor: string,
  reload: () => void,
  onComment: () => void,
): Live | null {
  const [change, setChange] = useState<FeedEvent | null>(null);
  const swap = useCallback(() => {
    setChange(null);
    reload();
  }, [reload]);
  useFeed(
    urls,
    urls.at === undefined && shown ? shown.head : null,
    (events) => {
      if (urls.at !== undefined || !shown) return;
      const path = shown.file.path;
      if (events.some((e) => e.op === "comment" && e.path === path)) onComment();
      const mine = events.filter(
        (e) =>
          e.seq > shown.head &&
          (e.path === path || e.from_path === path) &&
          e.op !== "comment" &&
          e.actor !== actor,
      );
      const last = mine[mine.length - 1];
      if (last) setChange(last);
    },
    swap,
  );
  // A page drawn from the cache catches up in the background: a change it now shows is no news.
  useEffect(() => {
    if (change && shown && change.seq <= shown.head) setChange(null);
  }, [change, shown]);
  const idle = useIdle(15_000);
  const swappable = change !== null && change.op !== "delete" && change.op !== "move";
  useEffect(() => {
    if (swappable && idle) swap();
  }, [swappable, idle, swap]);
  return change && shown ? { change, shownSeq: shown.file.seq, onSwap: swap } : null;
}

/** Someone else's change to the open file, as the page shows it. */
export interface Live {
  change: FeedEvent;
  /** The sequence of the version on screen, for the diff. */
  shownSeq: number;
  onSwap(): void;
}

/**
 * True once the person has not scrolled, typed, clicked or selected text for `ms`: the moment a
 * new version may replace what they are reading without pulling it from under them.
 */
export function useIdle(ms: number): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    let last = Date.now();
    const busy = () => {
      last = Date.now();
      setIdle(false);
    };
    const kinds = ["scroll", "wheel", "keydown", "pointerdown", "selectionchange"] as const;
    for (const k of kinds) document.addEventListener(k, busy, { passive: true, capture: true });
    const timer = setInterval(() => {
      const selecting = !(document.getSelection()?.isCollapsed ?? true);
      setIdle(!selecting && Date.now() - last >= ms);
    }, 1000);
    return () => {
      clearInterval(timer);
      for (const k of kinds) document.removeEventListener(k, busy, { capture: true });
    };
  }, [ms]);
  return idle;
}

/** "Claude for @ann changed this 4 s ago, seq 41: the note." */
function changeLine(e: FeedEvent, by: string, since: string): string {
  const what =
    e.op === "delete"
      ? "deleted this"
      : e.op === "move"
        ? "moved this"
        : e.op === "verify"
          ? "verified this"
          : "changed this";
  return `${by} ${what} ${since} ago, seq ${e.seq}${e.note ? `: ${e.note}` : ""}.`;
}

/**
 * A newer version, in the cluster: a pulsing glyph that opens who wrote it, Show diff and Show
 * new version.
 */
export function NewVersion({ urls, live }: { urls: Urls; live: Live }) {
  const e = live.change;
  const since = useAgo(e.ts);
  const by = useAgentNames(urls, [e.by?.agent])(e.actor, e.by);
  return (
    <div className="new-version">
      <Menu
        name="New version"
        title={`New version · ${by}${e.note ? ` · ${e.note}` : ""}`}
        buttonClass="icon-button"
        align="end"
        label={<Icon name="refresh" />}
      >
        <p role="status">{changeLine(e, by, since)}</p>
        {CONTENT_OPS.has(e.op) && <a href={urls.diff(e.path, live.shownSeq, e.seq)}>Show diff</a>}
        <button type="button" onClick={live.onSwap}>
          Show new version
        </button>
      </Menu>
    </div>
  );
}

/**
 * A change the cluster cannot show: the open file was moved or deleted (or it is not a concept).
 * A notice in the sheet, with the way to where it went.
 */
export function LiveNotice({ urls, live }: { urls: Urls; live: Live }) {
  const e = live.change;
  const since = useAgo(e.ts);
  const by = useAgentNames(urls, [e.by?.agent])(e.actor, e.by);
  return (
    <div className="notice" role="status">
      {changeLine(e, by, since)}{" "}
      {e.op === "move" ? (
        <a href={urls.pinned(undefined).file(e.path)}>Go to {e.path}</a>
      ) : e.op === "delete" ? (
        <a href={urls.tree(dirOf(e.from_path ?? e.path))}>Back to the directory</a>
      ) : (
        <>
          {CONTENT_OPS.has(e.op) && (
            <>
              <a href={urls.diff(e.path, live.shownSeq, e.seq)}>Show diff</a> ·{" "}
            </>
          )}
          <button type="button" onClick={live.onSwap}>
            Show new version
          </button>
        </>
      )}
    </div>
  );
}
