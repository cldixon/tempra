/**
 * Comments on a concept (tempra-dev: app/comments, TEMPRA-13): the threads in the context panel,
 * their quotes highlighted in the reader, and a comment on the selected text. Threads live in the
 * ledger; this loads them with `GET …/comments?path=` and reloads when the feed says one changed.
 */
import { documentPos, markdownOffset, type Parsed } from "@tempra/editor";
import { locate } from "@tempra/editor/anchor";
import type { Highlight, Reader as ReaderHandle } from "@tempra/editor/view";
import { type FormEvent, type RefObject, useEffect, useMemo, useState } from "react";
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
  anchor: { quote: string; prefix: string; suffix: string; from: number; seq: number } | null;
  comments: CommentT[];
}

/** Where a thread's quote is in the body on screen: markdown offsets and document positions. */
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

/** Each thread's quote found in `body` (the version on screen), as the server would find it. */
export function placeThreads(threads: Thread[], body: string, parsed: Parsed): Placed[] {
  return threads.map((t) => {
    const found = t.anchor ? locate(body, t.anchor) : null;
    if (!found) return { ...t, at: null };
    const pos = documentPos(parsed, found.from);
    const end = documentPos(parsed, found.to);
    return { ...t, at: { ...found, pos, end: Math.max(end, pos) } };
  });
}

/** The highlights for the reader: open threads whose quote is on screen. */
export function highlightsOf(placed: Placed[], active: string | null): Highlight[] {
  return placed
    .filter((t) => t.status === "open" && t.at && t.at.pos >= 0 && t.at.end > t.at.pos)
    .map((t) => ({
      id: t.id,
      from: t.at?.pos ?? 0,
      to: t.at?.end ?? 0,
      active: t.id === active,
    }));
}

/** The quote a comment would be anchored on: the reader's selection, as body markdown. */
export interface Pending {
  quote: string;
  from: number;
}

/**
 * Follows the selection in the reader: a non-empty selection in the body becomes the pending
 * quote, which stays (while the person types the comment) until it is posted or dropped.
 */
export function usePendingQuote(
  reader: RefObject<ReaderHandle | null>,
  parsed: Parsed,
  enabled: boolean,
) {
  const [pending, setPending] = useState<Pending | null>(null);
  // A new version of the body: the old selection's offsets no longer apply.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when the body changes.
  useEffect(() => setPending(null), [parsed]);
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const sel = reader.current?.selection();
        if (!sel) return;
        const from = markdownOffset(parsed, sel.from);
        const to = markdownOffset(parsed, sel.to);
        if (from < 0 || to <= from) return;
        const quote = parsed.source.slice(from, to);
        if (quote.trim()) setPending({ quote, from });
      }, 150);
    };
    document.addEventListener("selectionchange", check);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("selectionchange", check);
    };
  }, [reader, parsed, enabled]);
  return { pending, clear: () => setPending(null) };
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Scrolls the reader to a thread's highlight. */
function showMark(id: string) {
  document
    .querySelector(`mark.comment-mark[data-thread="${CSS.escape(id)}"]`)
    ?.scrollIntoView({ block: "center", behavior: "smooth" });
}

export function CommentsPanel(props: {
  urls: Urls;
  path: string;
  placed: Placed[];
  /** Comments can be written (the current version, not a pinned old one). */
  writable: boolean;
  pending: Pending | null;
  onClearPending(): void;
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
      {props.writable && (
        <NewComment
          urls={urls}
          path={props.path}
          pending={props.pending}
          onClearPending={props.onClearPending}
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
  pending: Pending | null;
  onClearPending(): void;
  onPosted(id: string): void;
}) {
  const { busy, error, run } = useAction();
  const [text, setText] = useState("");
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
          anchor: props.pending ? { quote: props.pending.quote, from: props.pending.from } : null,
        }),
      });
      setText("");
      props.onClearPending();
      props.onPosted(r.thread.id);
    });
  };
  return (
    <form className="comment-form" onSubmit={submit}>
      {props.pending ? (
        <>
          <blockquote className="quote small">{clip(props.pending.quote, 300)}</blockquote>
          <button type="button" className="small" onClick={props.onClearPending}>
            Comment on the whole concept instead
          </button>
        </>
      ) : (
        <p className="small muted">Select text in the body to comment on it.</p>
      )}
      <label className="visually-hidden" htmlFor="new-comment">
        Comment
      </label>
      <textarea
        id="new-comment"
        value={text}
        onChange={(e) => setText(e.currentTarget.value)}
        placeholder={props.pending ? "Comment on the selection" : "Comment on this concept"}
      />
      {error && <div className="notice">{error}</div>}
      <button className="primary" type="submit" disabled={busy || !text.trim()}>
        Comment
      </button>
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
