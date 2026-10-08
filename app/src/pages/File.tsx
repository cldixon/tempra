import {
  type Doc,
  fromTree,
  type LinkTarget,
  linkParam,
  type Parsed,
  type ParseOptions,
  toHTML,
  type WordDiff,
  wordDiff,
} from "@tempra/editor";
import type { Hovered, Reader as ReaderHandle } from "@tempra/editor/view";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api, prefetch, useLoad } from "../api";
import {
  CommentsPanel,
  highlightsOf,
  placeThreads,
  type Thread,
  useDraft,
  useThreads,
} from "../Comments";
import { type Glyph, Icon, Menu } from "../chrome";
import {
  type Base,
  type Frontmatter as FmObject,
  type FormState,
  FrontmatterForm,
  formOf,
  frontmatterOf,
  isConflict,
  libraryTypes,
  linkTarget,
  type Merge,
  MergeView,
  saveConcept,
  startMerge,
  uploadImage,
} from "../Editor";
import { type FeedEvent, useFeed } from "../live";
import { registerPrefetch } from "../prefetch";
import { el, Reader } from "../Reader";
import { pushRecent } from "../recent";
import { navigate, setLeaveGuard } from "../router";
import {
  Ago,
  AtNotice,
  ago,
  anchorId,
  Chip,
  Crumbs,
  formatSize,
  Status,
  useAgo,
  useScrollToHash,
  useTitle,
  when,
} from "../ui";
import { baseName, dirOf, enc, type Urls } from "../urls";
import { PanelHost, type PanelId, usePanels } from "../Workspace";

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
type JsonObject = { [k: string]: Json };

interface Source extends JsonObject {}

interface Sources {
  sources: Source[];
  unmatched_footnotes: string[];
}

/** GET …/files/{path} as JSON: what each kind of file is. */
type FileJson =
  | {
      kind: "concept";
      path: string;
      seq: number;
      hash: string;
      /** The body as stored: a tree, links at their targets' current paths. */
      doc: Doc;
      frontmatter: JsonObject;
      lint: { code: string; message: string }[];
      trust_tier: string;
      stale: boolean;
    }
  | { kind: "derived"; path: string; seq: number; doc: Doc }
  | {
      kind: "attachment";
      path: string;
      seq: number;
      size: number;
      media: string | null;
      hash: string;
    };

type Concept = Extract<FileJson, { kind: "concept" }>;

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

interface WorkItem {
  kind: string;
  path: string;
  since: string;
  detail: string;
  suggested_action: string;
}

/** Ops that change a file's content (or remove it), and so have a diff. */
export const CONTENT_OPS = new Set(["put", "import", "revert", "delete", "attach"]);

const DONE: Record<string, (actor: string) => string> = {
  restore: (actor) => `Restored. The ledger records it as a revert by ${actor}.`,
  verify: (actor) => `Verified as ${actor}. The trust tier is human-reviewed until the next edit.`,
};

/** Where links and images in a body point in the app, as the server's plain pages did. */
function bodyHref(urls: Urls) {
  return (t: LinkTarget | null, _raw: string, kind: "link" | "image"): string | null => {
    if (!t) return null;
    if (t.kind !== "internal") return t.href;
    if (t.dir || t.path === "") return urls.tree(t.path) + (t.anchor ?? "");
    if (baseName(t.path) === "index.md") return urls.tree(dirOf(t.path)) + (t.anchor ?? "");
    return kind === "image" ? urls.download(t.path) : urls.file(t.path, t.anchor);
  };
}

/** What a file's page shows: the file, the head, and for a concept its context. */
export interface FileData {
  file: FileJson;
  head: number;
  extra: {
    concept: Extract<FileJson, { kind: "concept" }>;
    sources: Sources;
    links: Links;
    history: HistoryEvent[];
    work: WorkItem[];
  } | null;
}

/** Whether a path can be a concept: markdown, and not a synthesized index.md or log.md. */
const isConceptPath = (path: string) =>
  path.endsWith(".md") && !/(^|\/)(index|log)\.md$/.test(path);

/** The cache key of a file's page (see useLoad). */
export const fileKey = (urls: Urls, path: string) => `file ${urls.file(path)}`;

/**
 * Everything a file's page shows, in one round of requests: the file and, for a concept, its
 * sources, links, history and own work items (asked for in parallel; a file that is not a
 * concept answers those with errors, which are then ignored).
 */
export async function loadFile(urls: Urls, path: string): Promise<FileData> {
  const p = enc(path);
  const extra = <T,>(r: Promise<T>) =>
    r.then(
      (v) => ({ v }),
      (e: unknown) => ({ e }),
    );
  const skip = Promise.resolve({ e: null });
  // Only a concept has sources, links and history; the name says which files can be one.
  const concept = isConceptPath(path);
  const [file, stats, sources, links, history, work] = await Promise.all([
    api<FileJson>(urls.api(`files/${p}`, { at: urls.at })),
    api<{ seq: number }>(urls.api("stats")),
    concept ? extra(api<Sources>(urls.api(`sources/${p}`, { at: urls.at }))) : skip,
    concept ? extra(api<Links>(urls.api(`links/${p}`, { at: urls.at }))) : skip,
    concept ? extra(api<{ events: HistoryEvent[] }>(urls.api(`history/${p}`))) : skip,
    concept && urls.at === undefined
      ? extra(api<{ items: WorkItem[] }>(urls.api("work", { path, limit: 500 })))
      : Promise.resolve({ v: { items: [] as WorkItem[] } }),
  ]);
  const head = stats.seq;
  if (file.kind !== "concept") return { file, head, extra: null };
  // A concept reached by another spelling of its path: ask again by its own.
  if (!concept) return loadFile(urls, file.path);
  for (const r of [sources, links, history, work]) if ("e" in r) throw r.e;
  const got = <T,>(r: { v: T } | { e: unknown }) => (r as { v: T }).v;
  return {
    file,
    head,
    extra: {
      concept: file,
      sources: got(sources),
      links: got(links),
      history: got(history).events,
      work: got(work).items,
    },
  };
}

