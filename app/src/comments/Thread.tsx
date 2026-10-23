import { type FormEvent, type RefObject, useEffect, useRef, useState } from "react";
import { AgentName } from "../AgentName";
import { type ActedBy, type ActorView, actorText, useActors } from "../agents";
import { api, useAction } from "../api";
import { Avatar } from "../chrome";
import { threadElementId } from "../concept/Panel";
import { MentionArea, useMentionable } from "../Mentions";
import { Moment } from "../Moment";
import { revealOffset } from "../Reader";
import { clip, useMe } from "../ui";
import type { Urls } from "../urls";
import { useComposing } from "./composing";
import type { CommentT, Draft, Placed, Thread } from "./data";

/*
 * One comment thread as the Comments panel draws it (tempra-dev: app/comments): compact (its
 * quote, then who, the first words, when) until it is the active thread, a card with its
 * comments, a reply field and Resolve (Reopen once resolved). And the composer for a new comment.
 */

/** Names actors for comments: agents for their person, the signed-in person as "You". */
function useNamer(urls: Urls): (actor: string, by?: ActedBy | null) => ActorView {
  const me = useMe();
  return useActors(urls, me?.actor ?? null).view;
}

/** Who said it: their mark and name; `full` adds whom an agent acts for (AgentName). */
function By({ who, full = false }: { who: ActorView; full?: boolean }) {
  return (
    <>
      <Avatar name={who.mark} agent={who.agent} />
      {full ? <AgentName who={who} /> : <strong>{who.name}</strong>}
    </>
  );
}

export function ThreadView(props: {
  urls: Urls;
  thread: Placed;
  active: boolean;
  writable: boolean;
  onActive(id: string | null): void;
  onChanged(): void;
}) {
  const { urls, thread: t, active } = props;
  const name = useNamer(urls);
  const first = t.comments[0];
  const outdated = t.anchor !== null && t.at === null;
  const select = () => {
    props.onActive(t.id);
    if (t.at) revealOffset(t.at.from);
  };
  if (!active) {
    return (
      <button
        type="button"
        id={threadElementId(t.id)}
        className={t.status === "open" ? "thread collapsed" : "thread collapsed resolved"}
        aria-expanded="false"
        onClick={select}
      >
        {t.anchor && (
          <span className="quote thread-quote">
            {outdated && <span className="visually-hidden">Outdated: </span>}
            {clip(t.anchor.quote, 120)}
          </span>
        )}
        <span className="thread-meta">
          {first && <By who={name(first.actor, first.by)} />}
          <span className="thread-words">{first ? clip(first.body, 80) : ""}</span>
          {t.replies > 0 && <span className="thread-replies">{t.replies + 1}</span>}
          {first && <Moment ts={t.comments[t.comments.length - 1]?.ts ?? first.ts} />}
        </span>
      </button>
    );
  }
  return (
    <section
      id={threadElementId(t.id)}
      className={t.status === "open" ? "thread open" : "thread open resolved"}
      aria-label="Comment thread"
    >
      {t.anchor && (
        <blockquote className="quote thread-quote">
          {t.at ? (
            <a
              href={`#thread-${t.id}`}
              onClick={(e) => {
                e.preventDefault();
                select();
              }}
            >
              {clip(t.anchor.quote, 300)}
            </a>
          ) : (
            clip(t.anchor.quote, 300)
          )}
        </blockquote>
      )}
      {outdated && <p className="small muted">The quoted text is no longer in the body.</p>}
      <Said thread={t} name={name} />
      <ThreadActions {...props} />
    </section>
  );
}

/** The thread's comments and its resolves and reopens, in order. */
function Said(props: { thread: Thread; name: (actor: string, by?: ActedBy | null) => ActorView }) {
  const { thread: t, name } = props;
  const comment = (c: CommentT) => (
    <div key={c.id} className="said">
      <div className="said-by">
        <By who={name(c.actor, c.by)} full /> <Moment ts={c.ts} />
      </div>
      <p className="comment">{c.body}</p>
    </div>
  );
  if (!t.actions) return <>{t.comments.map(comment)}</>;
  return (
    <>
      {t.actions.map((a) => {
        const c = a.comment ? t.comments.find((x) => x.id === a.comment) : undefined;
        if (a.kind === "resolve" || a.kind === "reopen") {
          return (
            <div key={a.seq}>
              <p className="said-change">
                {a.kind === "resolve" ? "Resolved" : "Reopened"} by {actorText(name(a.actor, a.by))}{" "}
                <Moment ts={a.ts} />
              </p>
              {c && <p className="comment">{c.body}</p>}
            </div>
          );
        }
        return c ? comment(c) : null;
      })}
    </>
  );
}

/** Reply, Resolve, Reopen: what a person can do with an expanded thread. */
function ThreadActions(props: {
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
  useComposing(reply.trim() !== "");
  if (!props.writable) return null;
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
      if (kind === "resolve") props.onActive(null);
      props.onChanged();
    });
  };
  return (
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
            placeholder="Reply…"
          />
        </>
      )}
      {error && <div className="notice">{error}</div>}
      <div className="actions">
        {t.status === "open" ? (
          <>
            {reply.trim() && (
              <button type="submit" disabled={busy}>
                Reply
              </button>
            )}
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => act("resolve")()}
            >
              Resolve
            </button>
          </>
        ) : (
          <button type="button" disabled={busy} onClick={() => act("reopen")()}>
            Reopen
          </button>
        )}
      </div>
    </form>
  );
}

/**
 * A new comment: on the selected text (a draft, started from the selection toolbar, at the top
 * of the Comments panel) or on the whole concept. Escape, Cancel, or leaving it empty drops it.
 */
export function NewComment(props: {
  urls: Urls;
  path: string;
  draft: Draft | null;
  onDone(): void;
  onPosted(id: string): void;
  boxRef?: RefObject<HTMLTextAreaElement | null>;
}) {
  const { busy, error, run } = useAction();
  const [text, setText] = useState("");
  const own = useRef<HTMLTextAreaElement>(null);
  const box = props.boxRef ?? own;
  const people = useMentionable(props.urls);
  const { draft, onDone } = props;
  useComposing(draft !== null || text.trim() !== "");
  // The box takes the focus when it opens (from the toolbar, or "Comment on the page").
  // biome-ignore lint/correctness/useExhaustiveDependencies: on opening, and on a new draft.
  useEffect(() => box.current?.focus(), [draft]);
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
      onDone();
      props.onPosted(r.thread.id);
    });
  };
  return (
    <form className="thread open comment-form" onSubmit={submit}>
      {draft && <blockquote className="quote thread-quote">{clip(draft.quote, 300)}</blockquote>}
      <label className="visually-hidden" htmlFor="new-comment">
        Comment
      </label>
      <MentionArea
        id="new-comment"
        inputRef={box}
        value={text}
        onValue={setText}
        people={people}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onDone();
          }
        }}
        onBlur={(e) => {
          // Leaving an empty draft drops it, as a click away does.
          const to = e.relatedTarget instanceof Element ? e.relatedTarget : null;
          if (!e.currentTarget.value.trim() && !to?.closest(".comment-form")) onDone();
        }}
        placeholder={draft ? "Comment on the selection" : "Comment on the page"}
      />
      {error && <div className="notice">{error}</div>}
      <div className="actions">
        <button type="button" className="ghost" onClick={onDone}>
          Cancel
        </button>
        <button className="primary" type="submit" disabled={busy || !text.trim()}>
          Comment
        </button>
      </div>
    </form>
  );
}
