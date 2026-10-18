/**
 * Comments on a concept (tempra-dev: app/comments, TEMPRA-13): the threads in the context panel,
 * their quotes highlighted in the reader, and a comment on the selected text. Threads live in the
 * ledger; this loads them with `GET …/comments?path=` and reloads when the feed says one changed.
 */
import { type DocText, locate, type QuoteSelector } from "@tempra/editor";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type ActedBy, useAgentNames } from "./agents";
import { api, useAction, useLoad } from "./api";
import { MentionArea, useMentionable } from "./Mentions";
import { type Highlight, revealOffset } from "./Reader";
import { Ago, Chip, who } from "./ui";
import type { Urls } from "./urls";

export interface CommentT {
  id: string;
  actor: string;
  /** Who wrote it, by id (TEMPRA-77); absent on comments from before it was kept. */
  by?: ActedBy;
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
    by?: ActedBy;
    ts: string;
    seq: number;
    comment: string | null;
  }[];
}

/** Where a thread's quote is in the body on screen, as text offsets. */
export interface Placed extends Thread {
  at: { from: number; to: number } | null;
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
export function placeThreads(threads: Thread[], text: DocText): Placed[] {
  return threads.map((t) => ({ ...t, at: t.anchor ? locate(text, t.anchor) : null }));
}

/** The highlights for the reader: open threads whose quote is on screen, and the draft. */
export function highlightsOf(
  placed: Placed[],
  active: string | null,
  draft: Draft | null,
): Highlight[] {
  const marks: Highlight[] = placed
    .filter((t) => t.status === "open" && t.at && t.at.to > t.at.from)
    .map((t) => ({
      id: t.id,
      from: t.at?.from ?? 0,
      to: t.at?.to ?? 0,
      active: t.id === active,
    }));
  if (draft) marks.push({ id: "draft", from: draft.from, to: draft.to, draft: true });
  return marks;
}

/** A comment being written on a quote: the text quoted, and where it is in the document's text. */
export interface Draft {
  quote: string;
  from: number;
  to: number;
}

/**
 * The draft comment's quote: started from the reader's selection toolbar, kept (highlighted)
 * while the comment is written, until it is posted or dropped.
 */
export function useDraft(text: DocText) {
  const [draft, setDraft] = useState<Draft | null>(null);
  // A new version of the body: the old offsets no longer apply.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when the body changes.
  useEffect(() => setDraft(null), [text]);
  const start = useCallback(
    ({ from, to }: { from: number; to: number }) => {
      if (from < 0 || to <= from) return;
      const quote = text.text.slice(from, to);
      if (quote.trim()) setDraft({ quote, from, to });
    },
    [text],
  );
  const clear = useCallback(() => setDraft(null), []);
  return { draft, start, clear };
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

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
    <section id="comments" className="comments" aria-label="Comment threads">
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
          <summary className="small faint">Resolved ({resolved.length})</summary>
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
  const people = useMentionable(props.urls);
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
  // A pill until it is used; a card with the quote, the text and the actions once it is.
  const [focused, setFocused] = useState(false);
  const idle = !draft && !focused && !text;
  return (
    <form className={idle ? "comment-form idle" : "comment-form"} onSubmit={submit}>
      {draft && <blockquote className="quote">{clip(draft.quote, 300)}</blockquote>}
      <label className="visually-hidden" htmlFor="new-comment">
        Comment
      </label>
      <MentionArea
        id="new-comment"
        inputRef={box}
        value={text}
        onValue={setText}
        people={people}
        onFocus={() => setFocused(true)}
        // Escape drops the draft; leaving an empty draft drops it too (as a click away does).
        onKeyDown={(e) => {
          if (e.key === "Escape" && draft) {
            e.stopPropagation();
            onClearDraft();
          }
        }}
        onBlur={(e) => {
          setFocused(false);
          if (draft && !e.currentTarget.value.trim()) onClearDraft();
        }}
        placeholder={
          draft ? "Comment on the selection" : "Comment on this concept, or select text…"
        }
      />
      {error && <div className="notice">{error}</div>}
      {!idle && (
        <div className="actions">
          {draft && (
            <button type="button" className="ghost" onClick={onClearDraft}>
              Cancel
            </button>
          )}
          <button className="primary" type="submit" disabled={busy || !text.trim()}>
            Comment
          </button>
        </div>
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
  const people = useMentionable(urls);
  // Agents named for their person (TEMPRA-77): "Claude for @ann".
  const name = useAgentNames(
    urls,
    (t.actions ?? t.comments).map((a) => a.by?.agent),
  );
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
  const [now] = useState(() => Date.now());
  /** "who · when", then the text: the thread's first comment, replies a step in. */
  const said = (c: CommentT, reply: boolean, key: string) => (
    <div key={key} className={reply ? "reply" : undefined}>
      <div className="thread-by">
        <strong>{name(c.actor, c.by)}</strong> <Ago ts={c.ts} now={now} />
      </div>
      <p className="comment">{c.body}</p>
    </div>
  );
  let saidOnce = false;
  return (
    <li id={`thread-${t.id}`} className={props.active ? "thread active" : "thread"}>
      {t.anchor && (
        <blockquote className="quote">
          {t.at ? (
            <a
              href={`#thread-${t.id}`}
              onClick={(e) => {
                e.preventDefault();
                props.onActive(t.id);
                if (t.at) revealOffset(t.at.from);
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
        <p className="small">
          <Chip text="outdated" tone="warn" title="The quoted text is no longer in the body" />
        </p>
      )}
      {t.actions ? (
        t.actions.map((a) => {
          const c = a.comment ? t.comments.find((x) => x.id === a.comment) : undefined;
          const change =
            a.kind === "resolve" ? "Resolved" : a.kind === "reopen" ? "Reopened" : null;
          const reply = saidOnce;
          if (c) saidOnce = true;
          return (
            <div key={a.seq}>
              {change && (
                <p className="small muted">
                  {change} by {name(a.actor, a.by)} <Ago ts={a.ts} now={now} />
                  {c ? ":" : "."}
                </p>
              )}
              {c && (change ? <p className="comment">{c.body}</p> : said(c, reply, c.id))}
            </div>
          );
        })
      ) : (
        <>
          {t.comments.map((c, i) => said(c, i > 0, c.id))}
          {t.status === "resolved" && t.resolved_by && (
            <p className="small muted">Resolved by {who(t.resolved_by)}.</p>
          )}
        </>
      )}
      {props.writable && (
        <form className="reply-form" onSubmit={act("reply")}>
          {t.status === "open" && (
            <>
              <label className="visually-hidden" htmlFor={`reply-${t.id}`}>
                Reply
              </label>
              <MentionArea
                id={`reply-${t.id}`}
                value={reply}
                onValue={setReply}
                people={people}
                onFocus={() => props.onActive(t.id)}
                placeholder="Reply"
              />
            </>
          )}
          {error && <div className="notice">{error}</div>}
          <div className="actions">
            {t.status === "open" ? (
              <>
                {reply.trim() && (
                  <button type="submit" className="primary" disabled={busy}>
                    Reply
                  </button>
                )}
                <button
                  type="button"
                  className="ghost"
                  disabled={busy}
                  onClick={() => act("resolve")()}
                >
                  Resolve
                </button>
              </>
            ) : (
              <button
                type="button"
                className="ghost"
                disabled={busy}
                onClick={() => act("reopen")()}
              >
                Reopen
              </button>
            )}
          </div>
        </form>
      )}
    </li>
  );
}
