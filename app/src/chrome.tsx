import {
  Activity,
  ArrowLeft,
  Bell as BellGlyph,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  CircleCheck,
  CirclePlus,
  ClockAlert,
  Code,
  Copy,
  Download,
  Ellipsis,
  ExternalLink,
  FileText,
  History,
  Home,
  Hourglass,
  ImageOff,
  Inbox,
  LayoutGrid,
  Link,
  List,
  LogOut,
  Maximize2,
  Menu as MenuGlyph,
  MessageSquare,
  PanelLeft,
  Plug,
  RefreshCw,
  Search,
  Settings,
  SlidersHorizontal,
  SunMoon,
  User,
  X,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import { api, useLoad } from "./api";
import {
  INBOX_EVENT,
  type InboxPage,
  itemDetail,
  itemHref,
  itemLibrary,
  itemTitle,
  kindLabel,
  markRead,
  useAgentLabels,
  usePageTitles,
  useUnread,
  withNames,
} from "./inbox";
import { Moment } from "./Moment";
import { THEMES, useTheme } from "./theme";
import { type Me, useMe } from "./ui";

/*
 * The app's chrome (take 2, TEMPRA-53): the icons, menus and the avatar shared by the workspace
 * and the account pages. Every look is in @tempra/design (workspace.css); nothing here is styled.
 */

/*
 * The icons are Lucide's (the set the handoff asks for), at 16px with a 1.5 stroke, drawn in the
 * current text colour.
 */
const ICONS = {
  refresh: RefreshCw,
  markdown: Code,
  comments: MessageSquare,
  review: CircleCheck,
  contents: List,
  history: History,
  properties: SlidersHorizontal,
  plus: CirclePlus,
  sidebar: PanelLeft,
  chevron: ChevronRight,
  stale: ClockAlert,
  soon: Hourglass,
  down: ChevronDown,
  updown: ChevronsUpDown,
  home: Home,
  activity: Activity,
  inbox: Inbox,
  search: Search,
  more: Ellipsis,
  menu: MenuGlyph,
  close: X,
  back: ArrowLeft,
  previous: ChevronLeft,
  next: ChevronRight,
  enlarge: Maximize2,
  download: Download,
  open: ExternalLink,
  file: FileText,
  broken: ImageOff,
  bell: BellGlyph,
  check: Check,
  settings: Settings,
  libraries: LayoutGrid,
  user: User,
  plug: Plug,
  theme: SunMoon,
  signout: LogOut,
  copy: Copy,
  link: Link,
} as const;

export type Glyph = keyof typeof ICONS;

export function Icon({ name, size = 16 }: { name: Glyph; size?: number }) {
  const C = ICONS[name];
  return <C size={size} strokeWidth={1.5} aria-hidden="true" focusable="false" />;
}

/** Two letters for a handle: "cl_dixon" → "CD", "sam" → "SA". */
export function initials(handle: string): string {
  const parts = handle.split(/[_\-.\s]+/).filter(Boolean);
  const letters =
    parts.length >= 2 ? (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "") : handle.slice(0, 2);
  return letters.toUpperCase() || "?";
}

/**
 * Someone who acts in a library, as a small round mark with their initials: a person on a light
 * fill, an agent on ink (take 3). The name beside it is the caller's to draw.
 */
export function Avatar({ name, agent = false }: { name: string; agent?: boolean }) {
  return (
    <span className={agent ? "avatar-mark agent" : "avatar-mark"} aria-hidden="true">
      {agent ? (name.trim()[0] ?? "?").toUpperCase() : initials(name)}
    </span>
  );
}

/** The choices in a menu's list that take the keys: its links and enabled buttons, as shown. */
function choicesOf(list: Element | null): HTMLElement[] {
  if (!list) return [];
  return Array.from(list.querySelectorAll<HTMLElement>("a[href], button:not([disabled])")).filter(
    (el) => el.getClientRects().length > 0,
  );
}

/** The arrow keys, Home and End: the keys that move between a menu's choices. */
const MENU_KEYS: ReadonlySet<string> = new Set(["ArrowDown", "ArrowUp", "Home", "End"]);

/**
 * A button that opens a list of links under it. It closes on a choice, a click elsewhere,
 * Escape or the focus leaving it, and gives the focus back to its button. Down (or Up) on the
 * button opens it at its first (or last) choice; in the list Up, Down, Home and End move between
 * the choices (F-16, TEMPRA-133).
 */
export function Menu(props: {
  /** The button's content. */
  label: ReactNode;
  /** The button's accessible name, when its content is not one (the avatar). */
  name?: string;
  title?: string;
  buttonClass?: string;
  /** A class for the list, for one that has a shape of its own (the libraries, the bell). */
  listClass?: string;
  align?: "start" | "end";
  /** Opens above its button (a menu at the bottom of the sidebar). */
  up?: boolean;
  /** Told when the menu opens or closes (the bell loads its items on open). */
  onOpen?(open: boolean): void;
  children: ReactNode;
}) {
  const [open, setOpenState] = useState(false);
  const onOpen = useRef(props.onOpen);
  onOpen.current = props.onOpen;
  const setOpen = useCallback(
    (next: boolean | ((o: boolean) => boolean)) =>
      setOpenState((o) => {
        const n = typeof next === "function" ? next(o) : next;
        if (n !== o) onOpen.current?.(n);
        return n;
      }),
    [],
  );
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  // Opened from the keyboard: the focus goes to the first (or last) choice once it draws.
  const focusOnOpen = useRef<"first" | "last" | null>(null);
  const focusChoice = useCallback(
    (which: "first" | "last") => {
      const items = choicesOf(document.getElementById(id));
      (which === "first" ? items[0] : items[items.length - 1])?.focus();
    },
    [id],
  );
  useEffect(() => {
    if (!open || !focusOnOpen.current) return;
    focusChoice(focusOnOpen.current);
    focusOnOpen.current = null;
  }, [open, focusChoice]);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!MENU_KEYS.has(e.key) || e.altKey || e.ctrlKey || e.metaKey) return;
    const t = e.target as Element;
    if (t.closest("input, textarea, select")) return;
    if (t === button.current) {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const which = e.key === "ArrowDown" ? "first" : "last";
      if (open) focusChoice(which);
      else {
        focusOnOpen.current = which;
        setOpen(true);
      }
      return;
    }
    const items = choicesOf(document.getElementById(id));
    if (items.length === 0) return;
    e.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? items.length - 1
          : e.key === "ArrowDown"
            ? (at + 1) % items.length
            : (at - 1 + items.length) % items.length;
    items[next]?.focus();
  };
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key, true);
    };
  }, [open, setOpen]);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the keys of the button and choices inside.
    <div
      className="menu"
      ref={box}
      onKeyDown={onKeyDown}
      onBlur={(e) => {
        // The focus moving to something outside (Tab, a click on a control) closes it; a click on
        // the list's own ground, which leaves the focus nowhere, does not.
        const to = e.relatedTarget;
        if (open && to instanceof Node && !box.current?.contains(to)) setOpen(false);
      }}
    >
      <button
        ref={button}
        type="button"
        className={props.buttonClass ?? "menu-button"}
        aria-expanded={open}
        aria-controls={id}
        aria-label={props.name}
        title={props.title}
        onClick={() => setOpen((o) => !o)}
      >
        {props.label}
      </button>
      {open && (
        // A choice (a link or a button in the list) closes the menu; the links and buttons
        // inside are what take the keys.
        // biome-ignore lint/a11y/noStaticElementInteractions: a click bubbling up from a choice.
        // biome-ignore lint/a11y/useKeyWithClickEvents: as above.
        <div
          id={id}
          className={`menu-list ${props.align ?? "start"}${props.up ? " up" : ""}${props.listClass ? ` ${props.listClass}` : ""}`}
          onClick={(e) => {
            const choice = (e.target as Element).closest("a, button");
            if (choice && !choice.hasAttribute("data-stay")) setOpen(false);
          }}
        >
          {props.children}
        </div>
      )}
    </div>
  );
}

