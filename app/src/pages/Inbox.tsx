import { useEffect, useState } from "react";
import { useNow } from "../activity";
import { api, useAction, useLoad } from "../api";
import {
  INBOX_EVENT,
  type InboxItem,
  type InboxPage,
  inboxChanged,
  itemDetail,
  itemHref,
  itemLibrary,
  itemQuote,
  itemTitle,
  kindLabel,
  markRead,
  type PageTitles,
  useAgentLabels,
  usePageTitles,
  withNames,
} from "../inbox";
import { Moment } from "../Moment";
import { librariesChanged, libraryLabel, useLibraries } from "../role";
import { navigate } from "../router";
import { LibraryTile } from "../Sidebar";
import { Status, useMe, useTitle } from "../ui";
import { inboxUrl, Urls } from "../urls";

/**
 * The Inbox (take 4, boards 02, 13; TEMPRA-116; tempra-dev: v2/notifications): the one place for
 * what the person should do or answer across their libraries, newest first, kept until done:
 * replies on their threads, mentions, new threads on what they wrote, pages they verified that
 * changed since, pages going stale, invitations and access changes. Open and Done tabs, one
 * library or all; read and done are kept on the server, so they follow the person. "Older" pages
 * back past the first hundred.
 */
export function Inbox({ done, library }: { done: boolean; library: string | null }) {
  useTitle("Inbox");
  const q = new URLSearchParams({ limit: String(PAGE) });
  if (done) q.set("done", "1");
  if (library) q.set("library", library);
  const loaded = useLoad(`inbox ${q}`, () => api<InboxPage>(`/api/v1/inbox?${q}`));
  const { reload } = loaded;
  useEffect(() => {
    window.addEventListener(INBOX_EVENT, reload);
    return () => window.removeEventListener(INBOX_EVENT, reload);
  }, [reload]);
  // Older pages, after the first ("Older", as Activity has); a change starts again from the top.
  const [older, setOlder] = useState<{ items: InboxItem[]; next: string | null } | null>(null);
  const [paging, setPaging] = useState(false);
  const first = loaded.state === "ready" ? loaded.data : null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new first page starts afresh.
  useEffect(() => setOlder(null), [first]);
  const raw = first ? [...first.items, ...(older?.items ?? [])] : null;
  const labels = useAgentLabels(raw);
  const items = raw && withNames(raw, labels);
  const next = older ? older.next : (first?.next ?? null);
  const loadOlder = () => {
    if (next === null) return;
    setPaging(true);
    const more = new URLSearchParams(q);
    more.set("before", next);
    api<InboxPage>(`/api/v1/inbox?${more}`)
      .then((p) => setOlder((o) => ({ items: [...(o?.items ?? []), ...p.items], next: p.next })))
      .catch(() => {})
      .finally(() => setPaging(false));
  };
  const titles = usePageTitles(items);
  const action = useAction();
  const now = useNow(60_000);
  const me = useMe();
  const libs = useLibraries();
  const reachable = libs.state === "ready" ? libs.data.libraries : [];
  // Accepting an invitation: the library joins the switcher and the sidebar, and opens from here.
  const [joined, setJoined] = useState<{ name: string; href: string } | null>(null);
  const run = (fn: () => Promise<unknown>) =>
    action.run(async () => {
      await fn();
      inboxChanged();
    });
  const post = (path: string, body: unknown = {}) =>
    api(path, { method: "POST", body: JSON.stringify(body) });
  const accept = (i: InboxItem) =>
    void run(async () => {
      await post(`/api/v1/invitations/${encodeURIComponent(i.invitation ?? "")}/accept`);
      librariesChanged();
      const [owner = "", slug = ""] = i.library.split("/");
      setJoined({ name: itemLibrary(i, me?.handle ?? null), href: new Urls(owner, slug).tree("") });
    });
  const open = first?.open ?? null;
  // Mark all read clears what the list shows: one library's items when it is filtered.
  const unread = library
    ? (items ?? []).some((i) => i.read_at === null && i.done_at === null)
    : (first?.unread ?? 0) > 0;
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
        {/* One library filter, whichever way the page was reached (from a home or here). */}
        {(library || reachable.length > 1) && (
          <select
            className="pill-select"
            aria-label="Library"
            value={library ?? ""}
            onChange={(e) => navigate(inboxUrl({ done, library: e.target.value || null }))}
          >
            <option value="">All libraries</option>
            {reachable.map((l) => (
              <option key={`${l.owner}/${l.slug}`} value={`${l.owner}/${l.slug}`}>
                {libraryLabel(l)}
              </option>
            ))}
            {library && !reachable.some((l) => `${l.owner}/${l.slug}` === library) && (
              <option value={library}>
                {itemLibrary({ library, library_title: null }, me?.handle ?? null)}
              </option>
            )}
          </select>
        )}
        {unread && (
          <button
            type="button"
            className="ghost inbox-mark"
            disabled={action.busy}
            onClick={() => void run(() => markRead(undefined, library))}
          >
            Mark all read
          </button>
        )}
      </div>
      {action.error && <div className="notice">{action.error}</div>}
      {joined && (
        <div className="notice" role="status">
          You joined {joined.name}. <a href={joined.href}>Open</a>
        </div>
      )}
      <Status loaded={loaded}>
        {() =>
          items === null || items.length === 0 ? (
            <p className="view-empty">{done ? "Nothing done yet" : "Nothing for you"}</p>
          ) : (
            <>
              <ul className="inbox-list">
                {items.map((i) => (
                  <Row
                    key={i.id}
                    item={i}
                    titles={titles}
                    now={now}
                    me={me?.handle ?? null}
                    reachable={reachable.some((l) => `${l.owner}/${l.slug}` === i.library)}
                    busy={action.busy}
                    run={run}
                    post={post}
                    onAccept={accept}
                  />
                ))}
              </ul>
              {next !== null && (
                <p className="view-more">
                  <button type="button" onClick={loadOlder} disabled={paging}>
                    {paging ? "Loading…" : "Older"}
                  </button>
                </p>
              )}
            </>
          )
        }
      </Status>
    </>
  );
}

