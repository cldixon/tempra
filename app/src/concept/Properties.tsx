import { type ReactNode, useState } from "react";
import { actorText } from "../agents";
import { ApiError, api } from "../api";
import { Moment } from "../Moment";
import { navigate } from "../router";
import { Chip, day, plural } from "../ui";
import { enc, type Urls } from "../urls";
import type { Namer } from "./Byline";
import { actedBy, type Concept, type Json, type Links, type Standing, type WorkItem } from "./data";

/**
 * The Properties panel (take 4, TEMPRA-114; tempra-dev: app/reader, The panels): the concept's
 * facts (type, status, stale after, sources, path, generated), what links to it and its broken
 * links, the agents' notes on it (lint, work items), and the Verification section when there is
 * something to review (decisions/verification-out-of-the-way).
 */
export function PropertiesList(props: {
  urls: Urls;
  concept: Concept;
  links: Links;
  head: number;
  standing: Standing;
  name: Namer;
  work: WorkItem[];
  /** The page is current (not a pinned old version), so it can be reviewed. */
  current: boolean;
  /** Review mode is on (the changes since verification are drawn). */
  reviewing: boolean;
  /** A write member: may verify. */
  mayVerify: boolean;
  onVerified(): void;
}) {
  const { urls, concept: c } = props;
  return (
    <>
      <Facts concept={c} name={props.name} />
      <LinkedFrom urls={urls} links={props.links} head={props.head} />
      <AgentNotes concept={c} work={props.work} />
      {props.current && (
        <Verification
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
 * "2 changes since you verified" (or "Not yet verified by a person"), Show changes or Hide
 * changes, and Verify this version for a write member. Shown only when there is something to
 * review: not once the version on screen is the one a person verified.
 */
function Verification(props: {
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
  const v = s.verified;
  if (v && s.since === 0) return null;
  const by = v ? props.name(v.event.actor, actedBy(v.event)) : null;
  const whom = by?.you ? "you" : by?.name;
  const words =
    v && by
      ? `${plural(s.since, "change")} since ${whom} verified on ${day(v.event.ts)}`
      : "Not yet verified by a person";
  const plain = `${urls.pinned(undefined).file(path)}`;
  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(urls.api(`verify/${enc(path)}`), { method: "POST" });
      navigate(`${plain}?done=verify`, { replace: true });
      props.onVerified();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel-section verification" aria-label="Verification">
      <h3 className="label">Verification</h3>
      <p className="verification-state">{words}</p>
      <div className="actions">
        {props.reviewing ? (
          <a className="button" href={plain}>
            Hide changes
          </a>
        ) : (
          <a className="button" href={urls.review(path)}>
            Show changes
          </a>
        )}
        {/* In review mode the bar over the text carries Verify, with its note. */}
        {props.mayVerify && !props.reviewing && (
          <button type="button" className="primary" disabled={busy} onClick={verify}>
            Verify this version
          </button>
        )}
      </div>
      {error && <p className="small warn">{error}</p>}
    </section>
  );
}

/** A frontmatter value as text: a list joined, a link a link, an object as JSON. */
function Value({ v }: { v: Json }) {
  if (v === null) return <span className="muted">null</span>;
  if (typeof v === "string" && /^https?:\/\//i.test(v)) {
    return (
      <a href={v} rel="noopener noreferrer nofollow">
        {v}
      </a>
    );
  }
  if (Array.isArray(v) && v.every((x) => x === null || typeof x !== "object")) {
    return <>{v.map(String).join(", ")}</>;
  }
  if (typeof v === "object") return <pre className="src">{JSON.stringify(v, null, 2)}</pre>;
  return <>{String(v)}</>;
}

/** `generated: { by, at }` as who and when. */
function stamp(v: Json | undefined): { by: string; at: string } | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return { by: String(v.by ?? ""), at: String(v.at ?? "") };
}

/** The concept's facts, read-only: the frontmatter a person asks about, in a fixed order. */
function Facts({ concept: c, name }: { concept: Concept; name: Namer }) {
  const fm = c.frontmatter;
  const sources = Array.isArray(fm.sources) ? fm.sources.length : 0;
  const generated = stamp(fm.generated);
  const rows: [string, ReactNode][] = [
    [
      "Type",
      typeof fm.type === "string" && fm.type ? fm.type : <Chip key="t" text="no type" tone="bad" />,
    ],
  ];
  if (fm.status !== undefined) rows.push(["Status", <Value key="s" v={fm.status} />]);
  if (fm.stale_after !== undefined) {
    rows.push([
      "Stale after",
      <span key="sa">
        {day(String(fm.stale_after))}
        {c.stale && <Chip text="stale" tone="bad" />}
        {c.stale_soon && <Chip text="stale soon" />}
      </span>,
    ]);
  }
  if (fm.tags !== undefined) rows.push(["Tags", <Value key="t" v={fm.tags} />]);
  if (fm.resource !== undefined) rows.push(["Resource", <Value key="r" v={fm.resource} />]);
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
  rows.push(["Path", <code key="p">{c.path}</code>]);
  if (generated) {
    rows.push([
      "Generated",
      <span key="g">
        {generated.at ? <Moment ts={generated.at} /> : ""}
        {generated.by && <div className="small muted">{actorText(name(generated.by))}</div>}
      </span>,
    ]);
  }
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

/** What links here, and the concept's own broken links. */
function LinkedFrom({ urls, links, head }: { urls: Urls; links: Links; head: number }) {
  const atHead = urls.at === undefined || urls.at >= head;
  return (
    <section className="panel-section">
      <h3 className="label">Linked from</h3>
      {links.inbound.length > 0 ? (
        <ul className="linked">
          {links.inbound.map((l) => (
            <li key={`${l.path} ${l.kind} ${l.raw}`}>
              <a href={urls.pinned(undefined).file(l.path)}>{l.path}</a>
              {l.kind === "source" && <span className="muted"> cites it</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="small muted">
          {atHead ? "Nothing links here." : "Inbound links are shown for the current version."}
        </p>
      )}
      {links.broken.length > 0 && (
        <p className="small warn">
          Broken:{" "}
          {links.broken.map((b, i) => (
            <span key={`${b.raw} ${b.path}`}>
              {i > 0 && ", "}
              <code>{b.raw}</code>
            </span>
          ))}
        </p>
      )}
    </section>
  );
}

/**
 * What agents should fix in this concept: its lint and its work items (broken links, staleness,
 * structure), with what to do about each. For people to see, not to act on.
 */
function AgentNotes({ concept: c, work }: { concept: Concept; work: WorkItem[] }) {
  const count = c.lint.length + work.length;
  return (
    <section className="panel-section" aria-label="Agent notes">
      <h3 className="label">Agent notes{count > 0 ? ` (${count})` : ""}</h3>
      {count === 0 ? (
        <p className="small muted">Nothing for agents to fix here.</p>
      ) : (
        <ul className="notes-list">
          {c.lint.map((l, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: lint warnings have no id.
            <li key={i}>
              <Chip text="lint" /> <code>{l.code}</code> <span className="muted">{l.message}</span>
            </li>
          ))}
          {work.map((w) => (
            <li key={`${w.kind} ${w.detail}`}>
              <Chip
                text={w.kind.replace("_", " ")}
                tone={w.kind === "structure" ? "warn" : "bad"}
              />{" "}
              <span>{w.detail}</span>
              <div className="muted">→ {w.suggested_action}</div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
