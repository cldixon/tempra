import { when } from "../ui";
import type { Urls } from "../urls";
import type { Json, JsonObject, Links } from "./data";

/**
 * A concept's properties (from the "…" menu): its frontmatter, read-only, and what links to it
 * (tempra-dev: app/reader, The corner controls).
 */
export function Properties(props: { urls: Urls; fm: JsonObject; links: Links; head: number }) {
  return (
    <>
      <Frontmatter fm={props.fm} />
      <LinkedFrom urls={props.urls} links={props.links} head={props.head} />
    </>
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