/** How many items a page of the Inbox loads. */
const PAGE = 100;

/** One item: its library, kind and time; the title; the detail line, a quote; its actions. */
function Row(props: {
  item: InboxItem;
  titles: PageTitles;
  now: number;
  me: string | null;
  /** Whether the person reaches the item's library (an accepted invitation opens it). */
  reachable: boolean;
  busy: boolean;
  run: (fn: () => Promise<unknown>) => Promise<void>;
  post: (path: string, body?: unknown) => Promise<unknown>;
  onAccept(i: InboxItem): void;
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
  const name = itemLibrary(i, props.me);
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
        return i.invitation ? button(a, "Accept", () => props.onAccept(i), true) : null;
      case "decline":
        return i.invitation
          ? button(
              a,
              "Decline",
              done(`/api/v1/invitations/${encodeURIComponent(i.invitation)}/decline`),
            )
          : null;
      default:
        return null;
    }
  });
  // An invitation answered and accepted: the library opens from its row.
  if (i.kind === "invitation" && i.done_at !== null && props.reachable) {
    actions.push(link("open", "Open", urls.tree("")));
  }
  return (
    <li className={unread ? "inbox-row unread" : "inbox-row"}>
      <span className="inbox-dot" aria-hidden="true" />
      {unread && <span className="visually-hidden">Unread: </span>}
      <div className="inbox-main">
        <p className="inbox-meta">
          <LibraryTile name={i.library_title || slug} shared={!ownLibrary} />
          <span>{name}</span>
          <span aria-hidden="true">·</span>
          <span>{kindLabel(i, now)}</span>
          <span aria-hidden="true">·</span>
          <Moment ts={i.created} now={now} />
        </p>
        <p className="inbox-title">
          <a href={href} onClick={read}>
            {itemTitle(i, props.titles)}
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
