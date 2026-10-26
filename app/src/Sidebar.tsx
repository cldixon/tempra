import { Icon, Menu } from "./chrome";
import { useUnread } from "./inbox";
import { libraryLabel, type ReachableLibrary, useLibraries, useRole } from "./role";
import { type OutlineFile, Tree } from "./Tree";
import { Urls } from "./urls";
import type { AccountPage, Place } from "./Workspace";

/*
 * The frame's sidebars (take 4, TEMPRA-113; tempra-dev: app/workspace): a library's (the tree,
 * then a fixed foot of its tools: Activity, Settings; TEMPRA-145, after Linear's docs), its
 * settings' (a way back, then the tabs by role), the account's (Libraries, the Inbox, the
 * person's libraries) and the account's settings' (a way back, then each page). The bar over
 * them holds the mark, the library and its switcher, and search. On a phone each is the drawer's
 * content under the same at its head; the library's adds the Inbox at its foot.
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
}) {
  return (
    <a
      className={props.className ? `nav-row ${props.className}` : "nav-row"}
      href={props.href}
      aria-current={props.current ? "page" : undefined}
    >
      {props.icon && <Icon name={props.icon} />}
      {props.tile && <LibraryTile name={props.tile.name} shared={props.tile.shared} />}
      <span className="nav-label">{props.label}</span>
      {props.end}
    </a>
  );
}

/**
 * The Inbox's unread count at a row's end, read as "Inbox 2 unread": the name is the row's own
 * words, so it starts with what it shows (WCAG 2.5.3).
 */
function UnreadCount({ unread }: { unread: number }) {
  if (unread <= 0) return null;
  return (
    <>
      {" "}
      <span className="nav-count">
        {unread}
        <span className="visually-hidden"> unread</span>
      </span>
    </>
  );
}

/**
 * The library's sidebar (TEMPRA-145): the files, then a fixed foot of the library's tools,
 * Activity and Settings (and on a phone the Inbox). Home is the library's name in the bar.
 */
export function LibrarySidebar(props: {
  urls: Urls;
  place: Place;
  onIndex(files: OutlineFile[], seq: number): void;
}) {
  const { urls, place } = props;
  const unread = useUnread();
  return (
    <>
      <div className="sidebar-scroll">
        <Tree urls={urls} file={place.file} dir={place.dir} onIndex={props.onIndex} />
      </div>
      <nav className="sidebar-foot" aria-label="Library">
        <Row
          href={urls.activity()}
          current={place.view === "activity"}
          icon="activity"
          label="Activity"
        />
        <Row href={urls.settings()} icon="settings" label="Settings" />
        <Row
          href="/inbox"
          icon="inbox"
          label="Inbox"
          className="phone-only"
          end={<UnreadCount unread={unread} />}
        />
      </nav>
    </>
  );
}

/**
 * The library's settings pages by role (tempra-dev: v2/sharing): a read member has Members (and
 * Leave on it), a write member also General and Connect, the owner also the recovery tools and
 * Delete. Nothing until the role is known, so no tab shows and then goes.
 */
export function settingsTabs(urls: Urls, role: string | null) {
  const owner = role === "owner";
  const writer = owner || role === "write";
  const all: [string, string, Place["view"], boolean][] = [
    ["General", urls.settings(), "settings", writer],
    ["Members", urls.members(), "members", role !== null],
    ["Connect", urls.connect(), "connect", writer],
    ["Import & export", urls.transfer(), "transfer", owner],
    ["Recovery", urls.recovery(), "recovery", owner],
    ["Delete library", urls.remove(), "delete", owner],
  ];
  return all.filter(([, , , shown]) => shown).map(([label, href, view]) => ({ label, href, view }));
}

/**
 * The settings' sidebar: back to the library (its name is already over the sidebar, so the row
 * does not say it again), then its tabs.
 */
export function SettingsSidebar({ urls, place }: { urls: Urls; place: Place }) {
  const role = useRole(urls);
  return (
    <nav className="nav" aria-label="Library settings">
      <Row href={urls.tree("")} icon="previous" label="Back to library" className="back" />
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
      label={libraryLabel(l)}
    />
  );
  return (
    <>
      <nav className="nav" aria-label="Account">
        <Row href="/" current={page === "libraries"} icon="libraries" label="Libraries" />
        <Row
          href="/inbox"
          current={page === "inbox" || page === "invitations"}
          icon="inbox"
          label="Inbox"
          end={<UnreadCount unread={unread} />}
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
    ["agents", "/agents", "Agents"],
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
 * The library switcher (take 4, board 07; TEMPRA-145): ⌄ beside the library's name in the bar;
 * its menu only switches: the person's libraries (Yours, then Shared with you with their role,
 * this one ticked), then All libraries and New library. The library's settings are the
 * sidebar's foot's.
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
      <span>{libraryLabel(l)}</span>
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
      name="Switch library"
      title={`Switch from ${name}`}
      buttonClass="icon-button lib-switch"
      listClass="libraries"
      label={<Icon name="down" size={14} />}
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
    </Menu>
  );
}
