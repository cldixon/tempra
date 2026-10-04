import { type FormEvent, useEffect, useState } from "react";
import { ApiError, api, useLoad } from "../api";
import { navigate } from "../router";
import {
  AtNotice,
  anchorId,
  Chip,
  Crumbs,
  formatSize,
  LibNav,
  Status,
  TrustChip,
  useScrollToHash,
  useTitle,
  when,
} from "../ui";
import { baseName, dirOf, enc, type Urls } from "../urls";

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
type JsonObject = { [k: string]: Json };

interface Source extends JsonObject {}

interface Sources {
  sources: Source[];
  unmatched_footnotes: string[];
}

/** GET …/render/{path}: the file as the app shows it (worker/src/ui/spa.ts). */
type Rendered =
  | {
      kind: "concept";
      path: string;
      head: number;
      seq: number;
      html: string;
      footnotes: Record<string, string>;
      sources: Sources;
    }
  | { kind: "derived"; path: string; head: number; seq: number; html: string }
  | {
      kind: "attachment";
      path: string;
      head: number;
      seq: number;
      size: number;
      media: string | null;
      hash: string;
    };

interface Concept {
  path: string;
  seq: number;
  hash: string;
  frontmatter: JsonObject;
  lint: { code: string; message: string }[];
  trust_tier: string;
  stale: boolean;
}

interface Links {
  inbound: { path: string; raw: string; kind: string }[];
  broken: { raw: string; path: string; kind: string }[];
}

interface HistoryEvent {
  seq: number;
  ts: string;
  actor: string;
  op: string;
  path: string;
  hash: string | null;
  meta: JsonObject | null;
}

/** Ops that change a file's content (or remove it), and so have a diff. */
export const CONTENT_OPS = new Set(["put", "import", "revert", "delete", "attach"]);

const DONE: Record<string, (actor: string) => string> = {
  restore: (actor) => `Restored. The ledger records it as a revert by ${actor}.`,
  verify: (actor) => `Verified as ${actor}. The trust tier is human-reviewed until the next edit.`,
};

export function File(props: { urls: Urls; path: string; done: string | null; actor: string }) {
  const { urls, path } = props;
  const loaded = useLoad(`file ${urls.file(path)}`, async () => {
    const rendered = await api<Rendered>(urls.api(`render/${enc(path)}`, { at: urls.at }));
    if (rendered.kind !== "concept") return { rendered } as const;
    const p = enc(rendered.path);
    const [concept, links, history] = await Promise.all([
      api<Concept>(urls.api(`files/${p}`, { at: urls.at })),
      api<Links>(urls.api(`links/${p}`, { at: urls.at })),
      api<{ events: HistoryEvent[] }>(urls.api(`history/${p}`)),
    ]);
    return { rendered, concept, links, history: history.events };
  });
  // index.md is the directory's own page.
  useEffect(() => {
    if (baseName(path) === "index.md") navigate(urls.tree(dirOf(path)), { replace: true });
  }, [urls, path]);
  useScrollToHash(loaded.state === "ready");
  const notice = props.done ? DONE[props.done]?.(props.actor) : undefined;
  return (
    <>
      <LibNav urls={urls} active="files" />
      {notice && <div className="notice ok">{notice}</div>}
      <Status loaded={loaded}>
        {(d) =>
          d.rendered.kind === "attachment" ? (
            <Attachment urls={urls} file={d.rendered} />
          ) : d.rendered.kind === "derived" ? (
            <Derived urls={urls} file={d.rendered} />
          ) : (
            "concept" in d &&
            d.concept && (
              <ConceptView
                urls={urls}
                rendered={d.rendered}
                concept={d.concept}
                links={d.links}
                history={d.history}
                onVerified={loaded.reload}
              />
            )
          )
        }
      </Status>
    </>
  );
}

