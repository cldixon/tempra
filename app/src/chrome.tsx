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
  Folder as FolderGlyph,
  History,
  Home,
  Hourglass,
  ImageOff,
  Inbox,
  KeyRound,
  LayoutGrid,
  Link,
  List,
  LogOut,
  Maximize2,
  Menu as MenuGlyph,
  MessageSquare,
  PanelLeft,
  Plug,
  Puzzle,
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
import { INBOX_EVENT, inboxChanged, useUnread } from "./inbox";
import { THEMES, useTheme } from "./theme";
import { type Me, recently } from "./ui";

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
  needs: CircleCheck,
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
  folder: FolderGlyph,
  file: FileText,
  broken: ImageOff,
  bell: BellGlyph,
  check: Check,
  settings: Settings,
  libraries: LayoutGrid,
  user: User,
  key: KeyRound,
  plug: Plug,
  apps: Puzzle,
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

/**
 * A button that opens a list of links under it. It closes on a choice, a click elsewhere or
 * Escape, and gives the focus back to its button.
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
    <div className="menu" ref={box}>
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

/** One item of the inbox, as the bell's popover shows it (the latest few). */
interface BellItem {
  id: string;
  kind: string;
  place: string;
  path: string | null;
  actor: string;
  excerpt: string;
  created: string;
  read_at: string | null;
  href: string;
}

const BELL_VERBS: Record<string, string> = {
  reply: "replied",
  mention: "mentioned you",
  thread: "opened a thread",
  invitation: "invited you",
  access: "changed your access",
  verify: "changed a page you verified",
  stale: "is going stale",
};

/** Who did it, as people read it. */
const whoDid = (actor: string) => actor.replace(/^human:/, "@");

/**
 * The bell (take 4, board 03): the Inbox's unread count as a badge, and a popover of the latest
 * few items with Mark all read and Open inbox. The count follows the feed, as the inbox does.
 */
export function Bell() {
  const unread = useUnread();
  const [open, setOpen] = useState(false);
  const latest = useLoad("inbox-latest", () => api<{ items: BellItem[] }>("/api/v1/inbox?limit=5"));
  const { reload } = latest;
  useEffect(() => {
    window.addEventListener(INBOX_EVENT, reload);
    return () => window.removeEventListener(INBOX_EVENT, reload);
  }, [reload]);
  // Read when the popover draws (it opens on a state change, so this is fresh enough).
  const now = Date.now();
  const markAll = () =>
    void api("/api/v1/inbox/read", { method: "POST", body: JSON.stringify({ all: true }) })
      .then(inboxChanged)
      .catch(() => {});
  const items = latest.state === "ready" ? latest.data.items : [];
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
          <button type="button" onClick={markAll}>
            Mark all read
          </button>
        )}
      </div>
      {open && items.length === 0 && <div className="bell-empty">Nothing for you</div>}
      {items.map((i) => {
        const page = i.path?.replace(/\.md$/, "").split("/").pop() ?? i.place;
        return (
          <a key={i.id} className="bell-item" href={i.href}>
            <span className="lib-tile" aria-hidden="true">
              {(i.place.split("/").pop()?.[0] ?? "?").toUpperCase()}
            </span>
            <span className="bell-item-what">
              <strong>{whoDid(i.actor)}</strong> {BELL_VERBS[i.kind] ?? i.kind}
              {i.path && (
                <>
                  {" "}
                  on <strong>{page}</strong>
                </>
              )}
            </span>
            <span className="bell-item-where">
              {i.place.split("/").pop()} · {recently(i.created, now)}
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
const displayName = (me: Me | null) => me?.handle ?? "";

/**
 * The avatar and its menu (take 4, board 08): who, then Account, Notifications, Connect an agent,
 * Tokens, Connected apps; the theme; Sign out.
 */
export function AccountMenu({ me }: { me: Me | null }) {
  const handle = me?.handle ?? "";
  const [theme, setTheme] = useTheme();
  return (
    <Menu
      label={initials(handle)}
      name="Account menu"
      title={me ? `${handle} · ${me.email}` : "Account"}
      buttonClass="avatar"
      listClass="account"
      align="end"
    >
      <div className="menu-person">
        <Avatar name={handle} />
        <span className="menu-person-names">
          <span>{displayName(me)}</span>
          <span className="handle">{me ? `@${handle}` : ""}</span>
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
      <a className="menu-item" href="/connect">
        <Icon name="plug" />
        Connect an agent
      </a>
      <a className="menu-item" href="/tokens">
        <Icon name="key" />
        Tokens
      </a>
      <a className="menu-item" href="/apps">
        <Icon name="apps" />
        Connected apps
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
