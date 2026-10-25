import { type ReactNode, useState } from "react";
import { AgentName } from "../AgentName";
import { ApiError } from "../api";
import { Moment } from "../Moment";
import { day, plural } from "../ui";
import type { Urls } from "../urls";
import { useTitleOf } from "../Workspace";
import type { Namer } from "./Byline";
import { changesSince, markChecked } from "./Checked";
import { actedBy, type Concept, type Json, type Links, type Standing } from "./data";

/**
 * The Properties panel (take 4, TEMPRA-114; TEMPRA-122 and 134; tempra-dev: app/reader, The
 * panels): short and in people's words. What a reader needs (status, stale or not, who changed
 * it last, type, tags, sources, what links here by title), then Check when there is something to
 * do (decisions/take4-followups-ui-only). What agents would fix (lint, work items, broken links)
 * is theirs, through `work`, not the panel's (TEMPRA-144).
 */
export function PropertiesList(props: {
  urls: Urls;
  concept: Concept;
  links: Links;
  head: number;
  standing: Standing;
  name: Namer;
  /** The page is current (not a pinned old version), so it can be checked. */
  current: boolean;
  /** Review mode is on (the changes since the last check are drawn). */
  reviewing: boolean;
  /** A write member: may mark it as checked. */
  mayVerify: boolean;
  onVerified(): void;
}) {
  const { urls, concept: c } = props;
  return (
    <>
      <Facts concept={c} standing={props.standing} name={props.name} />
      <LinkedFrom urls={urls} links={props.links} head={props.head} />
      {props.current && (
        <Check
          urls={urls}
          path={c.path}
          standing={props.standing}
          name={props.name}
          reviewing={props.reviewing}
          mayVerify={props.mayVerify}
          onVerified={props.onVerified}
        />
      )}
    </>
  );
}

/**
 * Whether a person checked the page, when there is something to do about it: a page nobody
 * checked offers only Mark as checked (to a write member); a page checked and changed since says
 * how much and offers Show changes (review mode, whose bar has Mark as checked and Done); nothing
 * once the version on screen is the checked one.
 */
function Check(props: {
  urls: Urls;
  path: string;
  standing: Standing;
  name: Namer;
  reviewing: boolean;
  mayVerify: boolean;
  onVerified(): void;
}) {
  const { urls, path, standing: s } = props;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (s.verified && s.since === 0) return null;
  if (!s.verified && (!props.mayVerify || props.reviewing)) return null;
  const check = async () => {
    setBusy(true);
    setError(null);
    try {
      await markChecked(urls, path);
      props.onVerified();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel-section check" aria-label="Check">
      {s.verified ? (
        <>
          <p className="check-state">{changesSince(s, props.name)}</p>
          {/* In review mode the bar over the text has Mark as checked and Done. */}
          {!props.reviewing && (
            <div className="actions">
              <a className="button" href={urls.review(path)}>
                Show changes
              </a>
            </div>
          )}
        </>
      ) : (
        <div className="actions">
          <button type="button" disabled={busy} onClick={check}>
            Mark as checked
          </button>
        </div>
      )}
      {error && <p className="small warn">{error}</p>}
    </section>
  );
}

/** A frontmatter value as text: a list joined, anything else as it reads. */
function text(v: Json | undefined): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (Array.isArray(v)) {
    const words = v.filter((x) => x !== null && typeof x !== "object").map(String);
    return words.length > 0 ? words.join(", ") : null;
  }
  return typeof v === "object" ? null : String(v);
}

/** "No, until Nov 19", "Soon, on Nov 2", "Yes, since Oct 3", or "No". */
function staleWords(c: Concept): string {
  const after = text(c.frontmatter.stale_after);
  const on = after ? day(after) : null;
  if (c.stale) return on ? `Yes, since ${on}` : "Yes";
  if (c.stale_soon && on) return `Soon, on ${on}`;
  return on ? `No, until ${on}` : "No";
}

const notSet = <span className="muted">not set</span>;

/** What a reader asks about the page, in a fixed order. */
function Facts({
  concept: c,
  standing: s,
  name,
}: {
  concept: Concept;
  standing: Standing;
  name: Namer;
}) {
  const fm = c.frontmatter;
  const sources = Array.isArray(fm.sources) ? fm.sources.length : 0;
  const last = s.current?.event;
  const rows: [string, ReactNode][] = [
    ["Status", text(fm.status) ?? notSet],
    ["Stale", staleWords(c)],
  ];
  if (last) {
    rows.push([
      "Last changed",
      <span key="l">
        <AgentName who={name(last.actor, actedBy(last))} />, <Moment ts={last.ts} />
      </span>,
    ]);
  }
  rows.push(["Type", text(fm.type) ?? notSet]);
  const tags = text(fm.tags);
  if (tags) rows.push(["Tags", tags]);
  rows.push([
    "Sources",
    sources > 0 ? (
      <a key="s" href="#doc-sources">
        {plural(sources, "source")}
      </a>
    ) : (
      "None"
    ),
  ]);
  return (
    <dl className="facts">
      {rows.map(([k, v]) => (
        <div key={k} className="fact">
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** What links here, by title. */
function LinkedFrom({ urls, links, head }: { urls: Urls; links: Links; head: number }) {
  const atHead = urls.at === undefined || urls.at >= head;
  const titleOf = useTitleOf();
  // One row per page, however many times it links here.
  const pages = [...new Map(links.inbound.map((l) => [l.path, l])).values()];
  return (
    <section className="panel-section">
      <h3 className="label">Linked from</h3>
      {pages.length > 0 ? (
        <ul className="linked">
          {pages.map((l) => (
            <li key={l.path}>
              <a href={urls.pinned(undefined).file(l.path)}>{titleOf(l.path)}</a>
              {l.kind === "source" && <span className="muted"> cites it</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="small muted">
          {atHead ? "Nothing links here." : "Shown for the latest version."}
        </p>
      )}
    </section>
  );
}