function Attachment({
  urls,
  file,
}: {
  urls: Urls;
  file: Extract<Rendered, { kind: "attachment" }>;
}) {
  useTitle(`${file.path} · ${urls.slug}`);
  return (
    <>
      <Crumbs urls={urls} path={file.path} file />
      <h1>{baseName(file.path)}</h1>
      <AtNotice urls={urls} head={file.head} current={urls.pinned(undefined).file(file.path)} />
      <p className="muted">
        {file.media ?? "file"} · {formatSize(file.size)} · <code>{file.hash.slice(0, 12)}</code>
      </p>
      <p>
        <a href={urls.download(file.path)}>Download</a>
      </p>
      {file.media?.startsWith("image/") && (
        <p>
          <img src={urls.download(file.path)} alt={baseName(file.path)} />
        </p>
      )}
    </>
  );
}

function Derived({ urls, file }: { urls: Urls; file: Extract<Rendered, { kind: "derived" }> }) {
  useTitle(`${file.path} · ${urls.slug}`);
  return (
    <>
      <Crumbs urls={urls} path={file.path} file />
      <AtNotice urls={urls} head={file.head} current={urls.pinned(undefined).file(file.path)} />
      <p className="small muted">
        Synthesized by the server. <a href={urls.raw(file.path)}>Raw</a>
      </p>
      <Body html={file.html} />
    </>
  );
}

/**
 * A body as the server rendered it: no raw HTML, safe URLs only (worker/src/ui/markdown.ts).
 * The Wordgard reader replaces this (TEMPRA-11).
 */
function Body({ html }: { html: string }) {
  // biome-ignore lint/security/noDangerouslySetInnerHtml: the server's sanitizing renderer made it.
  return <article className="body prose" dangerouslySetInnerHTML={{ __html: html }} />;
}

