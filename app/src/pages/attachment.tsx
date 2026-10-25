/**
 * What an attachment's page says about the file (TEMPRA-170, tempra-dev: app/media, The image's
 * page), as Wikipedia's File: pages do: what it shows, where it came from, who made it and under
 * what licence, every version, and where it is used. Pure helpers and presentational parts; the
 * page (`File.tsx`) loads the data.
 */
import { resolveLinkPath } from "@tempra/editor";
import { AgentName } from "../AgentName";
import type { ActedBy, ActorView } from "../agents";
import { Icon } from "../chrome";
import { type AttachSource, actedBy, type FileJson, type HistoryEvent } from "../concept/data";
import { Moment } from "../Moment";
import { prepare } from "../reader/prepare";
import { formatSize, relativeTime } from "../ui";
import { baseName, type Urls } from "../urls";

type Concept = Extract<FileJson, { kind: "concept" }>;

/** A page that uses the file: the figures it appears as, and the source entry citing it. */
export interface Use {
  path: string;
  /** Each figure showing this file: its number, caption (if any) and alt text. */
  figures: { n: number; caption: string | null; alt: string }[];
  /** The page's `sources` entry for the file (its title, else its resource), when it has one. */
  cites: string | null;
}

/** The host of a URL, without a leading `www.`; the URL itself when it does not parse. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * How a page uses the file at `file`: the figures (by the reader's numbering, so "Figure 3" is
 * the one a person sees) whose image is that file, and the source entry that names the URL it
 * was fetched from (or the file's own path).
 */
export function figureUse(
  file: string,
  concept: Concept,
  source: AttachSource | null | undefined,
): Use {
  const prepared = prepare(concept.doc, { path: concept.path });
  const figures = prepared.figures.flatMap((f) =>
    f.kind === "image" && f.path === file ? [{ n: f.n, caption: f.caption, alt: f.alt }] : [],
  );
  const urls = new Set([source?.url, source?.final_url].filter((u): u is string => !!u));
  const list = concept.frontmatter.sources;
  let cites: string | null = null;
  for (const s of Array.isArray(list) ? list : []) {
    if (!s || typeof s !== "object" || Array.isArray(s)) continue;
    const resource = typeof s.resource === "string" ? s.resource.trim() : "";
    if (!resource) continue;
    const internal = resource.startsWith("/") ? resolveLinkPath("", resource) : null;
    if (urls.has(resource) || internal === file) {
      cites = typeof s.title === "string" && s.title.trim() ? s.title.trim() : resource;
      break;
    }
  }
  return { path: concept.path, figures, cites };
}

/**
 * What the file shows: its own description, else the alt text of the first figure that uses it
 * (marked as such, since a figure's alt was written for that page, not for the file).
 */
export function describedAs(
  description: string | null | undefined,
  uses: readonly Use[] | null,
): { text: string; fromAlt: boolean } | null {
  if (description) return { text: description, fromAlt: false };
  for (const u of uses ?? []) {
    for (const f of u.figures) if (f.alt.trim()) return { text: f.alt.trim(), fromAlt: true };
  }
  return null;
}

/** One version of the file, as File history lists it. */
export interface Version {
  seq: number;
  ts: string;
  actor: string;
  by: ActedBy | null;
  /** "Added", "Replaced", or "Details changed" (the same bytes, a new description or type). */
  what: "Added" | "Replaced" | "Details changed";
  size: number | null;
  width: number | null;
  height: number | null;
  /** The version shown on the page (the newest, or the one the page is pinned to). */
  current: boolean;
}

const VERSION_OPS = new Set(["put", "import", "revert"]);

/**
 * Every version of the file from its history, newest first; the newest at or before `at` (the
 * version on screen) is current.
 */
export function versionsOf(events: readonly HistoryEvent[], at: number): Version[] {
  const out: Version[] = [];
  let first = true;
  for (const e of events) {
    if (e.op === "delete") first = true;
    if (!VERSION_OPS.has(e.op) || e.hash === null) continue;
    out.push({
      seq: e.seq,
      ts: e.ts,
      actor: e.actor,
      by: actedBy(e),
      what: first ? "Added" : e.prev_hash === e.hash ? "Details changed" : "Replaced",
      size: e.file?.size ?? null,
      width: e.file?.width ?? null,
      height: e.file?.height ?? null,
      current: false,
    });
    first = false;
  }
  out.reverse();
  const current = out.find((v) => v.seq <= at);
  if (current) current.current = true;
  return out;
}

