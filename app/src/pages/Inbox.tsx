import { useEffect } from "react";
import { useNow } from "../activity";
import { api, useAction, useLoad } from "../api";
import {
  INBOX_EVENT,
  type InboxItem,
  type InboxPage,
  inboxChanged,
  itemDetail,
  itemHref,
  itemQuote,
  itemTitle,
  kindLabel,
  libraryLabel,
  markRead,
} from "../inbox";
import { useLibraries } from "../role";
import { navigate } from "../router";
import { LibraryTile } from "../Sidebar";
import { recently, Status, useMe, useTitle } from "../ui";
import { inboxUrl, Urls } from "../urls";

/**
 * The Inbox (take 4, boards 02, 13; TEMPRA-116; tempra-dev: v2/notifications): the one place for
 * what the person should do or answer across their libraries, newest first, kept until done:
 * replies on their threads, mentions, new threads on what they wrote, pages they verified that
 * changed since, pages going stale, invitations and access changes. Open and Done tabs, one
 * library or all; read and done are kept on the server, so they follow the person.
 */
export function Inbox({ done, library }: { done: boolean; library: string | null }) {
  useTitle("Inbox");
  const q = new URLSearchParams({ limit: "100" });
  if (done) q.set("done", "1");
  if (library) q.set("library", library);
  const loaded = useLoad(`inbox ${q}`, () => api<InboxPage>(`/api/v1/inbox?${q}`));
  const { reload } = loaded;
  useEffect(() => {
    window.addEventListener(INBOX_EVENT, reload);
    return () => window.removeEventListener(INBOX_EVENT, reload);
  }, [reload]);
  const action = useAction();
  const now = useNow(60_000);
  const me = useMe();
  const libs = useLibraries();
  const reachable = libs.state === "ready" ? libs.data.libraries : [];
  const filtered = library ? reachable.find((l) => `${l.owner}/${l.slug}` === library) : null;
  const filterName = filtered ? filtered.title || filtered.slug : library;
  const run = (fn: () => Promise<unknown>) =>
    action.run(async () => {
      await fn();
      inboxChanged();
    });
  const post = (path: string, body: unknown = {}) =>
    api(path, { method: "POST", body: JSON.stringify(body) });
  const open = loaded.state === "ready" ? loaded.data.open : null;
  const unread = loaded.state === "ready" ? loaded.data.unread : 0;
  return (
    <>
      <header className="view-head">
        <div className="view-head-main">
          <h1 className="view-title">Inbox</h1>
        </div>
      </header>
      <div className="view-filters inbox-filters">
        <fieldset className="segmented">
          <legend className="visually-hidden">Show</legend>
          <button
            type="button"
            aria-pressed={!done}
            onClick={() => done && navigate(inboxUrl({ library }))}
          >
            Open{open !== null && open > 0 ? ` ${open}` : ""}
          </button>
          <button
            type="button"
            aria-pressed={done}
            onClick={() => !done && navigate(inboxUrl({ done: true, library }))}
          >
            Done
          </button>
        </fieldset>
        {library ? (
          <a
            className="button inbox-filter"
            href={inboxUrl({ done })}
            aria-label={`${filterName}: show all libraries`}
          >
            {filterName}
            <span aria-hidden="true">×</span>
          </a>
        ) : (
          reachable.length > 1 && (
            <select
              className="pill-select"
              aria-label="Library"
              value=""
              onChange={(e) =>
                e.target.value && navigate(inboxUrl({ done, library: e.target.value }))
              }
            >
              <option value="">All libraries</option>
              {reachable.map((l) => (
                <option key={`${l.owner}/${l.slug}`} value={`${l.owner}/${l.slug}`}>
                  {(l.role ?? "owner") === "owner" ? l.title || l.slug : `${l.owner} / ${l.slug}`}
                </option>
              ))}
            </select>
          )
        )}
        {unread > 0 && (
          <button
            type="button"
            className="ghost inbox-mark"
            disabled={action.busy}
            onClick={() => void run(() => markRead())}
          >
            Mark all read
          </button>
        )}
      </div>
      {action.error && <div className="notice">{action.error}</div>}
      <Status loaded={loaded}>
        {({ items }) =>
          items.length === 0 ? (
            <p className="view-empty">Nothing for you</p>
          ) : (
            <ul className="inbox-list">
              {items.map((i) => (
                <Row
                  key={i.id}
                  item={i}
                  now={now}
                  me={me?.handle ?? null}
                  busy={action.busy}
                  run={run}
                  post={post}
                />
              ))}
            </ul>
          )
        }
      </Status>
    </>
  );
}

