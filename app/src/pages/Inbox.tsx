import { useEffect } from "react";
import { api, useAction, useLoad } from "../api";
import { INBOX_EVENT, inboxChanged } from "../inbox";
import { Status, useTitle, when } from "../ui";

/**
 * The account's inbox (TEMPRA-72): what is addressed to the person across their libraries, newest
 * first: replies on their threads, mentions, new threads on what they wrote, invitations and
 * access changes. Read and done are kept on the server, so they follow the person.
 */

export interface InboxItem {
  id: string;
  kind: "reply" | "mention" | "thread" | "invitation" | "access" | "report";
  place: string;
  path: string | null;
  thread: string | null;
  actor: string;
  excerpt: string;
  created: string;
  read_at: string | null;
  done_at: string | null;
  href: string;
}

const VERB: Record<InboxItem["kind"], string> = {
  reply: "replied",
  mention: "mentioned you",
  thread: "opened a thread",
  invitation: "invited you",
  access: "changed your access",
  report: "reported",
};

/** Who did it, as people read it: @ann for a person, the agent's actor otherwise. */
const who = (actor: string) => actor.replace(/^human:/, "@");

export function Inbox({ all }: { all: boolean }) {
  useTitle("Inbox");
  const loaded = useLoad(`inbox ${all ? "all" : "open"}`, () =>
    api<{ items: InboxItem[]; unread: number }>(`/api/v1/inbox${all ? "?all=1" : ""}`),
  );
  const { reload } = loaded;
  useEffect(() => {
    window.addEventListener(INBOX_EVENT, reload);
    return () => window.removeEventListener(INBOX_EVENT, reload);
  }, [reload]);
  const action = useAction();
  const mark = (path: string, body: unknown) =>
    action.run(async () => {
      await api(path, { method: "POST", body: JSON.stringify(body) });
      inboxChanged();
    });
  // Following an item reads it.
  const open = (i: InboxItem) => {
    if (i.read_at === null) {
      void api("/api/v1/inbox/read", { method: "POST", body: JSON.stringify({ ids: [i.id] }) })
        .then(inboxChanged)
        .catch(() => {});
    }
  };
  return (
    <>
      <div className="page-head">
        <h1>Inbox</h1>
        <div className="actions">
          {loaded.state === "ready" && loaded.data.unread > 0 && (
            <button
              type="button"
              disabled={action.busy}
              onClick={() => void mark("/api/v1/inbox/read", {})}
            >
              Mark all read
            </button>
          )}
          <a href={all ? "/inbox" : "/inbox?all=1"}>{all ? "Open only" : "Show done"}</a>
        </div>
      </div>
      {action.error && <div className="notice">{action.error}</div>}
      <Status loaded={loaded}>
        {({ items }) =>
          items.length === 0 ? (
            <p className="muted">Nothing for you{all ? "" : " right now"}.</p>
          ) : (
            <ul className="inbox-list">
              {items.map((i) => (
                <li key={i.id} className={i.read_at === null ? "unread" : undefined}>
                  <span className="what">
                    <a href={i.href} onClick={() => open(i)}>
                      {who(i.actor)} {VERB[i.kind]}
                      {i.path ? ` on ${i.path}` : ""}
                    </a>{" "}
                    <span className="faint">in {i.place}</span>
                    {i.read_at === null && <span className="visually-hidden"> (unread)</span>}
                  </span>
                  <span className="when faint">{when(i.created)}</span>
                  {i.done_at === null ? (
                    <button
                      type="button"
                      className="ghost"
                      disabled={action.busy}
                      onClick={() =>
                        void mark(`/api/v1/inbox/${encodeURIComponent(i.id)}/done`, {})
                      }
                    >
                      Done
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="ghost"
                      disabled={action.busy}
                      onClick={() =>
                        void mark(`/api/v1/inbox/${encodeURIComponent(i.id)}/done`, { done: false })
                      }
                    >
                      Not done
                    </button>
                  )}
                  {i.excerpt && <p className="excerpt">{i.excerpt}</p>}
                </li>
              ))}
            </ul>
          )
        }
      </Status>
      <p className="page-foot">
        What you are mailed: <a href="/account#notifications">Account</a>.
      </p>
    </>
  );
}