/**
 * The bell (take 4, board 03; TEMPRA-116): the Inbox's unread count as a badge, and a popover of
 * the latest few items (the page, the Inbox row's detail line, the library, kind and time, an
 * unread dot) with Mark all read and Open inbox; loading, a failure (with Retry) and nothing for
 * the person each say so (F-14). The count follows the feed and every action on an item.
 */
export function Bell() {
  const unread = useUnread();
  const [open, setOpen] = useState(false);
  const latest = useLoad("inbox-latest", () => api<InboxPage>("/api/v1/inbox?limit=5"));
  const { reload } = latest;
  useEffect(() => {
    window.addEventListener(INBOX_EVENT, reload);
    return () => window.removeEventListener(INBOX_EVENT, reload);
  }, [reload]);
  // Read when the popover draws (it opens on a state change, so this is fresh enough).
  const now = Date.now();
  const raw = latest.state === "ready" ? latest.data.items : null;
  const labels = useAgentLabels(raw);
  // A reply names its page by path: titles from the library's outline, once the popover opens.
  const titles = usePageTitles(open ? raw : null);
  const handle = useMe()?.handle ?? null;
  const items = withNames(raw ?? [], labels);
  return (
    <Menu
      label={
        <>
          <Icon name="bell" />
          {unread > 0 && (
            <span className="badge" aria-hidden="true">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </>
      }
      name={unread > 0 ? `Inbox, ${unread} unread` : "Inbox"}
      title="Inbox"
      buttonClass="icon-button bell"
      listClass="bell-pop"
      align="end"
      onOpen={setOpen}
    >
      <div className="bell-pop-head">
        <span>Inbox</span>
        {unread > 0 && (
          <button type="button" data-stay onClick={() => void markRead()}>
            Mark all read
          </button>
        )}
      </div>
      {open && latest.state === "loading" && <div className="bell-empty">Loading…</div>}
      {open && latest.state === "error" && (
        <div className="bell-empty" role="alert">
          Couldn't load the Inbox.{" "}
          <button type="button" data-stay onClick={reload}>
            Retry
          </button>
        </div>
      )}
      {open && latest.state === "ready" && items.length === 0 && (
        <div className="bell-empty">Nothing for you</div>
      )}
      {items.map((i) => {
        return (
          <a
            key={i.id}
            className="bell-item"
            href={itemHref(i)}
            onClick={() => i.read_at === null && void markRead([i.id])}
          >
            <span className="lib-tile" aria-hidden="true">
              {(itemLibrary(i, handle)[0] ?? "?").toUpperCase()}
            </span>
            <span className="bell-item-what">
              <strong>{itemTitle(i, titles)}</strong>
              <span className="bell-item-detail">{itemDetail(i)}</span>
            </span>
            <span className="bell-item-where">
              {itemLibrary(i, handle)} · {kindLabel(i)} · <Moment ts={i.created} now={now} />
            </span>
            {i.read_at === null && (
              <>
                <span className="unread-dot" aria-hidden="true" />
                <span className="visually-hidden">unread</span>
              </>
            )}
          </a>
        );
      })}
      <a className="bell-foot" href="/inbox">
        Open inbox
      </a>
    </Menu>
  );
}

/** The person's name as the app has it: their handle, until accounts carry a name (TEMPRA-54). */
/**
 * The avatar and its menu (take 4, board 08): who, then Account, Notifications, Agents; the
 * theme; Sign out.
 */
export function AccountMenu({ me }: { me: Me | null }) {
  const handle = me?.handle ?? "";
  const [theme, setTheme] = useTheme();
  return (
    <Menu
      // Named by its own words, not an aria-label over the initials (WCAG 2.5.3).
      label={
        <>
          <span aria-hidden="true">{initials(handle)}</span>
          <span className="visually-hidden">Account menu</span>
        </>
      }
      title={me ? `${handle} · ${me.email}` : "Account"}
      buttonClass="avatar"
      listClass="account"
      align="end"
    >
      <div className="menu-person">
        <Avatar name={handle} />
        <span className="menu-person-names">
          {/* The handle once (no names on accounts yet, TEMPRA-54), then the email. */}
          <span>{me ? `@${handle}` : ""}</span>
          <span className="email">{me?.email ?? ""}</span>
        </span>
      </div>
      <hr />
      <a className="menu-item" href="/account">
        <Icon name="user" />
        Account
      </a>
      <a className="menu-item" href="/notifications">
        <Icon name="bell" />
        Notifications
      </a>
      <a className="menu-item" href="/agents">
        <Icon name="plug" />
        Agents
      </a>
      <hr />
      <div className="menu-theme">
        <Icon name="theme" />
        <span>Theme</span>
        <ThemeChoice value={theme} onChange={setTheme} />
      </div>
      <hr />
      <form method="post" action="/sign-out">
        <button type="submit" className="menu-item">
          <Icon name="signout" />
          Sign out
        </button>
      </form>
    </Menu>
  );
}

/** System, Light, Dark as one segmented control (the avatar's menu, the Account page). */
export function ThemeChoice({
  value,
  onChange,
}: {
  value: "system" | "light" | "dark";
  onChange(theme: "system" | "light" | "dark"): void;
}) {
  return (
    <fieldset className="segmented">
      <legend className="visually-hidden">Theme</legend>
      {THEMES.map(([key, label]) => (
        <button
          key={key}
          type="button"
          aria-pressed={value === key}
          data-stay
          onClick={() => onChange(key)}
        >
          {label}
        </button>
      ))}
    </fieldset>
  );
}
