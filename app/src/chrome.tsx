import {
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CirclePlus,
  Code,
  History,
  List,
  MessageSquare,
  PanelLeft,
  Pencil,
  RefreshCw,
  SlidersHorizontal,
} from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import type { Me } from "./ui";

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
  edit: Pencil,
  markdown: Code,
  comments: MessageSquare,
  review: CircleCheck,
  contents: List,
  history: History,
  properties: SlidersHorizontal,
  plus: CirclePlus,
  files: PanelLeft,
  chevron: ChevronRight,
  down: ChevronDown,
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
  align?: "start" | "end";
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
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
  }, [open]);
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
          className={`menu-list ${props.align ?? "start"}`}
          onClick={(e) => {
            if ((e.target as Element).closest("a, button")) setOpen(false);
          }}
        >
          {props.children}
        </div>
      )}
    </div>
  );
}

/** The avatar and its menu: the account's pages and signing out. */
export function AccountMenu({ me }: { me: Me | null }) {
  const handle = me?.handle ?? "";
  return (
    <Menu
      label={initials(handle)}
      name="Account menu"
      title={me ? `${handle} · ${me.email}` : "Account"}
      buttonClass="avatar"
      align="end"
    >
      {me && <div className="menu-who">{me.email}</div>}
      <a href="/connect">Connect an agent</a>
      <a href="/tokens">Tokens</a>
      <a href="/apps">Connected apps</a>
      <a href="/account">Account</a>
      <hr />
      <form method="post" action="/sign-out">
        <button type="submit">Sign out</button>
      </form>
    </Menu>
  );
}
