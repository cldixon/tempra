/**
 * Comments on a concept (tempra-dev: app/comments, TEMPRA-13): the threads in the context panel,
 * their quotes highlighted in the reader, and a comment on the selected text. Threads live in the
 * ledger; this loads them with `GET …/comments?path=` and reloads when the feed says one changed.
 */
import { documentPos, locate, type Parsed, type QuoteSelector, textOffset } from "@tempra/editor";
import type { Highlight } from "@tempra/editor/view";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, useAction, useLoad } from "./api";
import { Chip, when } from "./ui";
import type { Urls } from "./urls";

export interface CommentT {
  id: string;
  actor: string;
  body: string;
  ts: string;
  seq: number;
}

export interface Thread {
  id: string;
  path: string;
  status: "open" | "resolved";
  actor: string;
  created_seq: number;
  last_seq: number;
  resolved_by: string | null;
  replies: number;
  anchor: (QuoteSelector & { seq: number }) | null;
  comments: CommentT[];
  /** Every action in order: open, reply, resolve and reopen, with the comment each added. */
  actions?: {
    kind: "open" | "reply" | "resolve" | "reopen";
    actor: string;
    ts: string;
    seq: number;
    comment: string | null;
  }[];
}

/** Where a thread's quote is in the body on screen: text offsets and document positions. */
export interface Placed extends Thread {
  at: { from: number; to: number; pos: number; end: number } | null;
}

/** A concept's threads, open and resolved (a concept rarely has more than a page of them). */
export function useThreads(urls: Urls, path: string | null) {
  return useLoad(`comments ${urls.api("comments")} ${path ?? ""}`, async () =>
    path === null
      ? { threads: [] as Thread[] }
      : api<{ threads: Thread[] }>(urls.api("comments", { path, status: "all", limit: 200 })),
  );
}

/** Each thread's quote found in the version on screen, as the server would find it. */
export function placeThreads(threads: Thread[], parsed: Parsed): Placed[] {
  return threads.map((t) => {
    const found = t.anchor ? locate(parsed.text, t.anchor) : null;
    if (!found) return { ...t, at: null };
    const pos = documentPos(parsed, found.from);
    const end = documentPos(parsed, found.to);
    return { ...t, at: { ...found, pos, end: Math.max(end, pos) } };
  });
}

/** The highlights for the reader: open threads whose quote is on screen, and the draft. */
export function highlightsOf(
  placed: Placed[],
  active: string | null,
  draft: Draft | null,
): Highlight[] {
  const marks: Highlight[] = placed
    .filter((t) => t.status === "open" && t.at && t.at.pos >= 0 && t.at.end > t.at.pos)
    .map((t) => ({
      id: t.id,
      from: t.at?.pos ?? 0,
      to: t.at?.end ?? 0,
      active: t.id === active,
    }));
  if (draft) marks.push({ id: "draft", from: draft.pos, to: draft.end, draft: true });
  return marks;
}

/** A comment being written on a quote: the text quoted, and where it is in the document. */
export interface Draft {
  quote: string;
  /** Where the quote starts in the document's text. */
  from: number;
  /** Document positions, for the draft highlight. */
  pos: number;
  end: number;
}

/**
 * The draft comment's quote: started from the reader's selection toolbar, kept (highlighted)
 * while the comment is written, until it is posted or dropped.
 */