// Hovering a file in the tree, or picking it in the switcher, starts loading its page.
registerPrefetch((urls, path) => prefetch(fileKey(urls, path), () => loadFile(urls, path)));

export function File(props: { urls: Urls; path: string; done: string | null; actor: string }) {
  const { urls, path } = props;
  const loaded = useLoad(fileKey(urls, path), () => loadFile(urls, path));
  // A concept's comment threads load beside it, and reload on their own (comments are not
  // content: a new comment never redraws the body).
  const threads = useThreads(urls, isConceptPath(path) ? path : null);
  // index.md is the directory's own page.
  useEffect(() => {
    if (baseName(path) === "index.md") navigate(urls.tree(dirOf(path)), { replace: true });
  }, [urls, path]);
  useScrollToHash(loaded.state === "ready");
  const notice = props.done ? DONE[props.done]?.(props.actor) : undefined;

  // Live (tempra-dev: app/live): someone else's change to this file shows in the cluster, and the
  // new version swaps in by itself only while the reader is idle. Pinned versions stay put.
  const [change, setChange] = useState<FeedEvent | null>(null);
  const shown = loaded.state === "ready" ? loaded.data : null;
  const swap = useCallback(() => {
    setChange(null);
    loaded.reload();
  }, [loaded.reload]);
  useFeed(
    urls,
    urls.at === undefined && shown ? shown.head : null,
    (events) => {
      if (urls.at !== undefined || !shown) return;
      const path = shown.file.path;
      if (events.some((e) => e.op === "comment" && e.path === path)) threads.reload();
      const mine = events.filter(
        (e) =>
          e.seq > shown.head &&
          (e.path === path || e.from_path === path) &&
          e.op !== "comment" &&
          e.actor !== props.actor,
      );
      const last = mine[mine.length - 1];
      if (last) setChange(last);
    },
    swap,
  );
  // A page drawn from the cache catches up in the background: a change it now shows is no news.
  useEffect(() => {
    if (change && shown && change.seq <= shown.head) setChange(null);
  }, [change, shown]);
  const idle = useIdle(15_000);
  // While someone edits, a new version never swaps in by itself (the merge happens at save).
  const [editing, setEditing] = useState(false);
  const swappable = !editing && change !== null && change.op !== "delete" && change.op !== "move";
  useEffect(() => {
    if (swappable && idle) swap();
  }, [swappable, idle, swap]);
  const live: Live | null =
    change && shown ? { change, shownSeq: shown.file.seq, onSwap: editing ? null : swap } : null;
  const concept = loaded.state === "ready" && loaded.data.extra;
  return (
    <>
      {/* A concept's panel keeps its place while the page loads (no column jump). */}
      {!concept && isConceptPath(path) && loaded.state !== "error" && <PanelHost>{null}</PanelHost>}
      {concept ? (
        <ConceptView
          urls={urls}
          concept={concept.concept}
          head={loaded.data.head}
          sources={concept.sources}
          links={concept.links}
          history={concept.history}
          work={concept.work}
          threads={threads.state === "ready" ? threads.data.threads : null}
          threadsError={threads.state === "error" ? threads.error.message : null}
          notice={notice}
          live={live}
          onCommented={threads.reload}
          onVerified={loaded.reload}
          onEditing={setEditing}
        />
      ) : (
        <article className="doc">
          {notice && <div className="notice">{notice}</div>}
          {live && <LiveNotice urls={urls} live={live} />}
          <Status loaded={loaded}>
            {(d) =>
              d.file.kind === "attachment" ? (
                <Attachment urls={urls} file={d.file} head={d.head} />
              ) : d.file.kind === "derived" ? (
                <Derived urls={urls} file={d.file} head={d.head} />
              ) : null
            }
          </Status>
        </article>
      )}
    </>
  );
}

/** Someone else's change to the open file, as the page shows it. */
interface Live {
  change: FeedEvent;
  /** The sequence of the version on screen, for the diff. */
  shownSeq: number;
  /** Null while editing: the change is merged at save instead. */
  onSwap: (() => void) | null;
}

/**
 * True once the person has not scrolled, typed, clicked or selected text for `ms`: the moment a
 * new version may replace what they are reading without pulling it from under them.
 */
function useIdle(ms: number): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    let last = Date.now();
    const busy = () => {
      last = Date.now();
      setIdle(false);
    };
    const kinds = ["scroll", "wheel", "keydown", "pointerdown", "selectionchange"] as const;
    for (const k of kinds) document.addEventListener(k, busy, { passive: true, capture: true });
    const timer = setInterval(() => {
      const selecting = !(document.getSelection()?.isCollapsed ?? true);
      setIdle(!selecting && Date.now() - last >= ms);
    }, 1000);
    return () => {
      clearInterval(timer);
      for (const k of kinds) document.removeEventListener(k, busy, { capture: true });
    };
  }, [ms]);
  return idle;
}

/** "claude-ai/connector changed this 4 s ago, seq 41: the note." */
function changeLine(e: FeedEvent, since: string): string {
  const what =
    e.op === "delete"
      ? "deleted this"
      : e.op === "move"
        ? "moved this"
        : e.op === "verify"
          ? "verified this"
          : "changed this";
  return `${e.actor} ${what} ${since} ago, seq ${e.seq}${e.note ? `: ${e.note}` : ""}.`;
}

/**
 * A newer version, in the cluster: a pulsing glyph that opens who wrote it, Show diff and Show
 * new version (while editing: the change is merged at save).
 */
function NewVersion({ urls, live }: { urls: Urls; live: Live }) {
  const e = live.change;
  const since = useAgo(e.ts);
  return (
    <div className="new-version">
      <Menu
        name="New version"
        title={`New version · ${e.actor}${e.note ? ` · ${e.note}` : ""}`}
        buttonClass="icon-button"
        align="end"
        label={<Icon name="refresh" />}
      >
        <p role="status">{changeLine(e, since)}</p>
        {CONTENT_OPS.has(e.op) && <a href={urls.diff(e.path, live.shownSeq, e.seq)}>Show diff</a>}
        {live.onSwap ? (
          <button type="button" onClick={live.onSwap}>
            Show new version
          </button>
        ) : (
          <p>Your edit will be merged with it when you save.</p>
        )}
      </Menu>
    </div>
  );
}

