import { type AgentChange, warmth } from "./changes";
import { AccountMenu, Icon, Menu, PersonMenu } from "./chrome";
import { useUnread } from "./inbox";
import { useNeeds } from "./needs";
import { libraryName, useLibraries, useRole } from "./role";
import { type OutlineFile, Tree } from "./Tree";
import { type Me, switcherKey } from "./ui";
import { Urls } from "./urls";
import type { Place } from "./Workspace";

/**
 * The workspace's sidebar (take 3, tempra-dev: app/workspace): the library switcher, search, the
 * person's three views (Home, Needs you, Activity), the library's files, and at its foot the
 * inbox and the person. On a phone it is the drawer behind the top bar's menu button.
 */
export function Sidebar(props: {
  urls: Urls;
  place: Place;
  me: Me | null;
  changes: Map<string, AgentChange>;
  latest: AgentChange | undefined;
  now: number;
  onSearch(): void;
  onHide(): void;
  onIndex(files: OutlineFile[], seq: number): void;
}) {
  const { urls, place } = props;
  const needs = useNeeds(urls);
  const unread = useUnread();
  const count = needs.state === "ready" ? needs.data.count : 0;
  const recent = warmth(props.latest, props.now);
  const view = place.view;
  return (
    <>
      <div className="sidebar-head">
        <LibrarySwitcher urls={urls} place={place} />
        <button
          type="button"
          className="icon-button sidebar-hide"
          aria-label="Hide sidebar"
          title="Hide sidebar"
          onClick={props.onHide}
        >
          <Icon name="sidebar" />
        </button>
      </div>
      <button type="button" className="search-pill" onClick={props.onSearch}>
        <Icon name="search" size={14} />
        <span>Search</span>
        <kbd>{switcherKey()}</kbd>
      </button>
      <nav className="nav" aria-label="Views">
        <a
          className="nav-row"
          href={urls.tree("")}
          aria-current={view === "home" ? "page" : undefined}
        >
          <Icon name="home" />
          <span className="nav-label">Home</span>
        </a>
        <a
          className="nav-row"
          href={urls.needs()}
          aria-current={view === "needs" ? "page" : view === "work" ? "location" : undefined}
        >
          <Icon name="needs" />
          <span className="nav-label">Needs you</span>
          {count > 0 && <span className="nav-count">{count}</span>}
        </a>
        <a
          className="nav-row"
          href={urls.activity()}
          aria-current={view === "activity" ? "page" : view === "ledger" ? "location" : undefined}
        >
          <Icon name="activity" />
          <span className="nav-label">Activity</span>
          {recent && (
            <span className="nav-count" title="An agent changed something lately">
              <span className={`change-dot ${recent}`} aria-hidden="true" />
              <span className="visually-hidden">An agent changed something lately</span>
            </span>
          )}
        </a>
      </nav>
      <div className="sidebar-label" id="sidebar-files">
        Library
      </div>
      <div className="sidebar-scroll">
        <Tree
          urls={urls}
          file={place.file}
          dir={place.dir}
          changes={props.changes}
          now={props.now}
          onIndex={props.onIndex}
        />
      </div>
      <div className="sidebar-foot">
        <a
          className="nav-row"
          href="/inbox"
          aria-label={unread > 0 ? `Inbox, ${unread} unread` : "Inbox"}
        >
          <Icon name="inbox" />
          <span className="nav-label">Inbox</span>
          {unread > 0 && <span className="nav-count">{unread}</span>}
        </a>
        <PersonMenu me={props.me} />
      </div>
    </>
  );
}

/**
 * The library's name and owner as a menu: the person's other libraries, then this library's
 * settings by role (Recovery and Delete are the owner's; tempra-dev: v2/sharing).
 */
export function LibrarySwitcher({ urls, place }: { urls: Urls; place: Place }) {
  const libs = useLibraries();
  const role = useRole(urls);
  const list = libs.state === "ready" ? libs.data.libraries : [];
  const others = list.filter((l) => l.owner !== urls.owner || l.slug !== urls.slug);
  const owner = role === "owner";
  const all: [string, string, Place["view"], boolean][] = [
    ["Members", urls.members(), "members", true],
    ["Import & export", urls.transfer(), "transfer", true],
    ["Recovery", urls.recovery(), "recovery", owner],
    ["Connect", urls.connect(), "connect", true],
    ["Delete", urls.remove(), "delete", owner],
  ];
  const settings = all.filter(([, , , shown]) => shown);
  return (
    <Menu
      name={`Library ${urls.slug}, owned by ${urls.owner}`}
      buttonClass="lib-switch"
      label={
        <>
          <span className="lib-tile" aria-hidden="true">
            {(urls.slug[0] ?? "?").toUpperCase()}
          </span>
          <span className="lib-names">
            <span className="lib-name">{urls.slug}</span>
            <span className="lib-owner">{urls.owner}</span>
          </span>
          <Icon name="updown" size={14} />
        </>
      }
    >
      {others.length > 0 && (
        <>
          <div className="menu-note">Switch library</div>
          {others.map((l) => (
            <a key={`${l.owner}/${l.slug}`} href={new Urls(l.owner, l.slug).tree("")}>
              {libraryName(l)}
            </a>
          ))}
        </>
      )}
      <a href="/">All libraries</a>
      <hr />
      <div className="menu-note">Library settings</div>
      {settings.map(([name, href, key]) => (
        <a key={name} href={href} aria-current={place.view === key ? "page" : undefined}>
          {name}
        </a>
      ))}
    </Menu>
  );
}

/** The phone's top bar: the drawer's button, the library, search and the person. */
export function TopBar(props: {
  urls: Urls;
  me: Me | null;
  drawer: boolean;
  onDrawer(): void;
  onSearch(): void;
}) {
  return (
    <header className="ws-topbar">
      <button
        type="button"
        className="icon-button touch ws-menu"
        aria-label="Menu"
        aria-expanded={props.drawer}
        onClick={props.onDrawer}
      >
        <Icon name="menu" />
      </button>
      <a className="ws-topbar-name" href={props.urls.tree("")}>
        {props.urls.slug}
      </a>
      <button
        type="button"
        className="icon-button touch"
        aria-label="Search"
        onClick={props.onSearch}
      >
        <Icon name="search" />
      </button>
      <AccountMenu me={props.me} />
    </header>
  );
}
