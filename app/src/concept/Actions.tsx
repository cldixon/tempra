import { useState } from "react";
import { Icon, Menu } from "../chrome";
import { day, plural } from "../ui";
import type { Urls } from "../urls";
import type { Namer } from "./Byline";
import { checker, markChecked } from "./Checked";
import type { Standing } from "./data";

/*
 * A page's actions (TEMPRA-172; tempra-dev: decisions/a-pages-actions-float): one round + button
 * at the page's bottom right, the one raised thing on a flat page, opening a small menu upward:
 * Comment (with the open count), then Check by the page's state (Mark as checked, Review changes,
 * or a quiet line saying who checked it). More actions join it later. It steps aside while a
 * panel is open (the panel has its own ×), and comes back, focusable, when the panel closes.
 */
export function PageActions(props: {
  urls: Urls;
  path: string;
  standing: Standing;
  name: Namer;
  /** Open threads on the page. */
  openCount: number;
  /** The latest version is on screen (checking is of the latest only). */
  current: boolean;
  /** Review mode is on: its bar holds Mark as checked and Done. */
  reviewing: boolean;
  /** A write member, who may mark the page as checked. */
  mayVerify: boolean;
  /** A panel is open: the button steps aside. */
  hidden: boolean;
  onComment(): void;
  /** The page was marked as checked: its history is read again. */
  onVerified(): void;
}) {
  const { urls, path, standing: s, current } = props;
  const [failed, setFailed] = useState(false);
  const changed = current && s.verified !== null && s.since > 0;
  const who = checker(s, props.name);
  // Something waits here: open comments, or changes since the page was checked.
  const waiting = props.openCount > 0 || changed;
  const name =
    props.openCount > 0 ? `Actions, ${plural(props.openCount, "open comment")}` : "Actions";
  const check = async () => {
    setFailed(false);
    try {
      await markChecked(urls, path);
      props.onVerified();
    } catch {
      setFailed(true);
    }
  };
  return (
    <div className="page-actions" hidden={props.hidden}>
      <Menu
        name={name}
        title="Actions"
        buttonClass="page-fab"
        align="end"
        up
        listClass="page-actions-list"
        label={
          <>
            <Icon name="add" size={22} />
            {waiting && <span className="page-fab-dot" aria-hidden="true" />}
          </>
        }
      >
        <button type="button" className="menu-item" onClick={props.onComment}>
          <Icon name="comments" /> Comment
          {props.openCount > 0 && <span className="menu-count">{props.openCount} open</span>}
        </button>
        {current && !props.reviewing && changed && (
          <a className="menu-item" href={urls.review(path)}>
            <Icon name="review" /> Review changes
            <span className="menu-count">{plural(s.since, "change")}</span>
          </a>
        )}
        {current && !s.verified && props.mayVerify && (
          <button
            type="button"
            className="menu-item"
            data-stay={failed || undefined}
            onClick={check}
          >
            <Icon name="check" /> {failed ? "Could not mark as checked" : "Mark as checked"}
          </button>
        )}
        {current && s.verified && s.since === 0 && who && (
          <p className="menu-line">
            Checked by {who}, {day(s.verified.event.ts)}
          </p>
        )}
      </Menu>
    </div>
  );
}