/** "1.2 MB · 2400 × 1500", as much of it as is known. */
export function sizeText(size: number | null, width?: number | null, height?: number | null) {
  const parts: string[] = [];
  if (size !== null) parts.push(formatSize(size));
  if (width && height) parts.push(`${width} × ${height}`);
  return parts.join(" · ");
}

type Name = (actor: string, by: ActedBy | null) => ActorView;

/**
 * Source: "From example.com, fetched 2 hours ago" linking the URL (and where it was redirected
 * to), or "Uploaded by Claude Code for @dev" for bytes an agent sent; then the page that cites
 * it, when one does.
 */
export function SourceFact(props: {
  urls: Urls;
  source: AttachSource | null | undefined;
  /** The version on screen, for who uploaded it. */
  version: Version | null;
  uses: readonly Use[] | null;
  titles: ReadonlyMap<string, string>;
  name: Name;
}) {
  const { source, version } = props;
  const cited = (props.uses ?? []).find((u) => u.cites !== null);
  const redirected = source?.final_url && source.final_url !== source.url ? source.final_url : null;
  return (
    <>
      {source ? (
        <div>
          From{" "}
          <a href={source.url} rel="noopener noreferrer" target="_blank">
            {hostOf(source.url)}
          </a>
          {source.fetched_at && (
            <>
              , fetched <Moment ts={source.fetched_at} />
            </>
          )}
        </div>
      ) : version ? (
        <div>
          Uploaded by <AgentName who={props.name(version.actor, version.by)} />
        </div>
      ) : (
        <div className="muted">…</div>
      )}
      {redirected && (
        <div className="muted">
          Redirected to{" "}
          <a href={redirected} rel="noopener noreferrer" target="_blank">
            {hostOf(redirected)}
          </a>
        </div>
      )}
      {cited && (
        <div className="muted">
          Cited in{" "}
          <a href={props.urls.file(cited.path)}>
            {props.titles.get(cited.path) ?? baseName(cited.path)}
          </a>{" "}
          as “{cited.cites}”
        </div>
      )}
    </>
  );
}

/** Used in: each page that links the file, and the figures it appears as there. */
export function UsedIn(props: {
  urls: Urls;
  /** The pages linking it, in order; null while loading. */
  paths: readonly string[] | null;
  uses: readonly Use[] | null;
  titles: ReadonlyMap<string, string>;
}) {
  const { urls, paths } = props;
  if (paths === null) return <>…</>;
  if (paths.length === 0) return <span className="muted">No page links it</span>;
  return (
    <ul className="attachment-used">
      {paths.map((p) => {
        const figures = props.uses?.find((u) => u.path === p)?.figures ?? [];
        return (
          <li key={p}>
            <a href={urls.file(p)}>{props.titles.get(p) ?? baseName(p)}</a>
            {figures.map((f) => (
              <div key={f.n} className="attachment-figure">
                Figure {f.n}
                {f.caption ? `. ${f.caption}` : ""}
              </div>
            ))}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * File history: every version newest first, who and when, its size and dimensions, Download for
 * each (the version's own bytes, `?at=`), the one on screen marked Current.
 */
export function FileHistory(props: {
  urls: Urls;
  path: string;
  versions: readonly Version[];
  name: Name;
}) {
  const { urls, path, versions } = props;
  return (
    <section className="attachment-history" aria-labelledby="file-history">
      <h2 id="file-history" className="view-section-title">
        File history
      </h2>
      <ol>
        {versions.map((v) => (
          <li key={v.seq} className={v.current ? "current" : undefined}>
            <span className="attachment-version-when">
              <Moment ts={v.ts} />
              {v.current && <span className="chip">Current</span>}
            </span>
            <span className="attachment-version-who">
              {v.what} by <AgentName who={props.name(v.actor, v.by)} />
            </span>
            <span className="attachment-version-size muted">
              {sizeText(v.size, v.width, v.height)}
            </span>
            <a
              className="attachment-version-download"
              href={urls.pinned(v.seq).download(path)}
              download={baseName(path)}
            >
              <Icon name="download" /> Download
              <span className="visually-hidden"> the version from {relativeTime(v.ts)}</span>
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}
