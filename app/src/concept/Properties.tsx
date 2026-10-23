import { Fragment, type ReactNode, useState } from "react";
import { AgentName } from "../AgentName";
import { actorText } from "../agents";
import { ApiError } from "../api";
import { Moment } from "../Moment";
import { day, plural } from "../ui";
import type { Urls } from "../urls";
import { useTitleOf } from "../Workspace";
import type { Namer } from "./Byline";
import { changesSince, markChecked } from "./Checked";
import { actedBy, type Concept, type Json, type Links, type Standing, type WorkItem } from "./data";

/**
 * The Properties panel (take 4, TEMPRA-114; TEMPRA-122 and 134; tempra-dev: app/reader, The
 * panels): short and in people's words. What a reader needs (status, stale or not, who changed
 * it last, type, tags, sources, what links here by title), then Check when there is something to
 * do, then For agents (n), closed: the path, who generated it, its lint and work items in plain
 * words, its broken links (decisions/take4-followups-ui-only).
 */
export function PropertiesList(props: {
  urls: Urls;
  concept: Concept;
  links: Links;
  head: number;
  standing: Standing;
  name: Namer;
  work: WorkItem[];
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
      <ForAgents concept={c} links={props.links} work={props.work} name={props.name} />
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

/** A note's text with its `code` spans drawn as code, not as backticks. */
function Words({ text: t }: { text: string }) {
  const parts = t.split("`");
  return (
    <>
      {parts.map((p, i) =>
        // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one string, in order.
        i % 2 === 1 ? <code key={i}>{p}</code> : <Fragment key={i}>{p}</Fragment>,
      )}
    </>
  );
}

/** `generated: { by, at }`, if it is there. */
function stamp(v: Json | undefined): { by: string; at: string } | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return { by: String(v.by ?? ""), at: String(v.at ?? "") };
}

/**
 * For agents (n), closed: what an agent reads about the page and would fix (its path, who
 * generated it, its lint and work items, its broken links). People can look; the page's own
 * words stay above. View Markdown shows the file itself.
 */
function ForAgents(props: { concept: Concept; links: Links; work: WorkItem[]; name: Namer }) {
  const { concept: c, links, work, name } = props;
  const generated = stamp(c.frontmatter.generated);
  const notes = c.lint.length + work.length + (links.broken.length > 0 ? 1 : 0);
  return (
    <details className="panel-section for-agents">
      <summary className="label">For agents{notes > 0 ? ` (${notes})` : ""}</summary>
      <dl className="facts">
        <div className="fact">
          <dt>Path</dt>
          <dd>
            <code>{c.path}</code>
          </dd>
        </div>
        {generated?.by && (
          <div className="fact">
            <dt>Generated</dt>
            <dd>
              {actorText(name(generated.by))}
              {generated.at && (
                <>
                  , <Moment ts={generated.at} />
                </>
              )}
            </dd>
          </div>
        )}
      </dl>
      {notes > 0 ? (
        <ul className="notes-list">
          {c.lint.map((l, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: lint warnings have no id.
            <li key={i}>
              <Words text={l.message} />
            </li>
          ))}
          {work.map((w) => (
            <li key={`${w.kind} ${w.detail}`}>
              <Words text={w.detail} />
            </li>
          ))}
          {links.broken.length > 0 && (
            <li>
              {links.broken.length === 1 ? "A link leads nowhere: " : "Links that lead nowhere: "}
              {links.broken.map((b, i) => (
                <span key={`${b.raw} ${b.path}`}>
                  {i > 0 && ", "}
                  <code>{b.raw}</code>
                </span>
              ))}
            </li>
          )}
        </ul>
      ) : (
        <p className="small muted">Nothing for agents to fix here.</p>
      )}
    </details>
  );
}
