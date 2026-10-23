import { type ReactNode, useRef } from "react";
import { Icon } from "../chrome";

/** How far down (px) a sheet's head is dragged to close it. */
const DRAG_TO_CLOSE = 60;

/**
 * The concept's panels (take 4, TEMPRA-114; tempra-dev: app/reader, The panels;
 * decisions/one-panel-from-the-top-bar): one at a time in the contents' column, opened from the
 * top bar's tools (or a quote, or `?panel=`), never by itself, and never remembered.
 */
export type PanelName = "comments" | "history" | "properties";

export const PANEL_TITLES: Record<PanelName, string> = {
  comments: "Comments",
  history: "History",
  properties: "Properties",
};

/** The id a #fragment names, decoded; null without one. */
function hashId(hash: string): string | null {
  if (hash.length < 2) return null;
  try {
    return decodeURIComponent(hash.slice(1));
  } catch {
    return hash.slice(1);
  }
}

/**
 * The panel a link asks for: `?panel=…`, or a thread or the comments by #fragment. A fragment
 * that names a heading in the body (`bodyIds`; a heading "Comments" is `#comments`) is the
 * heading's, not a panel's: the app's own ids are prefixed (`panel-…`, `doc-sources`) so they
 * never clash with a heading's slug.
 */
export function panelInUrl(
  bodyIds: ReadonlySet<string> = new Set(),
  where: { search: string; hash: string } = location,
): PanelName | null {
  const p = new URLSearchParams(where.search).get("panel");
  if (p === "comments" || p === "history" || p === "properties") return p;
  const id = hashId(where.hash);
  if (id === null || bodyIds.has(id)) return null;
  if (id === "comments" || threadInHash(bodyIds, where.hash)) return "comments";
  return null;
}

/** The thread a link names (`#thread-<id>`), unless that is a heading's id in the body. */
export function threadInHash(
  bodyIds: ReadonlySet<string> = new Set(),
  hash: string = location.hash,
): string | null {
  const id = hashId(hash);
  if (id === null || bodyIds.has(id)) return null;
  const m = /^thread-(.+)$/.exec(id);
  return m?.[1] ?? null;
}

/** A thread's element in the Comments panel (prefixed, so a heading's slug never clashes). */
export const threadElementId = (id: string) => `panel-thread-${id}`;

/**
 * A panel's frame: its title, a count where it has one, and ×. On a narrow page it overlays the
 * page, and on a phone it is a sheet from the bottom with a drag handle, the page dimmed behind
 * it (the stylesheet's call; take 4, board 35).
 */
export function Panel(props: {
  name: PanelName;
  count?: string | null;
  onClose(): void;
  children: ReactNode;
}) {
  const title = PANEL_TITLES[props.name];
  // On a phone the sheet's head is a handle too: dragged down far enough, the sheet closes.
  const drag = useRef<{ id: number; y: number } | null>(null);
  const { onClose } = props;
  return (
    <aside
      className={`concept-panel panel-${props.name}`}
      aria-label={title}
      id={`panel-${props.name}`}
    >
      <header
        className="panel-head"
        onPointerDown={(e) => {
          if (e.pointerType === "mouse" || (e.target as Element).closest("button")) return;
          drag.current = { id: e.pointerId, y: e.clientY };
        }}
        onPointerUp={(e) => {
          const from = drag.current;
          drag.current = null;
          if (from && from.id === e.pointerId && e.clientY - from.y > DRAG_TO_CLOSE) onClose();
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <span className="panel-grip" aria-hidden="true" />
        {/* Takes the focus when the person opens the panel (C-25). */}
        <h2 tabIndex={-1}>{title}</h2>
        {props.count && <span className="count">{props.count}</span>}
        <button
          type="button"
          className="icon-button touch"
          aria-label={`Close ${title.toLowerCase()}`}
          title="Close"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </header>
      <div className="panel-body">{props.children}</div>
    </aside>
  );
}
