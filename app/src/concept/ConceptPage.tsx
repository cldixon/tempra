import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useActors } from "../agents";
import { Icon } from "../chrome";
import { highlightsOf, placeThreads, type Thread, useDraft } from "../comments/data";
import { CommentsMargin, type CommentsMode } from "../comments/Margin";
import { Reader } from "../Reader";
import { type BodyOptions, prepare } from "../reader/prepare";
import { pushRecent } from "../recent";
import { useRole } from "../role";
import type { Compare } from "../router";
import { AtNotice, anchorId, Crumbs, useMe, useTitle } from "../ui";
import { dirOf, folderName, type Urls } from "../urls";
import { PageBar } from "../Workspace";
import { Byline } from "./Byline";
import { Contents, contentsOf } from "./Contents";
import { useCompare } from "./compare";
import { bodyHref, type ConceptData, standing, titleOf } from "./data";
import { useFigureView } from "./figures";
import { useHoverCards } from "./hover";
import { type Live, LiveNotice, NewVersion } from "./live";
import { MoreMenu } from "./MoreMenu";
import { RawMarkdown } from "./RawMarkdown";
import { ReviewBar } from "./ReviewBar";
import { SourcesSection } from "./Sources";

/** Whether the person keeps a concept's comments shown (remembered on this browser). */
const COMMENTS_KEY = "tempra:comments";

function storedComments(): boolean {
  try {
    return localStorage.getItem(COMMENTS_KEY) !== "off";
  } catch {
    return true;
  }
}

function storeComments(on: boolean) {
  try {
    localStorage.setItem(COMMENTS_KEY, on ? "on" : "off");
  } catch {
    // Storage off: the choice lasts for this page load.
  }
}

/**
 * How the comments are shown at the sheet's width: the stylesheet decides (container queries on
 * the sheet set `--comments-mode` on the page), and this reads its answer as the sheet resizes.
 * Null until the page has been measured once.
 */
function useCommentsMode(page: RefObject<HTMLElement | null>): CommentsMode | null {
  const [mode, setMode] = useState<CommentsMode | null>(null);
  useLayoutEffect(() => {
    const el = page.current;
    if (!el) return;
    const read = () => {
      const v = getComputedStyle(el).getPropertyValue("--comments-mode").trim();
      setMode(v === "side" || v === "bottom" ? v : "margin");
    };
    read();
    const watch = new ResizeObserver(read);
    watch.observe(el.closest(".ws-main") ?? el);
    return () => watch.disconnect();
  }, [page]);
  return mode;
}

/**
 * Whether the comments show, and how. In the margin they show as the person last chose (kept on
 * this browser); a sheet (where there is no room for a margin) shows only when the person opens
 * it, never by itself.
 */
function useCommentsShown(page: RefObject<HTMLElement | null>) {
  const measured = useCommentsMode(page);
  const mode = measured ?? "margin";
  const [kept, setKept] = useState(storedComments);
  const [opened, setOpened] = useState(false);
  /** Shows or hides them; `remember` keeps the choice (a link opening them does not). */
  const set = useCallback(
    (on: boolean, remember = true) => {
      if (mode !== "margin") setOpened(on);
      else {
        setKept(on);
        if (remember) storeComments(on);
      }
    },
    [mode],
  );
  return { mode, measured: measured !== null, shown: mode === "margin" ? kept : opened, set };
}

/** The thread a link names (`#thread-<id>`), if any. */
function threadInHash(): string | null {
  const m = /^#thread-(.+)$/.exec(location.hash);
  return m?.[1] ? decodeURIComponent(m[1]) : null;
}

/**
 * A concept's page (take 3; tempra-dev: app/reader, app/comments): the sheet's bar (where it is,
 * the comments toggle, "…"), the title, description and byline, the body in the reader with its
 * contents in the left margin and its comment threads in the right, and its sources at the end.
 * Review mode and a chosen version draw their diff in the text under a slim bar.
 */