/**
 * A change the cluster cannot show: the open file was moved or deleted (or it is not a concept).
 * A notice in the sheet, with the way to where it went.
 */
function LiveNotice({ urls, live }: { urls: Urls; live: Live }) {
  const e = live.change;
  const since = useAgo(e.ts);
  return (
    <div className="notice" role="status">
      {changeLine(e, since)}{" "}
      {e.op === "move" ? (
        <a href={urls.pinned(undefined).file(e.path)}>Go to {e.path}</a>
      ) : e.op === "delete" ? (
        <a href={urls.tree(dirOf(e.from_path ?? e.path))}>Back to the directory</a>
      ) : (
        <>
          {CONTENT_OPS.has(e.op) && (
            <>
              <a href={urls.diff(e.path, live.shownSeq, e.seq)}>Show diff</a> ·{" "}
            </>
          )}
          {live.onSwap && (
            <button type="button" onClick={live.onSwap}>
              Show new version
            </button>
          )}
        </>
      )}
    </div>
  );
}

function Attachment(props: {
  urls: Urls;
  head: number;
  file: Extract<FileJson, { kind: "attachment" }>;
}) {
  const { urls, file } = props;
  useTitle(`${file.path} · ${urls.slug}`);
  return (
    <>
      <Crumbs urls={urls} path={file.path} file />
      <h1 className="doc-title">{baseName(file.path)}</h1>
      <AtNotice urls={urls} head={props.head} current={urls.pinned(undefined).file(file.path)} />
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

/** A synthesized file (index.md, log.md) in the reader: the file as an agent reads it. */
export function Derived(props: {
  urls: Urls;
  head: number;
  file: Extract<FileJson, { kind: "derived" }>;
}) {
  const { urls, file } = props;
  useTitle(`${file.path} · ${urls.slug}`);
  const parsed = useMemo(
    () => fromTree(file.doc, { path: file.path, href: bodyHref(urls), footnote: () => null }),
    [file, urls],
  );
  return (
    <>
      <Crumbs urls={urls} path={file.path} file />
      <AtNotice urls={urls} head={props.head} current={urls.pinned(undefined).file(file.path)} />
      <p className="small muted">
        Synthesized by the server. <a href={urls.raw(file.path)}>Raw</a>
      </p>
      <Reader parsed={parsed} tooltip={() => null} diff={null} hideFirst={false} />
    </>
  );
}

/** The trust tier in a few words, for the crumb row and the Review panel's head. */
function trustWords(tier: string | undefined): string {
  if (tier === "human-reviewed") return "human-reviewed";
  if (tier === "machine-confirmed") return "machine-confirmed";
  return "unverified";
}

const PANEL_TITLES: Record<PanelId, string> = {
  comments: "Comments",
  review: "Review",
  contents: "Contents & sources",
  history: "History",
  properties: "Properties",
};

const PANEL_GLYPHS: Record<PanelId, Glyph> = {
  comments: "comments",
  review: "review",
  contents: "contents",
  history: "history",
  properties: "properties",
};

function ConceptView(props: {
  urls: Urls;
  concept: Concept;
  head: number;
  sources: Sources;
  links: Links;
  history: HistoryEvent[];
  work: WorkItem[];
  /** Null while they load, or when they failed (`threadsError`). */
  threads: Thread[] | null;
  threadsError: string | null;
  /** What the last action did (verified, restored). */
  notice: string | undefined;
  /** Someone else's change since this version, if any. */
  live: Live | null;
  onCommented(): void;
  onVerified(): void;
  /** Editing started or ended (the page then holds new versions back). */
  onEditing(on: boolean): void;
}) {
  const { urls, head, live } = props;
  const panels = usePanels();
  // While editing, the page keeps the version the edit started from (a refresh must not
  // redraw the body under the person's hands).
  // The file as stored (frontmatter and body), shown in place of the reader.
  const [markdown, setMarkdown] = useState(false);
  const [frozen, setFrozen] = useState<{
    concept: Concept;
    sources: Sources;
    links: Links;
  } | null>(null);
  const c = frozen?.concept ?? props.concept;
  const sources = frozen?.sources ?? props.sources;
  const links = frozen?.links ?? props.links;
  const editing = frozen !== null;
  const fm = c.frontmatter;
  const title = typeof fm.title === "string" && fm.title ? fm.title : baseName(c.path);
  useTitle(`${title} · ${urls.slug}`);
  const status = typeof fm.status === "string" ? fm.status : null;

  // Footnote markers are numbers: the sources in their order, then the body's other footnotes
  // as they are met (`numbers` fills in as the body is parsed; the panel reads it after).
  const { parseOptions, numbers } = useMemo(() => {
    const ids = sources.sources.map((s) => s.id).filter((id) => typeof id === "string");
    const numbers = new Map<string, number>(ids.map((id, i) => [id, i + 1]));
    const sourceIds = new Set(ids);
    const broken = new Set(links.broken.map((b) => b.path));
    const parseOptions: ParseOptions = {
      path: c.path,
      href: bodyHref(urls),
      exists: (path) => !broken.has(path),
      footnote: (label, defined) => {
        if (!sourceIds.has(label) && !defined) return null;
        if (!numbers.has(label)) numbers.set(label, numbers.size + 1);
        const prefix = sourceIds.has(label) ? "src" : "fn";
        return { href: `#${anchorId(prefix, label)}`, mark: String(numbers.get(label)) };
      },
    };
    return { parseOptions, numbers };
  }, [c.path, urls, sources, links]);
  const parsed = useMemo(() => fromTree(c.doc, parseOptions), [c.doc, parseOptions]);
  // A leading heading that repeats the title is not shown twice (the stored body is unchanged).
  const first = parsed.headings[0];
  const hideFirst =
    first?.pos === 0 && first.text.trim().toLowerCase() === title.trim().toLowerCase();
  const footnotes = useMemo(
    () => Object.fromEntries(parsed.footnotes.map((f) => [f.label, toHTML(f.doc)])),
    [parsed],
  );
  const tooltip = useTooltips(urls, sources, footnotes);
  const changes = useVerificationDiff(urls, c, parsed, props.history, head);
  const edit = useEditing({
    urls,
    concept: c,
    start: () => {
      changes.off();
      setFrozen({ concept: props.concept, sources: props.sources, links: props.links });
    },
    end: () => setFrozen(null),
    onSaved: props.onVerified,
    onEditing: props.onEditing,
    parseOptions,
  });

  // Comments: each thread's quote found in the body on screen, highlighted while open.
  const writable = urls.at === undefined || urls.at >= head;
  const [active, setActive] = useState<string | null>(null);
  const placed = useMemo(() => placeThreads(props.threads ?? [], parsed), [props.threads, parsed]);
  const openThreads = placed.filter((t) => t.status === "open").length;
  // Comment on selected text: the reader's popover starts a draft, shown in the Comments panel.
  const draft = useDraft(parsed);
  const openPanel = panels?.open;
  const startDraft = useCallback(
    (range: { from: number; to: number }) => {
      draft.start(range);
      openPanel?.("comments");
    },
    [draft.start, openPanel],
  );
  // A highlight clicked in the body shows its thread.
  const onMark = useCallback(
    (id: string | null) => {
      setActive(id);
      if (id) openPanel?.("comments");
    },
    [openPanel],
  );
  const highlights = useMemo(
    () => highlightsOf(placed, active, draft.draft),
    [placed, active, draft.draft],
  );

  // Recent files, for the quick switcher.
  useEffect(() => {
    if (urls.at === undefined) pushRecent(urls, { path: c.path, title });
  }, [urls, c.path, title]);

  const work = props.work.filter((w) => w.kind !== "comment" && w.kind !== "lint");
  const issues = c.lint.length + work.length;
  const counts: Record<PanelId, string> = {
    comments: openThreads > 0 ? `${openThreads} open` : "",
    review: issues > 0 ? `${issues} to fix` : trustWords(c.trust_tier),
    contents: "",
    history: `seq ${c.seq}`,
    properties: editing ? "editing" : "",
  };
  const panel = panels?.panel ?? null;
  const moved = live && (live.change.op === "move" || live.change.op === "delete");

  return (
    <>
      <div className="cluster" role="toolbar" aria-label="Concept">
        {live && !moved && (
          <>
            <NewVersion urls={urls} live={live} />
            <span className="cluster-sep" />
          </>
        )}
        {writable && (
          <button
            type="button"
            className="icon-button"
            aria-label="Edit"
            title={editing ? "Stop editing" : "Edit"}
            aria-pressed={editing}
            onClick={() => {
              if (editing) edit.cancel();
              else {
                setMarkdown(false);
                edit.start();
              }
            }}
          >
            <Icon name="edit" />
          </button>
        )}
        <button
          type="button"
          className="icon-button"
          aria-label="Markdown"
          title="Markdown: the file as stored, as an agent reads it"
          aria-pressed={markdown && !editing}
          disabled={editing}
          onClick={() => setMarkdown((m) => !m)}
        >
          <Icon name="markdown" />
        </button>
        {panels && (
          <>
            <span className="cluster-sep" />
            {(Object.keys(PANEL_TITLES) as PanelId[]).map((id) => (
              <button
                key={id}
                type="button"
                className="icon-button"
                aria-label={PANEL_TITLES[id]}
                title={PANEL_TITLES[id]}
                aria-pressed={panel === id}
                onClick={() => panels.toggle(id)}
              >
                <Icon name={PANEL_GLYPHS[id]} />
                {id === "comments" && openThreads > 0 && <span className="dot" />}
              </button>
            ))}
          </>
        )}
      </div>
      {editing && !edit.merging && edit.bar}
      <article className="doc">
        {props.notice && <div className="notice">{props.notice}</div>}
        {moved && live && <LiveNotice urls={urls} live={live} />}
        <AtNotice urls={urls} head={head} current={urls.pinned(undefined).file(c.path)} />
        {edit.saved && (
          <div className="notice" role="status">
            Saved.
            {edit.saved.lint.length > 0 &&
              ` Lint: ${edit.saved.lint.map((l) => l.message).join(" ")}`}
          </div>
        )}
        {edit.merging && edit.bar}
        <Crumbs urls={urls} path={c.path} file>
          <span aria-hidden="true">·</span>
          <span>{trustWords(c.trust_tier)}</span>
          {c.stale && (
            <>
              <span aria-hidden="true">·</span>
              <span>stale</span>
            </>
          )}
          {status && status !== "stable" && (
            <>
              <span aria-hidden="true">·</span>
              <span>{status}</span>
            </>
          )}
        </Crumbs>
        <header className="doc-head">
          <h1 className="doc-title">{title}</h1>
          {typeof fm.description === "string" && <p className="doc-tagline">{fm.description}</p>}
        </header>
        {markdown && !editing && <RawMarkdown urls={urls} path={c.path} hash={c.hash} />}
        {/* Kept mounted under the markdown, so comments and the editor keep their reader. */}
        <div hidden={markdown && !editing}>
          <Reader
            key={edit.generation}
            parsed={parsed}
            tooltip={tooltip}
            diff={editing ? null : changes.diff}
            hideFirst={hideFirst}
            highlights={highlights}
            onMark={onMark}
            onComment={writable ? startDraft : undefined}
            handle={edit.reader}
          />
        </div>
      </article>
      {/* The open panel, beside the sheet (tempra-dev: app/workspace, The panels). */}
      <PanelHost>
        {panel && (
          <>
            <div className="panel-head">
              <h2>{PANEL_TITLES[panel]}</h2>
              {counts[panel] && <span className="count">{counts[panel]}</span>}
              <span className="spacer" />
              <button
                type="button"
                className="panel-close"
                aria-label="Close panel"
                title="Close"
                onClick={() => panels?.close()}
              >
                ×
              </button>
            </div>
            <div className="panel-body">
              {panel === "comments" &&
                (props.threads || props.threadsError ? (
                  <CommentsPanel
                    urls={urls}
                    path={c.path}
                    placed={placed}
                    error={props.threadsError}
                    writable={writable}
                    draft={draft.draft}
                    onClearDraft={draft.clear}
                    active={active}
                    onActive={setActive}
                    onChanged={props.onCommented}
                  />
                ) : (
                  <p className="small muted">Loading…</p>
                ))}
              {panel === "review" && (
                <ReviewPanel
                  urls={urls}
                  concept={c}
                  head={head}
                  editing={editing}
                  changes={changes.toggle}
                  work={work}
                  onVerified={props.onVerified}
                />
              )}
              {panel === "contents" && (
                <>
                  <Contents parsed={parsed} skipFirst={hideFirst} />
                  <SourcesPanel
                    urls={urls}
                    data={sources}
                    footnotes={footnotes}
                    numbers={numbers}
                  />
                  <LinksPanel urls={urls} links={links} head={head} />
                </>
              )}
              {panel === "history" && (
                <History urls={urls} concept={c} head={head} events={props.history} />
              )}
              {panel === "properties" && (editing ? edit.form : <Frontmatter fm={fm} />)}
            </div>
          </>
        )}
      </PanelHost>
    </>
  );
}

/**
 * A table of contents from the body's headings, when it has a few. The heading the sheet is
 * scrolled to is marked.
 */
function Contents({ parsed, skipFirst }: { parsed: Parsed; skipFirst: boolean }) {
  const headings = skipFirst ? parsed.headings.slice(1) : parsed.headings;
  const [current, setCurrent] = useState<string | null>(null);
  const ids = headings.map((h) => h.id).join(" ");
  useEffect(() => {
    const sheet = document.querySelector(".ws-main");
    if (!sheet || !ids) return;
    const list = ids.split(" ");
    const update = () => {
      const top = sheet.getBoundingClientRect().top + 120;
      let at: string | null = list[0] ?? null;
      for (const id of list) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= top) at = id;
      }
      setCurrent(at);
    };
    update();
    sheet.addEventListener("scroll", update, { passive: true });
    return () => sheet.removeEventListener("scroll", update);
  }, [ids]);
  if (headings.length < 2) return null;
  const top = Math.min(...headings.map((h) => h.depth));
  return (
    <nav aria-label="Contents">
      <ul className="toc">
        {headings.map((h) => (
          <li key={h.id} className={`depth-${h.depth - top}`}>
            <a href={`#${h.id}`} aria-current={h.id === current ? "location" : undefined}>
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** A work item (broken link, staleness) as a card: what it is, and what to do. */
function WorkCard({ w }: { w: WorkItem }) {
  return (
    <li className="inset">
      <Chip text={w.kind.replace("_", " ")} tone="bad" /> <span>{w.detail}</span>
      <div className="muted">→ {w.suggested_action}</div>
    </li>
  );
}

/**
 * Tooltips over the body: a footnote reference shows the source it cites (or its note), an
 * internal link the target's title, type, trust and staleness, an external link its URL.
 */
function useTooltips(urls: Urls, sources: Sources, footnotes: Record<string, string>) {
  const targets = useRef(new Map<string, Promise<FileJson | null>>());
  return (h: Hovered): HTMLElement | null | Promise<HTMLElement | null> => {
    if (h.kind === "footnote") {
      const label = h.footnote.label;
      const s = sources.sources.find((x) => x.id === label);
      if (!s) {
        const note = footnotes[label];
        if (!note) return null;
        const box = el("div", { class: "small" });
        box.innerHTML = note; // Escaped by Wordgard (toHTML), as in the sources panel.
        return el("div", {}, box);
      }
      const internal = (s.internal ?? null) as JsonObject | null;
      return el(
        "div",
        {},
        el("strong", {}, typeof s.title === "string" ? s.title : label),
        typeof s.resource === "string" && el("div", { class: "small muted" }, s.resource),
        internal?.broken ? el("div", { class: "small" }, "Missing") : false,
        internal && typeof internal.trust_tier === "string"
          ? el(
              "div",
              { class: "small" },
              `${internal.trust_tier}${internal.stale ? " · stale" : ""}`,
            )
          : false,
      );
    }
    const link = h.link;
    if (link.path === null) {
      return link.href ? el("div", { class: "small" }, link.href) : null;
    }
    if (link.broken) return el("div", { class: "small" }, `Missing: nothing at ${link.path}`);
    const path = link.path;
    let target = targets.current.get(path);
    if (!target) {
      target = api<FileJson>(urls.api(`files/${enc(path)}`)).catch(() => null);
      targets.current.set(path, target);
    }
    return target.then((t) => {
      if (!t) return el("div", { class: "small" }, path);
      if (t.kind !== "concept") return el("div", { class: "small" }, `${t.path} · ${t.kind}`);
      const tfm = t.frontmatter;
      return el(
        "div",
        {},
        el("strong", {}, typeof tfm.title === "string" ? tfm.title : baseName(t.path)),
        el(
          "div",
          { class: "small muted" },
          [
            typeof tfm.type === "string" ? tfm.type : "no type",
            t.trust_tier,
            t.stale ? "stale" : "",
          ]
            .filter(Boolean)
            .join(" · "),
        ),
        typeof tfm.description === "string" && el("div", { class: "small" }, tfm.description),
      );
    });
  };
}

/**
 * "Changes since human verification" over the text: a word diff against the version a human
 * last verified, when the content changed after it. Current version only.
 */
function useVerificationDiff(
  urls: Urls,
  c: Concept,
  parsed: Parsed,
  events: HistoryEvent[],
  head: number,
): { toggle: React.ReactNode; diff: WordDiff | null; off(): void } {
  const [on, setOn] = useState(false);
  const [diff, setDiff] = useState<WordDiff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const verified = [...events]
    .reverse()
    .find((e) => e.op === "verify" && e.actor.startsWith("human:"));
  const changed =
    verified !== undefined && events.some((e) => e.seq > verified.seq && CONTENT_OPS.has(e.op));
  const current = urls.at === undefined || urls.at >= head;
  useEffect(() => {
    if (!on || !verified) return;
    let live = true;
    api<FileJson>(urls.api(`files/${enc(c.path)}`, { at: verified.seq })).then(
      (old) => {
        if (!live) return;
        if (old.kind !== "concept") return setError("That version is not a concept.");
        setDiff(wordDiff(fromTree(old.doc).doc, parsed.doc));
      },
      (e: unknown) => live && setError(e instanceof ApiError ? e.message : String(e)),
    );
    return () => {
      live = false;
    };
  }, [on, verified, urls, c.path, parsed]);
  const off = () => setOn(false);
  if (!changed || !current || !verified) return { toggle: null, diff: null, off };
  return {
    off,
    toggle: (
      <p className="small">
        <label>
          <input type="checkbox" checked={on} onChange={(e) => setOn(e.currentTarget.checked)} />{" "}
          Show changes since {verified.actor} verified it (seq {verified.seq})
        </label>
        {error && <span className="warn"> {error}</span>}
      </p>
    ),
    diff: on ? diff : null,
  };
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

/** The frontmatter, read-only: the Properties panel while reading. */
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

/** The text of a little HTML (a footnote definition), for comparing. */
function plain(html: string): string {
  return (new DOMParser().parseFromString(html, "text/html").body.textContent ?? "").trim();
}

/** Footnote definitions as HTML from Wordgard (`toHTML`), which escapes every text and attribute. */
function FootnoteHtml({ html }: { html: string }) {
  // biome-ignore lint/security/noDangerouslySetInnerHtml: Wordgard escapes every text and attribute.
  return <div className="small" dangerouslySetInnerHTML={{ __html: html }} />;
}

function SourcesPanel(props: {
  urls: Urls;
  data: Sources;
  footnotes: Record<string, string>;
  /** Each footnote label's number, as the body's markers show it. */
  numbers: Map<string, number>;
}) {
  const { urls, data, footnotes } = props;
  const used = new Set<string>();
  const items = data.sources.map((s, i) => {
    const id = typeof s.id === "string" ? s.id : null;
    if (id) used.add(id);
    const name = typeof s.title === "string" ? s.title : (id ?? "Source");
    const resource = typeof s.resource === "string" ? s.resource : null;
    const internal = (s.internal ?? null) as JsonObject | null;
    const cited = typeof s.cited === "number" ? s.cited : 0;
    const meta: string[] = [];
    let link: React.ReactNode = <span>{name}</span>;
    if (internal?.broken) {
      meta.push(`${resource ?? ""} · missing`);
    } else if (internal && typeof internal.path === "string") {
      link = <a href={urls.file(internal.path)}>{name}</a>;
      meta.push(internal.path);
      if (internal.trust_tier) meta.push(String(internal.trust_tier));
      if (internal.stale) meta.push("stale");
      if (internal.status && internal.status !== "stable") meta.push(String(internal.status));
    } else if (resource && /^https?:\/\//i.test(resource)) {
      link = (
        <a href={resource} rel="noopener noreferrer nofollow">
          {name}
        </a>
      );
      meta.push("external");
    } else if (resource) meta.push(resource);
    if (id) meta.push(cited > 0 ? `cited ${cited}×` : "not cited");
    // The footnote's own text, unless it only repeats the source's title.
    const html = id ? footnotes[id] : undefined;
    const def = html && plain(html) !== name.trim() ? html : undefined;
    return (
      <li key={id ?? i} id={id ? anchorId("src", id) : undefined}>
        <span className="num">{i + 1}</span>
        <span>
          {link}
          <span className="meta">{meta.join(" · ")}</span>
          {def && (
            <span className="meta">
              <FootnoteHtml html={def} />
            </span>
          )}
        </span>
      </li>
    );
  });
  const others = Object.entries(footnotes).filter(([label]) => !used.has(label));
  if (items.length === 0 && others.length === 0 && data.unmatched_footnotes.length === 0) {
    return null;
  }
  return (
    <section id="sources">
      <h3 className="label">Sources</h3>
      {items.length > 0 && <ol className="sources">{items}</ol>}
      {others.length > 0 && (
        <>
          <h3 className="label">Other footnotes</h3>
          <ul className="sources">
            {others.map(([label, html]) => (
              <li key={label} id={anchorId("fn", label)}>
                <span className="num">{props.numbers.get(label) ?? label}</span>
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

/** The latest human verification in the frontmatter, if any. */
function humanVerified(c: Concept): JsonObject | undefined {
  const list = Array.isArray(c.frontmatter.verified)
    ? (c.frontmatter.verified as JsonObject[])
    : [];
  return [...list].reverse().find((v) => String(v.by ?? "").startsWith("human:"));
}

/** "Verified by human:x, 2026-10-05 17:51. No content change since." and its kin. */
function VerifiedLine({ c }: { c: Concept }) {
  const human = humanVerified(c);
  if (c.trust_tier === "human-reviewed" && human) {
    return (
      <p className="state-line on">
        Verified by {String(human.by)}, {when(String(human.at ?? ""))}. No content change since.
      </p>
    );
  }
  if (human) {
    return (
      <p className="state-line">
        Last verified by {String(human.by)}, {when(String(human.at ?? ""))}; changed since.
      </p>
    );
  }
  return <p className="state-line">No human has verified this concept.</p>;
}

/**
 * Whether a person can rely on this version (tempra-dev: app/workspace, The panels): who
 * verified it, Verify, the changes since, what kind of concept it is, and what is wrong with it.
 * Human verification (spec: OKF conformance, What the service stamps) lapses with a later write.
 */
function ReviewPanel(props: {
  urls: Urls;
  concept: Concept;
  head: number;
  editing: boolean;
  changes: React.ReactNode;
  work: WorkItem[];
  onVerified(): void;
}) {
  const { urls, concept: c } = props;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fm = c.frontmatter;
  const current = urls.at === undefined || urls.at >= props.head;
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
    <>
      <section>
        <VerifiedLine c={c} />
        {error && <div className="notice">{error}</div>}
        {/* Verifying is for the saved current version, not one being edited or from the past. */}
        {current && !props.editing && c.trust_tier !== "human-reviewed" && (
          <form className="verify-form" onSubmit={submit}>
            <input type="text" name="note" placeholder="Note (optional)" aria-label="Note" />
            <button className="primary" type="submit" disabled={busy}>
              Verify this version
            </button>
          </form>
        )}
        {props.changes}
      </section>
      <section>
        <dl className="facts">
          <dt>type</dt>
          <dd>
            {typeof fm.type === "string" && fm.type ? fm.type : <Chip text="no type" tone="bad" />}
          </dd>
          {typeof fm.status === "string" && (
            <>
              <dt>status</dt>
              <dd>{fm.status}</dd>
            </>
          )}
          {fm.stale_after !== undefined && (
            <>
              <dt>stale_after</dt>
              <dd>
                {when(String(fm.stale_after))}
                {c.stale && <Chip text="stale" tone="bad" />}
              </dd>
            </>
          )}
        </dl>
      </section>
      {(c.lint.length > 0 || props.work.length > 0) && (
        <section>
          <h3 className="label">To fix</h3>
          <ul className="inset-list">
            {c.lint.map((l, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: lint warnings have no id.
              <li key={i} className="inset">
                <Chip text="lint" /> <code>{l.code}</code>{" "}
                <span className="muted">{l.message}</span>
              </li>
            ))}
            {props.work.map((w) => (
              <WorkCard key={`${w.kind} ${w.detail}`} w={w} />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function History(props: { urls: Urls; concept: Concept; head: number; events: HistoryEvent[] }) {
  const { urls, concept: c, head } = props;
  // Comments are in their own panel; history is the concept's versions.
  const events = props.events.filter((e) => e.op !== "comment");
  const shown = [...events].reverse().slice(0, 50);
  // Time travel shortcuts (spec: Time travel in the UI).
  const verified = [...events]
    .reverse()
    .find((e) => e.op === "verify" && e.actor.startsWith("human:"));
  const changedSince =
    verified !== undefined && events.some((e) => e.seq > verified.seq && CONTENT_OPS.has(e.op));
  const pinnedOld = urls.at !== undefined && urls.at < head;
  const [now] = useState(() => Date.now());
  return (
    <>
      <section>
        <VerifiedLine c={c} />
        {verified && changedSince && (
          <p className="small">
            <a href={urls.diff(c.path, verified.seq)}>Changes since human verification</a> (seq{" "}
            {verified.seq})
          </p>
        )}
      </section>
      <ol className="history">
        {shown.map((e) => {
          const note = typeof e.meta?.note === "string" ? e.meta.note : "";
          const from = typeof e.meta?.from_path === "string" ? `from ${e.meta.from_path}` : "";
          const classes = [e.seq === c.seq ? "current" : "", e.op === "verify" ? "verify" : ""];
          return (
            <li key={e.seq} className={classes.filter(Boolean).join(" ") || undefined}>
              {e.op === "delete" ? (
                <span className="seq">{e.seq}</span>
              ) : (
                <a className="seq" href={urls.pinned(e.seq).file(e.path)} title="View this version">
                  {e.seq}
                </a>
              )}
              <span>
                {e.op} <span className="who">{e.actor}</span>
                {(note || from) && (
                  <span className="note" title={[from, note].filter(Boolean).join(" · ")}>
                    {[from, note].filter(Boolean).join(" · ")}
                  </span>
                )}
              </span>
              <span className="when">
                {CONTENT_OPS.has(e.op) ? (
                  <a href={urls.diff(e.path, undefined, e.seq)} title={`Diff · ${when(e.ts)} UTC`}>
                    {ago(e.ts, now)}
                  </a>
                ) : (
                  <Ago ts={e.ts} now={now} />
                )}
              </span>
            </li>
          );
        })}
      </ol>
      {events.length > shown.length && (
        <p className="small muted">{events.length - shown.length} older events not shown.</p>
      )}
      <p className="panel-foot">
        <a href={urls.ledger({ prefix: c.path })}>All {events.length} in the ledger</a>
        <a href={urls.raw(c.path)}>Raw</a>
        {pinnedOld && (
          <>
            <a href={urls.pinned(undefined).file(c.path)}>Current version</a>
            <a href={urls.restore(c.path, urls.at as number)}>Restore this version…</a>
          </>
        )}
      </p>
    </>
  );
}

/**
 * Editing a concept (tempra-dev: app/editor): the reader made editable in place, the frontmatter
 * as a form, a required note, save with If-Match, and a merge when someone saved meanwhile.
 */
function useEditing(o: {
  urls: Urls;
  concept: Concept;
  /** Freezes the page on the version being edited. */
  start(): void;
  /** Lets the page follow the library again. */
  end(): void;
  onSaved(): void;
  onEditing(on: boolean): void;
  /** How the body's links are drawn: a link made in the editor is drawn the same way. */
  parseOptions: ParseOptions;
}) {
  const { urls } = o;
  const reader = useRef<ReaderHandle | null>(null);
  const [active, setActive] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [form, setForm] = useState<FormState | null>(null);
  const [note, setNote] = useState("");
  const [types, setTypes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [merge, setMerge] = useState<Merge | null>(null);
  const [saved, setSaved] = useState<{ lint: { code: string; message: string }[] } | null>(null);
  /** Images on their way: a save waits for them, so none is left out of the body. */
  const [uploading, setUploading] = useState(0);
  const dirty = useRef(false);
  /** The version the edit started from. */
  const base = useRef<Base | null>(null);

  // The reader turns editable once it is (re)mounted for the frozen version.
  // biome-ignore lint/correctness/useExhaustiveDependencies: on each start, and on a remount.
  useEffect(() => {
    if (!active) return;
    const path = o.concept.path;
    let outline: Promise<string[]> | null = null;
    reader.current?.setEditable(true, {
      paths: () => {
        outline ??= api<{ files: { path: string; kind: string }[] }>(urls.api("outline")).then(
          (r) => r.files.filter((f) => f.kind === "concept").map((f) => f.path),
          () => [],
        );
        return outline;
      },
      // Drawn as the body's own links are; a target a browser must not follow is refused.
      link: (raw) => {
        const param = linkParam(o.parseOptions, linkTarget(urls, raw));
        return param.href === null ? null : param;
      },
      upload: (file) => uploadImage(urls, path, file),
      onUploads: setUploading,
      onError: setError,
      onChange: () => {
        dirty.current = true;
      },
    });
  }, [active, generation]);

  // Leaving with unsaved edits asks first: links and back in the app, and the tab itself.
  useEffect(() => {
    if (!active) return;
    const unguard = setLeaveGuard(
      () => !dirty.current || confirm("Leave this page? Your edits are not saved."),
    );
    const unload = (e: BeforeUnloadEvent) => {
      if (dirty.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", unload);
    return () => {
      unguard();
      window.removeEventListener("beforeunload", unload);
    };
  }, [active]);

  const begin = () => {
    const c = o.concept;
    base.current = { path: c.path, hash: c.hash, doc: c.doc, frontmatter: c.frontmatter };
    dirty.current = false;
    setSaved(null);
    setError(null);
    setMerge(null);
    setNote("");
    setForm(formOf(c.frontmatter));
    o.start();
    setActive(true);
    o.onEditing(true);
    libraryTypes(urls).then(setTypes, () => {});
  };

  const stop = () => {
    dirty.current = false;
    reader.current?.setEditable(false);
    setActive(false);
    setMerge(null);
    o.onEditing(false);
    o.end();
    // A fresh reader for whatever the page shows next.
    setGeneration((g) => g + 1);
  };

  const cancel = () => {
    if (dirty.current && !confirm("Drop your edits?")) return;
    stop();
  };

  /** Saves `doc` and `fm` as an edit of `from`; a 412 merges them with the version there now. */
  const write = async (from: Base, doc: Doc, fm: FmObject) => {
    setBusy(true);
    setError(null);
    try {
      const r = await saveConcept(urls, o.concept.path, from.hash, fm, doc, note.trim());
      setSaved({ lint: r.lint });
      stop();
      o.onSaved();
    } catch (err) {
      if (isConflict(err)) {
        // Someone saved meanwhile: merge with the version there now.
        const now: FileJson | null | { failed: string } = await api<FileJson>(
          urls.api(`files/${enc(o.concept.path)}`),
        ).catch((e: unknown) =>
          e instanceof ApiError && e.status === 404
            ? null
            : { failed: e instanceof Error ? e.message : String(e) },
        );
        if (now !== null && "failed" in now) {
          setError(`Someone saved meanwhile, and their version could not be loaded: ${now.failed}`);
        } else if (now === null) {
          setError("This concept was deleted or moved meanwhile; copy your text before leaving.");
        } else if (now.kind !== "concept") {
          setError("The file is no longer a concept; copy your text and reload.");
        } else {
          const theirs: Base = {
            path: now.path,
            hash: now.hash,
            doc: now.doc,
            frontmatter: now.frontmatter as FmObject,
          };
          // The edit itself keeps its base: saving it again (after "Back to editing") meets
          // the 412 again and merges again, never overwriting what was written meanwhile.
          setMerge(startMerge(from, doc, fm, theirs));
        }
      } else setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const save = (e: FormEvent) => {
    e.preventDefault();
    if (uploading > 0) return setError("Wait for the images to finish uploading.");
    if (!note.trim()) return setError("Say what you changed in a one-line note.");
    if (!form?.type.trim()) return setError("A concept needs a type.");
    const b = base.current;
    if (!b || !reader.current) return;
    void write(b, reader.current.tree(), frontmatterOf(b.frontmatter, form));
  };

  const stamped: FmObject = Object.fromEntries(
    Object.entries(o.concept.frontmatter).filter(([k]) => k === "generated" || k === "verified"),
  ) as FmObject;

  // While merging, the merge view takes the bar's place (in the sheet, above the body).
  const bar = merge ? (
    <MergeView
      // A new merge (after another write meanwhile) starts with nothing picked.
      key={merge.theirs.hash}
      merge={merge}
      busy={busy}
      error={error}
      onSave={(doc, fm) => void write(merge.theirs, doc, fm)}
      onCancel={() => setMerge(null)}
    />
  ) : (
    <form className="edit-bar" onSubmit={save}>
      <label className="visually-hidden" htmlFor="edit-note">
        Note
      </label>
      <input
        id="edit-note"
        value={note}
        onChange={(e) => setNote(e.currentTarget.value)}
        placeholder="What you changed, in one line"
        required
      />
      <button className="primary" type="submit" disabled={busy || uploading > 0}>
        {uploading > 0 ? "Uploading…" : "Save"}
      </button>
      <button type="button" className="ghost" onClick={cancel} disabled={busy}>
        Cancel
      </button>
      {error && <div className="notice">{error}</div>}
    </form>
  );

  // The frontmatter as a form, in the Properties panel while editing.
  const formView = form && (
    <FrontmatterForm
      form={form}
      types={types}
      stamped={stamped}
      onChange={(f) => {
        setForm(f);
        dirty.current = true;
      }}
    />
  );

  return {
    start: begin,
    cancel,
    bar,
    form: formView,
    merging: merge !== null,
    reader,
    generation,
    saved,
  };
}

/** The file as stored: what agents read and write, frontmatter and all. */
function RawMarkdown(props: { urls: Urls; path: string; hash: string }) {
  const { urls, path, hash } = props;
  const url = urls.api(`files/${enc(path)}`, { at: urls.at });
  const loaded = useLoad(`markdown ${url} ${hash}`, async () => {
    const res = await fetch(url, {
      credentials: "same-origin",
      headers: { Accept: "text/markdown" },
    });
    if (!res.ok) throw new ApiError(res.status, "error", res.statusText);
    return res.text();
  });
  return (
    <Status loaded={loaded}>
      {(text) => (
        <div className="raw-markdown">
          <pre>{text}</pre>
          <a href={urls.raw(path)}>Open as plain text</a>
        </div>
      )}
    </Status>
  );
}
