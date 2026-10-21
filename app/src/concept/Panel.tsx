import type { ReactNode } from "react";
import { Icon } from "../chrome";

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

/** The panel a link asks for: `?panel=…`, or a thread or the comments by #fragment. */
export function panelInUrl(): PanelName | null {
  const p = new URLSearchParams(location.search).get("panel");
  if (p === "comments" || p === "history" || p === "properties") return p;
  if (location.hash === "#comments" || location.hash.startsWith("#thread-")) return "comments";
  return null;
}

/**
 * A panel's frame: its title, a count where it has one, and ×. On a narrow page it overlays the
 * page, and on a phone it is a sheet from the bottom (the stylesheet's call).
 */
export function Panel(props: {
  name: PanelName;
  count?: string | null;
  onClose(): void;
  children: ReactNode;
}) {
  const title = PANEL_TITLES[props.name];
  return (
    <aside className={`concept-panel panel-${props.name}`} aria-label={title} id={props.name}>
      <header className="panel-head">
        <h2>{title}</h2>
        {props.count && <span className="count">{props.count}</span>}
        <button
          type="button"
          className="icon-button touch"
          aria-label={`Close ${title.toLowerCase()}`}
          title="Close"
          onClick={props.onClose}
        >
          <Icon name="close" />
        </button>
      </header>
      <div className="panel-body">{props.children}</div>
    </aside>
  );
}