export function useDraft(parsed: Parsed) {
  const [draft, setDraft] = useState<Draft | null>(null);
  // A new version of the body: the old offsets no longer apply.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when the body changes.
  useEffect(() => setDraft(null), [parsed]);
  const start = useCallback(
    (range: { from: number; to: number }) => {
      const from = textOffset(parsed, range.from);
      const to = textOffset(parsed, range.to);
      if (from < 0 || to <= from) return;
      const quote = parsed.text.text.slice(from, to);
      if (quote.trim()) setDraft({ quote, from, pos: range.from, end: range.to });
    },
    [parsed],
  );
  const clear = useCallback(() => setDraft(null), []);
  return { draft, start, clear };
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Scrolls the reader to a thread's highlight (smoothly, unless motion is reduced). */
function showMark(id: string) {
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  document
    .querySelector(`mark.comment-mark[data-thread="${CSS.escape(id)}"]`)
    ?.scrollIntoView({ block: "center", behavior: still ? "auto" : "smooth" });
}

export function CommentsPanel(props: {
  urls: Urls;
  path: string;
  placed: Placed[];
  /** The threads could not be loaded (a new comment can still be made). */
  error?: string | null;
  /** Comments can be written (the current version, not a pinned old one). */
  writable: boolean;
  draft: Draft | null;
  onClearDraft(): void;
  active: string | null;
  onActive(id: string | null): void;
  onChanged(): void;
}) {
  const { urls, placed, active } = props;
  const open = useMemo(
    () =>
      placed
        .filter((t) => t.status === "open")
        // In body order; threads on the whole concept, and outdated ones, after.
        .sort(
          (a, b) =>
            (a.at?.from ?? Number.MAX_SAFE_INTEGER) - (b.at?.from ?? Number.MAX_SAFE_INTEGER) ||
            a.created_seq - b.created_seq,
        ),
    [placed],
  );
  const resolved = placed.filter((t) => t.status === "resolved");
  // The highlight clicked: its thread comes into view in the panel.
  useEffect(() => {
    if (active) document.getElementById(`thread-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active]);
  return (
    <section id="comments">
      <h2>Comments{open.length > 0 ? ` (${open.length})` : ""}</h2>
      {props.error && <p className="small warn">Could not load the comments: {props.error}</p>}
      {props.writable && (
        <NewComment
          urls={urls}
          path={props.path}
          draft={props.draft}
          onClearDraft={props.onClearDraft}
          onPosted={(id) => {
            props.onActive(id);
            props.onChanged();
          }}
        />
      )}
      {open.length > 0 && (
        <ol className="threads">
          {open.map((t) => (
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
        </ol>
      )}
      {resolved.length > 0 && (
        <details>
          <summary className="small">Resolved ({resolved.length})</summary>
          <ol className="threads">
            {resolved.map((t) => (
              <ThreadView
                key={t.id}
                urls={urls}
                thread={t}
                active={false}
                writable={props.writable}
                onActive={props.onActive}
                onChanged={props.onChanged}
              />
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}

function NewComment(props: {
  urls: Urls;
  path: string;
  draft: Draft | null;
  onClearDraft(): void;
  onPosted(id: string): void;
}) {
  const { busy, error, run } = useAction();
  const [text, setText] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  const { draft, onClearDraft } = props;
  // A comment started from the selection toolbar: the box takes the focus.
  useEffect(() => {
    if (draft) box.current?.focus();
  }, [draft]);
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    run(async () => {
      const r = await api<{ thread: Thread }>(props.urls.api("comments"), {
        method: "POST",
        body: JSON.stringify({
          path: props.path,
          body,
          anchor: draft ? { quote: draft.quote, from: draft.from } : null,
        }),
      });
      setText("");
      onClearDraft();
      props.onPosted(r.thread.id);
    });
  };
  return (
    <form className="comment-form" onSubmit={submit}>
      {draft ? (
        <blockquote className="quote small">{clip(draft.quote, 300)}</blockquote>
      ) : (
        <p className="small muted">Select text to comment on it.</p>
      )}
      <label className="visually-hidden" htmlFor="new-comment">
        Comment
      </label>
      <textarea
        id="new-comment"
        ref={box}
        value={text}
        onChange={(e) => setText(e.currentTarget.value)}
        // Escape drops the draft; leaving an empty draft drops it too (as a click away does).
        onKeyDown={(e) => {
          if (e.key === "Escape" && draft) {
            e.stopPropagation();
            onClearDraft();
          }
        }}
        onBlur={(e) => {
          if (draft && !e.currentTarget.value.trim()) onClearDraft();
        }}
        placeholder={draft ? "Comment on the selection" : "Comment on this concept"}
      />
      {error && <div className="notice">{error}</div>}
      <button className="primary" type="submit" disabled={busy || !text.trim()}>
        Comment
      </button>
      {draft && (
        <>
          {" "}
          <button type="button" onClick={onClearDraft}>
            Cancel
          </button>
        </>
      )}
    </form>
  );
}

function ThreadView(props: {
  urls: Urls;
  thread: Placed;
  active: boolean;
  writable: boolean;
  onActive(id: string | null): void;
  onChanged(): void;
}) {
  const { urls, thread: t } = props;
  const { busy, error, run } = useAction();
  const [reply, setReply] = useState("");
  const act = (kind: "reply" | "resolve" | "reopen") => (e?: FormEvent) => {
    e?.preventDefault();
    const body = reply.trim();
    if (kind === "reply" && !body) return;
    run(async () => {
      const suffix = kind === "reply" ? "" : `/${kind}`;
      await api(urls.api(`comments/${encodeURIComponent(t.id)}${suffix}`), {
        method: "POST",
        body: JSON.stringify(body ? { body } : {}),
      });
      setReply("");
      // A resolved thread is no longer highlighted: nothing stays active.
      if (kind === "resolve" && props.active) props.onActive(null);
      props.onChanged();
    });
  };
  const outdated = t.anchor !== null && t.at === null;
  return (
    <li id={`thread-${t.id}`} className={props.active ? "thread active" : "thread"}>
      {t.anchor && (
        <blockquote className="quote small">
          {t.at ? (
            <a
              href={`#thread-${t.id}`}
              onClick={(e) => {
                e.preventDefault();
                props.onActive(t.id);
                showMark(t.id);
              }}
            >
              {clip(t.anchor.quote, 300)}
            </a>
          ) : (
            clip(t.anchor.quote, 300)
          )}
        </blockquote>
      )}
      {outdated && (
        <Chip text="outdated" tone="warn" title="The quoted text is no longer in the body" />
      )}
      {t.actions ? (
        t.actions.map((a) => {
          const c = a.comment ? t.comments.find((x) => x.id === a.comment) : undefined;
          const change =
            a.kind === "resolve" ? "Resolved" : a.kind === "reopen" ? "Reopened" : null;
          return (
            <div key={a.seq}>
              {change && (
                <p className="small muted">
                  {change} by {a.actor} {when(a.ts)}
                  {c ? ":" : "."}
                </p>
              )}
              {c && (
                <>
                  {!change && (
                    <div className="small">
                      <strong>{c.actor}</strong> <span className="muted">{when(c.ts)}</span>
                    </div>
                  )}
                  <p className="comment">{c.body}</p>
                </>
              )}
            </div>
          );
        })
      ) : (
        <>
          {t.comments.map((c) => (
            <div key={c.id}>
              <div className="small">
                <strong>{c.actor}</strong> <span className="muted">{when(c.ts)}</span>
              </div>
              <p className="comment">{c.body}</p>
            </div>
          ))}
          {t.status === "resolved" && t.resolved_by && (
            <p className="small muted">Resolved by {t.resolved_by}.</p>
          )}
        </>
      )}
      {props.writable && (
        <form className="comment-form" onSubmit={act("reply")}>
          {t.status === "open" && (
            <>
              <label className="visually-hidden" htmlFor={`reply-${t.id}`}>
                Reply
              </label>
              <textarea
                id={`reply-${t.id}`}
                value={reply}
                onChange={(e) => setReply(e.currentTarget.value)}
                onFocus={() => props.onActive(t.id)}
                placeholder="Reply"
              />
            </>
          )}
          {error && <div className="notice">{error}</div>}
          {t.status === "open" ? (
            <>
              <button type="submit" disabled={busy || !reply.trim()}>
                Reply
              </button>{" "}
              <button type="button" disabled={busy} onClick={() => act("resolve")()}>
                Resolve
              </button>
            </>
          ) : (
            <button type="button" disabled={busy} onClick={() => act("reopen")()}>
              Reopen
            </button>
          )}
        </form>
      )}
    </li>
  );
}