/** One item: its library, kind and time; the title; the detail line, a quote; its actions. */
function Row(props: {
  item: InboxItem;
  now: number;
  me: string | null;
  busy: boolean;
  run: (fn: () => Promise<unknown>) => Promise<void>;
  post: (path: string, body?: unknown) => Promise<unknown>;
}) {
  const { item: i, now, run, post } = props;
  const unread = i.read_at === null && i.done_at === null;
  const [owner = "", slug = ""] = i.library.split("/");
  const urls = new Urls(owner, slug);
  const href = itemHref(i);
  const quote = itemQuote(i);
  // Following an item, or acting on it, reads it.
  const read = () => {
    if (i.read_at === null) void markRead([i.id]);
  };
  const ownLibrary = props.me !== null && owner === props.me;
  const name = ownLibrary ? libraryLabel(i) : `${owner} / ${slug}`;
  const done = (path: string) => () => void run(() => post(path));
  const button = (key: string, label: string, onClick: () => void, primary = false) => (
    <button
      key={key}
      type="button"
      className={primary ? "primary" : undefined}
      disabled={props.busy}
      onClick={onClick}
    >
      {label}
    </button>
  );
  const link = (key: string, label: string, to: string, primary = false) => (
    <a key={key} className={primary ? "button primary" : "button"} href={to} onClick={read}>
      {label}
    </a>
  );
  const actions = i.actions.map((a) => {
    switch (a) {
      case "reply":
        return link(a, "Reply", href);
      case "resolve":
        return i.thread
          ? button(
              a,
              "Resolve",
              done(`${urls.api(`comments/${encodeURIComponent(i.thread)}`)}/resolve`),
            )
          : null;
      case "review":
        return link(a, "Review", href, true);
      case "open":
        return link(a, "Open", href);
      case "dismiss":
        return button(a, "Dismiss", done(`/api/v1/inbox/${encodeURIComponent(i.id)}/done`));
      case "accept":
      case "decline":
        return i.invitation
          ? button(
              a,
              a === "accept" ? "Accept" : "Decline",
              done(`/api/v1/invitations/${encodeURIComponent(i.invitation)}/${a}`),
              a === "accept",
            )
          : null;
      default:
        return null;
    }
  });
  return (
    <li className={unread ? "inbox-row unread" : "inbox-row"}>
      <span className="inbox-dot" aria-hidden="true" />
      {unread && <span className="visually-hidden">Unread: </span>}
      <div className="inbox-main">
        <p className="inbox-meta">
          <LibraryTile name={libraryLabel(i)} shared={!ownLibrary} />
          <span>{name}</span>
          <span aria-hidden="true">·</span>
          <span>{kindLabel(i, now)}</span>
          <span aria-hidden="true">·</span>
          <time dateTime={i.created}>{recently(i.created, now)}</time>
        </p>
        <p className="inbox-title">
          <a href={href} onClick={read}>
            {itemTitle(i)}
          </a>
        </p>
        <p className="inbox-detail">{itemDetail(i, now)}</p>
        {quote && <blockquote className="inbox-quote">{quote}</blockquote>}
      </div>
      {actions.some(Boolean) && (
        // biome-ignore lint/a11y/noStaticElementInteractions: a click bubbling up from an action reads the item.
        // biome-ignore lint/a11y/useKeyWithClickEvents: as above; the actions take the keys.
        <div className="inbox-actions" onClick={read}>
          {actions}
        </div>
      )}
    </li>
  );
}
