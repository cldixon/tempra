import { type AgentChange, isLive } from "./changes";
import { Icon, Menu } from "./chrome";
import { useUnread } from "./inbox";
import { libraryName, type ReachableLibrary, useLibraries, useRole } from "./role";
import { type OutlineFile, Tree } from "./Tree";
import { switcherKey } from "./ui";
import { Urls } from "./urls";
import type { AccountPage, Place } from "./Workspace";
import { useFrame } from "./Workspace";

/*
 * The frame's sidebars (take 4, TEMPRA-113; tempra-dev: app/workspace): a library's (Home,
 * Activity, a rule, the tree, Settings at the foot), its settings' (a way back, then the tabs by
 * role), the account's (Libraries, the Inbox, the person's libraries) and the account's
 * settings' (a way back, then each page). On a phone each is the drawer's content (take 4,
 * board 34): the frame puts the mark, the switcher and × at its head; the library's adds a
 * search field at its top and the Inbox at its foot.
 */

/** A library's tile: its initial on a dark square (a lighter round one for a shared library). */
export function LibraryTile({ name, shared = false }: { name: string; shared?: boolean }) {
  return (
    <span className={shared ? "lib-tile shared" : "lib-tile"} aria-hidden="true">
      {(name.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}

/** A row of the sidebar: a glyph (or a tile), a name, a count or a mark at the end. */
function Row(props: {
  href: string;
  current?: boolean;
  icon?: Parameters<typeof Icon>[0]["name"];
  tile?: { name: string; shared?: boolean };
  label: string;
  end?: React.ReactNode;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <a
      className={props.className ? `nav-row ${props.className}` : "nav-row"}
      href={props.href}
      aria-current={props.current ? "page" : undefined}
      aria-label={props.ariaLabel}
    >
      {props.icon && <Icon name={props.icon} />}
      {props.tile && <LibraryTile name={props.tile.name} shared={props.tile.shared} />}
      <span className="nav-label">{props.label}</span>
      {props.end}
    </a>
  );
}

/** The library's sidebar: Home, Activity, a rule, the files, Settings at the foot. */
export function LibrarySidebar(props: {
  urls: Urls;
  name: string;
  place: Place;
  changes: Map<string, AgentChange>;
  now: number;
  onSearch(): void;
  onIndex(files: OutlineFile[], seq: number): void;
}) {
  const { urls, place } = props;
  const { latest, now } = useFrame();
  const writing = isLive(latest, now);
  const unread = useUnread();
  return (
    <>
      {/* On a phone, search as a field at the drawer's top (board 34); it opens the switcher. */}
      <button
        type="button"
        className="drawer-search"
        title={`Search (${switcherKey()})`}
        onClick={props.onSearch}
      >
        <Icon name="search" />
        <span>Search {props.name}</span>
      </button>
      <nav className="nav" aria-label="Views">
        <Row href={urls.tree("")} current={place.view === "home"} icon="home" label="Home" />
        <Row
          href={urls.activity()}
          current={place.view === "activity"}
          icon="activity"
          label="Activity"
          end={
            writing ? (
              <span className="nav-count" title="An agent is writing now">
                <span className="change-dot live" aria-hidden="true" />
                <span className="visually-hidden">An agent is writing now</span>
              </span>
            ) : undefined
          }
        />
      </nav>
      <hr className="sidebar-rule" />
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
        <Row href={urls.settings()} icon="settings" label="Settings" />
        <Row
          href="/inbox"
          icon="inbox"
          label="Inbox"
          className="phone-only"
          ariaLabel={unread > 0 ? `Inbox, ${unread} unread` : "Inbox"}
          end={unread > 0 ? <span className="nav-count">{unread}</span> : undefined}
        />
      </div>
    </>
  );
}

/** The library's settings pages by role (tempra-dev: v2/sharing). */
export function settingsTabs(urls: Urls, role: string | null) {
  const owner = role === "owner";
  const all: [string, string, Place["view"], boolean][] = [
    ["General", urls.settings(), "settings", true],
    ["Members", urls.members(), "members", true],
    ["Connect", urls.connect(), "connect", true],
    ["Import & export", urls.transfer(), "transfer", true],
    ["Recovery", urls.recovery(), "recovery", owner],
    ["Delete library", urls.remove(), "delete", owner],
  ];
  return all.filter(([, , , shown]) => shown).map(([label, href, view]) => ({ label, href, view }));
}

/** The settings' sidebar: back to the library, then its tabs. */
export function SettingsSidebar({ urls, name, place }: { urls: Urls; name: string; place: Place }) {
  const role = useRole(urls);
  return (
    <nav className="nav" aria-label="Library settings">
      <Row href={urls.tree("")} icon="previous" label={`Back to ${name}`} className="back" />
      {settingsTabs(urls, role).map((t) => (
        <Row key={t.view} href={t.href} current={place.view === t.view} label={t.label} />
      ))}
    </nav>
  );
}

/** The account's sidebar: Libraries, the Inbox, then the person's libraries by kind. */
export function AccountSidebar({ page }: { page: AccountPage }) {
  const libs = useLibraries();
  const unread = useUnread();
  const list = libs.state === "ready" ? libs.data.libraries : [];
  const yours = list.filter((l) => (l.role ?? "owner") === "owner");
  const shared = list.filter((l) => (l.role ?? "owner") !== "owner");
  const row = (l: ReachableLibrary) => (
    <Row
      key={`${l.owner}/${l.slug}`}
      href={new Urls(l.owner, l.slug).tree("")}
      tile={{ name: l.title || l.slug, shared: (l.role ?? "owner") !== "owner" }}
      label={l.title || libraryName(l)}
    />
  );
  return (
    <>
      <nav className="nav" aria-label="Account">
        <Row href="/" current={page === "libraries"} icon="libraries" label="Libraries" />
        <Row
          href="/inbox"
          current={page === "inbox"}
          icon="inbox"
          label="Inbox"
          ariaLabel={unread > 0 ? `Inbox, ${unread} unread` : "Inbox"}
          end={unread > 0 ? <span className="nav-count">{unread}</span> : undefined}
        />
      </nav>
      <div className="sidebar-scroll">
        {yours.length > 0 && (
          <>
            <div className="sidebar-label">Yours</div>
            <nav className="nav" aria-label="Your libraries">
              {yours.map(row)}
            </nav>
          </>
        )}
        {shared.length > 0 && (
          <>
            <div className="sidebar-label">Shared with you</div>
            <nav className="nav" aria-label="Shared with you">
              {shared.map(row)}
            </nav>
          </>
        )}
      </div>
    </>
  );
}

/** The account settings' sidebar: back to the libraries, then each page. */
export function AccountSettingsSidebar({ page }: { page: AccountPage }) {
  const tabs: [AccountPage, string, string][] = [
    ["account", "/account", "Account"],
    ["notifications", "/notifications", "Notifications"],
    ["connect", "/connect", "Connect an agent"],
    ["tokens", "/tokens", "Tokens"],
    ["apps", "/apps", "Connected apps"],
  ];
  return (
    <nav className="nav" aria-label="Settings">
      <Row href="/" icon="previous" label="Back to libraries" className="back" />
      {tabs.map(([key, href, label]) => (
        <Row key={key} href={href} current={page === key} label={label} />
      ))}
    </nav>
  );
}

/**
 * The library switcher (take 4, board 07): the library's name and a chevron in the top bar; its
 * menu lists the person's libraries (Yours, then Shared with you with their role, this one
 * ticked), then All libraries, New library, and this library's settings.
 */
export function LibrarySwitcher({ urls, name }: { urls: Urls; name: string }) {
  const libs = useLibraries();
  const list = libs.state === "ready" ? libs.data.libraries : [];
  const yours = list.filter((l) => (l.role ?? "owner") === "owner");
  const shared = list.filter((l) => (l.role ?? "owner") !== "owner");
  const here = (l: ReachableLibrary) => l.owner === urls.owner && l.slug === urls.slug;
  const row = (l: ReachableLibrary) => (
    <a
      key={`${l.owner}/${l.slug}`}
      className="menu-lib"
      href={new Urls(l.owner, l.slug).tree("")}
      aria-current={here(l) ? "page" : undefined}
    >
      <LibraryTile name={l.title || l.slug} shared={(l.role ?? "owner") !== "owner"} />
      <span>{l.title || libraryName(l)}</span>
      {(l.role ?? "owner") !== "owner" && (
        <span className="menu-lib-role">{l.role === "write" ? "Write" : "Read"}</span>
      )}
      {here(l) && (
        <span className="menu-lib-check">
          <Icon name="check" size={14} />
        </span>
      )}
    </a>
  );
  return (
    <Menu
      name={`${name}, switch library`}
      buttonClass="lib-switch"
      listClass="libraries"
      label={
        <>
          <span className="lib-name">{name}</span>
          <Icon name="down" size={14} />
        </>
      }
    >
      {yours.length > 0 && <div className="menu-note">Yours</div>}
      {yours.map(row)}
      {shared.length > 0 && <div className="menu-note">Shared with you</div>}
      {shared.map(row)}
      <hr />
      <a className="menu-item" href="/">
        <Icon name="libraries" />
        All libraries
      </a>
      <a className="menu-item" href="/?new=1">
        <Icon name="plus" />
        New library
      </a>
      <hr />
      <a className="menu-item" href={urls.settings()}>
        <Icon name="settings" />
        {name} settings
      </a>
    </Menu>
  );
}