function ConceptView(props: {
  urls: Urls;
  rendered: Extract<Rendered, { kind: "concept" }>;
  concept: Concept;
  links: Links;
  history: HistoryEvent[];
  onVerified(): void;
}) {
  const { urls, rendered: r, concept: c } = props;
  const fm = c.frontmatter;
  const title = typeof fm.title === "string" && fm.title ? fm.title : baseName(c.path);
  useTitle(`${title} · ${urls.slug}`);
  const status = typeof fm.status === "string" ? fm.status : "stable";
  return (
    <div className="layout">
      <div>
        <Crumbs urls={urls} path={c.path} file />
        <h1>{title}</h1>
        {typeof fm.description === "string" && <p className="muted">{fm.description}</p>}
        <div className="chips">
          {typeof fm.type === "string" && fm.type ? (
            <Chip text={fm.type} />
          ) : (
            <Chip text="no type" tone="bad" />
          )}
          <TrustChip tier={c.trust_tier} />
          {c.stale && (
            <Chip text="stale" tone="bad" title={`stale_after ${String(fm.stale_after)}`} />
          )}
          {status !== "stable" && <Chip text={status} tone="warn" />}
          {c.lint.length > 0 && <Chip text={`${c.lint.length} lint`} tone="warn" />}
        </div>
        <AtNotice urls={urls} head={r.head} current={urls.pinned(undefined).file(c.path)} />
        <Body html={r.html} />
        {c.lint.length > 0 && (
          <>
            <h2 id="lint">Lint</h2>
            <ul className="lint">
              {c.lint.map((l, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: lint warnings have no id.
                <li key={i}>
                  <code>{l.code}</code> {l.message}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <aside>
        <Frontmatter fm={fm} />
        <SourcesPanel urls={urls} data={r.sources} footnotes={r.footnotes} />
        <LinksPanel urls={urls} links={props.links} head={r.head} />
        <Verify urls={urls} concept={c} head={r.head} onVerified={props.onVerified} />
        <History urls={urls} concept={c} head={r.head} events={props.history} />
      </aside>
    </div>
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

function Frontmatter({ fm }: { fm: JsonObject }) {
  return (
    <section>
      <h2>Frontmatter</h2>
      <dl className="fm">
        {Object.entries(fm).map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>
              <FmValue k={k} v={v} />
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** Footnote definitions are HTML from the server's sanitizing renderer. */
function FootnoteHtml({ html }: { html: string }) {
  // biome-ignore lint/security/noDangerouslySetInnerHtml: the server's sanitizing renderer made it.
  return <div className="small" dangerouslySetInnerHTML={{ __html: html }} />;
}

function SourcesPanel(props: { urls: Urls; data: Sources; footnotes: Record<string, string> }) {
  const { urls, data, footnotes } = props;
  const used = new Set<string>();
  const items = data.sources.map((s, i) => {
    const id = typeof s.id === "string" ? s.id : null;
    if (id) used.add(id);
    const name = typeof s.title === "string" ? s.title : (id ?? "Source");
    const resource = typeof s.resource === "string" ? s.resource : null;
    const internal = (s.internal ?? null) as JsonObject | null;
    let where: React.ReactNode = null;
    if (internal?.broken) {
      where = (
        <>
          {resource} <Chip text="missing" tone="bad" />
        </>
      );
    } else if (internal && typeof internal.path === "string") {
      where = (
        <>
          <a href={urls.file(internal.path)}>{resource ?? internal.path}</a>{" "}
          {internal.trust_tier && <TrustChip tier={String(internal.trust_tier)} />}
          {internal.stale && <Chip text="stale" tone="bad" />}
          {internal.status && internal.status !== "stable" && (
            <Chip text={String(internal.status)} tone="warn" />
          )}
        </>
      );
    } else if (resource) where = <Scalar v={resource} />;
    const def = id ? footnotes[id] : undefined;
    const cited = typeof s.cited === "number" ? s.cited : 0;
    return (
      <li key={id ?? i} id={id ? anchorId("src", id) : undefined}>
        <strong>{name}</strong>
        {id && (
          <div className="small muted">
            [^{id}] · cited {cited}×
          </div>
        )}
        <div className="small">{where}</div>
        {def && (
          <div className="muted">
            <FootnoteHtml html={def} />
          </div>
        )}
      </li>
    );
  });
  const others = Object.entries(footnotes).filter(([label]) => !used.has(label));
  if (items.length === 0 && others.length === 0 && data.unmatched_footnotes.length === 0) {
    return null;
  }
  return (
    <section id="sources">
      <h2>Sources</h2>
      {items.length > 0 && <ul>{items}</ul>}
      {others.length > 0 && (
        <>
          <p className="small muted">Other footnotes</p>
          <ul>
            {others.map(([label, html]) => (
              <li key={label} id={anchorId("fn", label)}>
                <span className="small muted">[^{label}]</span>
                <FootnoteHtml html={html} />
              </li>
            ))}
          </ul>
        </>
      )}
      {data.unmatched_footnotes.length > 0 && (
        <p className="small warn">
          No source for {data.unmatched_footnotes.map((l) => `[^${l}]`).join(", ")}
        </p>
      )}
    </section>
  );
}

function LinksPanel({ urls, links, head }: { urls: Urls; links: Links; head: number }) {
  const atHead = urls.at === undefined || urls.at >= head;
  return (
    <section>
      <h2>Linked from</h2>
      {links.inbound.length > 0 ? (
        <ul>
          {links.inbound.map((l) => (
            <li key={`${l.path} ${l.kind} ${l.raw}`}>
              <a href={urls.pinned(undefined).file(l.path)}>{l.path}</a>
              {l.kind === "source" && <span className="small muted"> cites it</span>}
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
 * Human verification of the current version (spec: OKF conformance, What the service stamps).
 * A later ordinary write lapses it, so the panel says what it covers.
 */
function Verify(props: { urls: Urls; concept: Concept; head: number; onVerified(): void }) {
  const { urls, concept: c } = props;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (urls.at !== undefined && urls.at < props.head) return null;
  const list = Array.isArray(c.frontmatter.verified)
    ? (c.frontmatter.verified as JsonObject[])
    : [];
  const human = [...list].reverse().find((v) => String(v.by ?? "").startsWith("human:"));
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const note = String(new FormData(e.currentTarget).get("note") ?? "").trim();
    setBusy(true);
    setError(null);
    try {
      await api(urls.api(`verify/${enc(c.path)}`), {
        method: "POST",
        headers: note ? { "X-Note": encodeURIComponent(note) } : {},
      });
      navigate(`${urls.pinned(undefined).file(c.path)}?done=verify`, { replace: true });
      props.onVerified();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section>
      <h2>Verification</h2>
      {c.trust_tier === "human-reviewed" && human ? (
        <p className="small">
          <Chip text="human-reviewed" tone="ok" /> by {String(human.by)},{" "}
          {when(String(human.at ?? ""))}.
        </p>
      ) : human ? (
        <p className="small">
          Last verified by {String(human.by)} on {when(String(human.at ?? ""))}, but the content has
          changed since.
        </p>
      ) : (
        <p className="small muted">No human has verified this concept.</p>
      )}
      {error && <div className="notice">{error}</div>}
      {c.trust_tier !== "human-reviewed" && (
        <form onSubmit={submit}>
          <input type="text" name="note" placeholder="Note (optional)" />{" "}
          <button className="primary" type="submit" disabled={busy}>
            Verify this version
          </button>
        </form>
      )}
    </section>
  );
}

function History(props: { urls: Urls; concept: Concept; head: number; events: HistoryEvent[] }) {
  const { urls, concept: c, head, events } = props;
  const shown = [...events].reverse().slice(0, 50);
  // Time travel shortcuts (spec: Time travel in the UI).
  const verified = [...events]
    .reverse()
    .find((e) => e.op === "verify" && e.actor.startsWith("human:"));
  let sinceHuman: React.ReactNode;
  if (!verified) sinceHuman = "Never verified by a human.";
  else if (events.some((e) => e.seq > verified.seq && CONTENT_OPS.has(e.op))) {
    sinceHuman = (
      <>
        <a href={urls.diff(c.path, verified.seq)}>Changes since human verification</a> (seq{" "}
        {verified.seq}, {verified.actor})
      </>
    );
  } else sinceHuman = `No changes since ${verified.actor} verified it at seq ${verified.seq}.`;
  const pinnedOld = urls.at !== undefined && urls.at < head;
  const view = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const at = Number(new FormData(e.currentTarget).get("at"));
    navigate(urls.pinned(Number.isInteger(at) && at > 0 ? at : undefined).file(c.path));
  };
  return (
    <section>
      <h2>History</h2>
      <form className="inline" onSubmit={view}>
        <label className="small" htmlFor="at">
          View at sequence
        </label>{" "}
        <input
          key={urls.at ?? head}
          id="at"
          name="at"
          type="number"
          min={1}
          max={head}
          defaultValue={urls.at ?? head}
        />{" "}
        <button type="submit">View</button>
      </form>
      <p className="small">{sinceHuman}</p>
      <ol className="history">
        {shown.map((e) => {
          const note = typeof e.meta?.note === "string" ? ` · ${e.meta.note}` : "";
          const from = typeof e.meta?.from_path === "string" ? ` from ${e.meta.from_path}` : "";
          const label = (
            <>
              <strong>{e.seq}</strong> {e.op}
            </>
          );
          return (
            <li key={e.seq} className={e.seq === c.seq ? "current" : undefined}>
              {e.op === "delete" ? label : <a href={urls.pinned(e.seq).file(e.path)}>{label}</a>}
              {from} · {e.actor} · {when(e.ts)}
              {note}
              {CONTENT_OPS.has(e.op) && (
                <>
                  {" "}
                  · <a href={urls.diff(e.path, undefined, e.seq)}>diff</a>
                </>
              )}
            </li>
          );
        })}
      </ol>
      {events.length > shown.length && (
        <p className="small muted">{events.length - shown.length} older events not shown.</p>
      )}
      <p className="small">
        <a href={urls.raw(c.path)}>Raw source</a>
        {pinnedOld && (
          <>
            {" "}
            · <a href={urls.pinned(undefined).file(c.path)}>Current version</a> ·{" "}
            <a href={urls.restore(c.path, urls.at as number)}>Restore this version…</a>
          </>
        )}
      </p>
    </section>
  );
}