export function ConceptPage(props: {
  urls: Urls;
  data: ConceptData;
  head: number;
  compare: Compare | null;
  /** Null while they load, or when they failed (`threadsError`). */
  threads: Thread[] | null;
  threadsError: string | null;
  /** What the last action did (verified, restored). */
  notice: string | undefined;
  /** Someone else's change since this version, if any. */
  live: Live | null;
  onCommented(): void;
  onVerified(): void;
}) {
  const { urls, head, live, data } = props;
  const { concept: c, sources, links } = data;
  const me = useMe();
  const name = useActors(urls, me?.actor ?? null).view;
  const role = useRole(urls);
  const fm = c.frontmatter;
  const title = titleOf(c);
  useTitle(`${title} · ${urls.slug}`);
  const status = typeof fm.status === "string" ? fm.status : null;
  const current = urls.at === undefined || urls.at >= head;
  const [markdown, setMarkdown] = useState(false);

  // Footnote markers are numbers: the sources in their order, then the body's other footnotes
  // as they are met (`numbers` fills in as the body is prepared, afresh for each body; the
  // sources section reads it).
  const { prepared, numbers } = useMemo(() => {
    const ids = sources.sources.map((s) => s.id).filter((id) => typeof id === "string");
    const numbers = new Map<string, number>(ids.map((id, i) => [id, i + 1]));
    const sourceIds = new Set(ids);
    const broken = new Set(links.broken.map((b) => b.path));
    const options: BodyOptions = {
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
    return { prepared: prepare(c.doc, options), numbers };
  }, [c.path, c.doc, urls, sources, links]);
  // A leading heading that repeats the title is not shown twice (the stored body is unchanged).
  const first = prepared.headings[0];
  const hideFirst =
    first?.first === true && first.text.trim().toLowerCase() === title.trim().toLowerCase();
  const contents = useMemo(() => contentsOf(prepared, hideFirst), [prepared, hideFirst]);
  const hover = useHoverCards(urls, sources, prepared);
  const figureView = useFigureView(urls, title, name);

  // Review and history: the text against the last verification, or a chosen version.
  const s = useMemo(() => standing(data.history, c.seq), [data.history, c.seq]);
  const compare = current ? props.compare : null;
  const base =
    compare?.kind === "since"
      ? compare.seq
      : compare?.kind === "review" && s.verified && s.since > 0
        ? s.verified.event.seq
        : null;
  const changes = useCompare(urls, c.path, prepared, base);

  // Comments: each thread's quote found in the body on screen, highlighted while open, in the
  // margin beside it. Shown or not as the person last chose; a sheet (where there is no room for
  // a margin) never opens by itself.
  const page = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const comments = useCommentsShown(page);
  const { mode, shown: showComments, set: showCommentsAs } = comments;
  /** Closes a comment sheet (or the margin) and gives the focus back to the toggle. */
  const closeComments = useCallback(() => {
    showCommentsAs(false);
    toggle.current?.focus();
  }, [showCommentsAs]);
  const [active, setActive] = useState<string | null>(threadInHash);
  const placed = useMemo(
    () => placeThreads(props.threads ?? [], prepared.text),
    [props.threads, prepared],
  );
  const openCount = placed.filter((t) => t.status === "open").length;
  const draft = useDraft(prepared.text);
  const startDraft = useCallback(
    (range: { from: number; to: number }) => {
      draft.start(range);
      showCommentsAs(true);
    },
    [draft.start, showCommentsAs],
  );
  const onMark = useCallback(
    (id: string | null) => {
      setActive(id);
      if (id) showCommentsAs(true);
    },
    [showCommentsAs],
  );
  const highlights = useMemo(
    () => highlightsOf(placed, active, draft.draft),
    [placed, active, draft.draft],
  );
  // A link to a thread (Needs you, the inbox, the ledger) or to the comments opens them, once
  // the page knows how it shows them, and again when the #fragment changes; not on a resize.
  const show = useRef(showCommentsAs);
  show.current = showCommentsAs;
  useEffect(() => {
    if (!comments.measured) return;
    const follow = () => {
      const id = threadInHash();
      if (id) setActive(id);
      if (id || location.hash === "#comments") show.current(true, false);
    };
    follow();
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, [comments.measured]);
  // Escape closes a comment sheet (the margin stays: it is part of the page). One Escape, one
  // thing closed: the event is marked handled for the drawer and the rest.
  useEffect(() => {
    if (mode === "margin" || !showComments) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target instanceof Element ? e.target : null;
      if (e.key === "Escape" && !e.defaultPrevented && !t?.closest("dialog, .menu, form")) {
        e.preventDefault();
        closeComments();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mode, showComments, closeComments]);

  // Recent files, for the quick switcher.
  useEffect(() => {
    if (urls.at === undefined) pushRecent(urls, { path: c.path, title });
  }, [urls, c.path, title]);

  const work = data.work.filter((w) => w.kind !== "comment" && w.kind !== "lint");
  const moved = live && (live.change.op === "move" || live.change.op === "delete");
  const prose = useCallback(() => page.current?.querySelector(".doc .body > .prose") ?? null, []);
  const dir = dirOf(c.path);
  const classes = [
    "concept",
    showComments ? "comments-on" : "",
    contents.length >= 2 ? "has-contents" : "",
  ];
  return (
    <div ref={page} className={classes.filter(Boolean).join(" ")}>
      <PageBar
        back={{ href: urls.tree(dir), label: dir ? folderName(dir) : urls.slug }}
        actions={
          <>
            {live && !moved && <NewVersion urls={urls} live={live} />}
            <button
              ref={toggle}
              type="button"
              className="icon-button with-count"
              aria-label={openCount > 0 ? `Comments, ${openCount} open` : "Comments"}
              title="Comments"
              aria-pressed={showComments}
              onClick={() => showCommentsAs(!showComments)}
            >
              <Icon name="comments" />
              {openCount > 0 && <span aria-hidden="true">{openCount}</span>}
            </button>
            <MoreMenu
              urls={urls}
              concept={c}
              links={links}
              head={head}
              standing={s}
              name={name}
              current={current}
              work={work}
              contents={contents}
              markdown={markdown}
              onMarkdown={setMarkdown}
            />
          </>
        }
      >
        <Crumbs urls={urls} path={c.path} file title={title}>
          {c.stale && <span className="crumb-flag">stale</span>}
          {status && status !== "stable" && <span className="crumb-flag">{status}</span>}
        </Crumbs>
      </PageBar>
      {compare && (
        <ReviewBar
          urls={urls}
          concept={c}
          compare={compare}
          standing={s}
          name={name}
          mayVerify={role !== null && role !== "read"}
          error={changes.error}
          onVerified={props.onVerified}
        />
      )}
      <div className="concept-grid">
        {contents.length >= 2 && (
          <nav className="concept-contents" aria-label="Contents">
            <Contents headings={contents} />
          </nav>
        )}
        <article className="doc">
          {props.notice && <div className="notice">{props.notice}</div>}
          {moved && live && <LiveNotice urls={urls} live={live} />}
          <AtNotice urls={urls} head={head} current={urls.pinned(undefined).file(c.path)} />
          <header className="doc-head">
            <h1 className="doc-title">{title}</h1>
            {typeof fm.description === "string" && <p className="doc-tagline">{fm.description}</p>}
            <Byline urls={urls} concept={c} history={data.history} head={head} name={name} />
          </header>
          {markdown && <RawMarkdown urls={urls} path={c.path} hash={c.hash} />}
          {/* Kept mounted under the markdown, so comments keep their place. */}
          <div hidden={markdown}>
            <Reader
              prepared={prepared}
              diff={changes.diff}
              hideFirst={hideFirst}
              hover={hover}
              highlights={highlights}
              onMark={onMark}
              onComment={current ? startDraft : undefined}
              figureView={figureView}
            />
            <SourcesSection urls={urls} data={sources} prepared={prepared} numbers={numbers} />
          </div>
        </article>
        {showComments && (
          <CommentsMargin
            urls={urls}
            path={c.path}
            mode={mode}
            placed={placed}
            error={props.threadsError}
            writable={current}
            draft={draft.draft}
            onDraftDone={draft.clear}
            active={active}
            onActive={setActive}
            onChanged={props.onCommented}
            onClose={closeComments}
            prose={prose}
            drawn={`${changes.diff ? "diff" : ""} ${markdown} ${c.hash}`}
          />
        )}
      </div>
    </div>
  );
}
