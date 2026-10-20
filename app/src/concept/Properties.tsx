import { day, plural, when } from "../ui";
import type { Urls } from "../urls";
import type { Namer } from "./Byline";
import { actedBy, type Json, type JsonObject, type Links, type Standing } from "./data";

/**
 * A concept's properties (from the "…" menu): its frontmatter, read-only, what links to it, and
 * where it stands with human verification (tempra-dev: app/reader, The corner controls;
 * decisions/verification-out-of-the-way).
 */
export function Properties(props: {
  urls: Urls;
  path: string;
  fm: JsonObject;
  links: Links;
  head: number;
  standing: Standing;
  name: Namer;
  /** The page is current (not a pinned old version), so it can be reviewed. */
  current: boolean;
  /** Closes the dialog (Review opens review mode under it). */
  onClose(): void;
}) {
  return (
    <>
      <Frontmatter fm={props.fm} />
      <LinkedFrom urls={props.urls} links={props.links} head={props.head} />
      <Verification
        urls={props.urls}
        path={props.path}
        standing={props.standing}
        name={props.name}
        current={props.current}
        onReview={props.onClose}
      />
    </>
  );
}

/** "Verified by you on Oct 9", "2 changes since you verified", "Not yet verified", and Review. */
function Verification(props: {
  urls: Urls;
  path: string;
  standing: Standing;
  name: Namer;
  current: boolean;
  onReview(): void;
}) {
  const { standing: s } = props;
  const v = s.verified;
  const by = v ? props.name(v.event.actor, actedBy(v.event)) : null;
  const whom = by?.you ? "you" : by?.name;
  const words =
    !v || !by
      ? "Not yet verified by a person"
      : s.since === 0
        ? `Verified by ${whom} on ${day(v.event.ts)}${v.version ? `, at version ${v.version.n}` : ""}`
        : `${plural(s.since, "change")} since ${whom} verified on ${day(v.event.ts)}`;
  const toReview = !v || s.since > 0;
  return (
    <section>
      <h3 className="label">Verification</h3>
      <p className="small muted">
        {words}
        {props.current && toReview && (
          <>
            {" · "}
            <a href={props.urls.review(props.path)} onClick={props.onReview}>
              Review
            </a>
          </>
        )}
      </p>
    </section>
  );
}

function Scalar({ v }: { v: Json }) {
  if (v === null) return <span className="muted">null</span>;
  if (typeof v === "string" && /^https?:\/\//i.test(v)) {
    return (
      <a href={v} rel="noopener noreferrer nofollow">
        {v}
      </a>
    );
  }
  return <>{String(v)}</>;
}

/** `{ by, at }` as "by … · at …". */
function stamp(v: Json): { by: string; at: string } | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  if (!Object.keys(v).every((k) => k === "by" || k === "at")) return null;
  return { by: String(v.by ?? ""), at: String(v.at ?? "") };
}

function FmValue({ k, v }: { k: string; v: Json }) {
  if (k === "sources" && Array.isArray(v)) {
    return (
      <a href="#sources">
        {v.length} source{v.length === 1 ? "" : "s"}
      </a>
    );
  }
  const stamps = Array.isArray(v) ? v.map(stamp) : [stamp(v)];
  if (stamps.length > 0 && stamps.every((s) => s !== null)) {
    return (
      <>
        {stamps.map((s, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: stamps are shown in order, never moved.
          <span key={i}>
            {s?.by}
            <div className="small muted">{when(s?.at ?? "")}</div>
          </span>
        ))}
      </>
    );
  }
  if (Array.isArray(v) && v.every((x) => x === null || typeof x !== "object")) {
    return (
      <>
        {v.map((x, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: list items are shown in order.
          <span key={i}>
            {i > 0 && ", "}
            <Scalar v={x} />
          </span>
        ))}
      </>
    );
  }
  if (v !== null && typeof v === "object")
    return <pre className="src">{JSON.stringify(v, null, 2)}</pre>;
  return <Scalar v={v} />;
}

/** The frontmatter, read-only. */
function Frontmatter({ fm }: { fm: JsonObject }) {
  return (
    <dl className="facts">
      {Object.entries(fm).map(([k, v]) => (
        <div key={k} className="fact">
          <dt>{k}</dt>
          <dd>
            <FmValue k={k} v={v} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** What links here, and the concept's own broken links. */
function LinkedFrom({ urls, links, head }: { urls: Urls; links: Links; head: number }) {
  const atHead = urls.at === undefined || urls.at >= head;
  return (
    <section>
      <h3 className="label">Linked from</h3>
      {links.inbound.length > 0 ? (
        <ul className="linked">
          {links.inbound.map((l) => (
            <li key={`${l.path} ${l.kind} ${l.raw}`}>
              <a href={urls.pinned(undefined).file(l.path)}>{l.path}</a>
              {l.kind === "source" && <span className="faint"> cites it</span>}
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
