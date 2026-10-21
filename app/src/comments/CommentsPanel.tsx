import { useEffect, useRef, useState } from "react";
import type { Urls } from "../urls";
import { type Draft, type Placed, panelOrder } from "./data";
import { NewComment, ThreadView } from "./Thread";

/**
 * The Comments panel's list (take 4, TEMPRA-114; tempra-dev: app/comments, In the app): Open and
 * Resolved n, a draft at the top while one is being written, then the threads in document order
 * (those on the whole concept and outdated ones first), the active one as a card, the others
 * compact. Its frame (title, count, ×) is the concept's Panel.
 */
export function CommentsList(props: {
  urls: Urls;
  path: string;
  placed: Placed[];
  /** The threads could not be loaded (a new comment can still be made). */
  error: string | null;
  writable: boolean;
  draft: Draft | null;
  onDraftDone(): void;
  active: string | null;
  onActive(id: string | null): void;
  onChanged(): void;
}) {
  const { urls, placed, draft, active } = props;
  const open = panelOrder(placed, "open");
  const resolved = panelOrder(placed, "resolved");
  const [tab, setTab] = useState<"open" | "resolved">("open");
  const [composing, setComposing] = useState(false);
  // A thread made active (a quote clicked, a link to it) shows under its tab, once it has
  // loaded; a thread resolved while it is active stays where it is. A draft is under Open.
  const activeStatus = placed.find((t) => t.id === active)?.status;
  const switched = useRef<string | null>(null);
  useEffect(() => {
    if (!active || !activeStatus || switched.current === active) return;
    switched.current = active;
    setTab(activeStatus);
  }, [active, activeStatus]);
  useEffect(() => {
    if (draft) setTab("open");
  }, [draft]);

  // The active thread comes into view in the panel, once it is there.
  const list = useRef<HTMLDivElement>(null);
  const shown = useRef<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `placed` changes as threads load.
  useEffect(() => {
    if (!active || shown.current === active) return;
    const el = list.current?.querySelector(`[id="thread-${CSS.escape(active)}"]`);
    if (!el) return;
    shown.current = active;
    el.scrollIntoView({ block: "nearest" });
  }, [active, placed, tab]);

  const posted = (id: string) => {
    props.onActive(id);
    props.onChanged();
  };
  const threads = tab === "open" ? open : resolved;
  return (
    <div className="comments-list" ref={list}>
      <fieldset className="segmented">
        <legend className="visually-hidden">Threads</legend>
        <button type="button" aria-pressed={tab === "open"} onClick={() => setTab("open")}>
          Open
        </button>
        <button type="button" aria-pressed={tab === "resolved"} onClick={() => setTab("resolved")}>
          Resolved {resolved.length}
        </button>
      </fieldset>
      {props.error && <p className="small warn">Could not load the comments: {props.error}</p>}
      {tab === "open" && draft && (
        <NewComment
          urls={urls}
          path={props.path}
          draft={draft}
          onDone={props.onDraftDone}
          onPosted={posted}
        />
      )}
      {tab === "open" && !draft && composing && (
        <NewComment
          urls={urls}
          path={props.path}
          draft={null}
          onDone={() => setComposing(false)}
          onPosted={posted}
        />
      )}
      {tab === "open" && props.writable && !draft && !composing && (
        <button type="button" className="ghost new-thread" onClick={() => setComposing(true)}>
          Comment on this concept
        </button>
      )}
      {threads.map((t) => (
        <ThreadView
          key={t.id}
          urls={urls}
          thread={t}
          active={t.id === active}
          writable={props.writable}
          onActive={props.onActive}
          onChanged={props.onChanged}
        />
      ))}
      {threads.length === 0 && !draft && !composing && (
        <p className="small muted">
          {tab === "open"
            ? "No open threads. Select text to comment on it."
            : "No resolved threads."}
        </p>
      )}
    </div>
  );
}
