import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import type { Me } from "./ui";

/*
 * The app's chrome (take 2, TEMPRA-53): the glyphs, menus and the avatar shared by the workspace
 * and the account pages. Every look is in @tempra/design (workspace.css); nothing here is styled.
 */

const GLYPHS = {
  refresh: (
    <>
      <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
      <path d="M13.5 2.5v2.5H11" />
    </>
  ),
  edit: (
    <>
      <path d="M11.3 2.7l2 2L5 13H3v-2z" />
      <path d="M9.8 4.2l2 2" />
    </>
  ),
  markdown: (
    <>
      <path d="M5.5 4.5L2.5 8l3 3.5" />
      <path d="M10.5 4.5l3 3.5-3 3.5" />
    </>
  ),
  comments: (
    <path d="M3 3.5h10A1.5 1.5 0 0 1 14.5 5v5a1.5 1.5 0 0 1-1.5 1.5H7L3.5 14v-2.5H3A1.5 1.5 0 0 1 1.5 10V5A1.5 1.5 0 0 1 3 3.5z" />
  ),
  review: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M5.5 8.2l1.7 1.7 3.3-3.6" />
    </>
  ),
  contents: <path d="M3 4h10M3 8h7M3 12h10" />,
  history: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.6V8l2.3 1.5" />
    </>
  ),
  properties: (
    <>
      <path d="M2.5 5h5M11.5 5h2M2.5 11h2M8.5 11h5" />
      <circle cx="9.5" cy="5" r="1.6" />
      <circle cx="6.5" cy="11" r="1.6" />
    </>
  ),
  plus: (
    <>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 5.2v5.6M5.2 8h5.6" />
    </>
  ),
  files: <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />,
} as const;

export type Glyph = keyof typeof GLYPHS;

/** A 16px line glyph (stroke 1.4, round caps), drawn in the current text colour. */
export function Icon({ name }: { name: Glyph }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {GLYPHS[name]}
    </svg>
  );
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
