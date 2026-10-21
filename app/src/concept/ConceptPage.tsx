import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useActors } from "../agents";
import { Icon } from "../chrome";
import { CommentsList } from "../comments/CommentsPanel";
import { highlightsOf, placeThreads, type Thread, useDraft } from "../comments/data";
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
import { HistoryList } from "./History";
import { useHoverCards } from "./hover";
import { type Live, LiveNotice, NewVersion } from "./live";
import { Panel, type PanelName, panelInUrl } from "./Panel";
import { PropertiesList } from "./Properties";
import { RawMarkdown } from "./RawMarkdown";
import { ReviewBar } from "./ReviewBar";
import { SourcesSection } from "./Sources";
import { CopyPage, PageMenu } from "./Tools";

/** The thread a link names (`#thread-<id>`), if any. */
function threadInHash(): string | null {
  const m = /^#thread-(.+)$/.exec(location.hash);
  return m?.[1] ? decodeURIComponent(m[1]) : null;
}

/**
 * A concept's page (take 4, TEMPRA-114; tempra-dev: app/reader, app/comments,
 * decisions/one-panel-from-the-top-bar): its tools in the top bar (Comments n, Copy page, ⋯), the
 * title, description and byline, the body in the reader and its sources at the end, centred in
 * its column; on the right the contents, or one panel in their place (Comments, History,
 * Properties), opened only by the person and never remembered. Review mode and a version chosen
 * in History draw their diff in the text under a slim bar; View Markdown shows the stored file
 * in place of the page.
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

  // The right column: the contents, or one panel. A page opens on its contents; a panel opens
  // only from a control, a quote, or a link asking for one (`?panel=`, `#thread-…`,
  // `#comments`), and closing it (×, Escape, the control again) brings the contents back.
  const [panel, setPanel] = useState<PanelName | null>(panelInUrl);
  const commentsButton = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const panelBox = useRef<HTMLDivElement>(null);
  const openPanel = useCallback((name: PanelName) => {
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && !panelBox.current?.contains(focused)) {
      opener.current = focused.closest(".menu") ? commentsButton.current : focused;
    }
    setPanel(name);
  }, []);
  const closePanel = useCallback(() => {
    setPanel(null);
    // The focus goes back where it was, unless the person has moved on.
    const focused = document.activeElement;
    if (!focused || focused === document.body || panelBox.current?.contains(focused)) {
      (opener.current ?? commentsButton.current)?.focus();
    }
  }, []);
  const togglePanel = useCallback(
    (name: PanelName) => (panel === name ? closePanel() : openPanel(name)),
    [panel, openPanel, closePanel],
  );

  // Comments: each thread's quote found in the body on screen, highlighted while open, listed in
  // the Comments panel.
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
      openPanel("comments");
    },
    [draft.start, openPanel],
  );
  const onMark = useCallback(
    (id: string | null) => {
      setActive(id);
      if (id) openPanel("comments");
    },
    [openPanel],
  );
  const highlights = useMemo(
    () => highlightsOf(placed, active, draft.draft),
    [placed, active, draft.draft],
  );
  // A link that asks for a panel or a thread (Needs you, the inbox, `?panel=`) opens it when the
  // URL changes to it, and again when the #fragment changes; never on its own otherwise.
  const asked = panelInUrl();
  const where = `${location.search}${location.hash}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: on a move to a URL that asks.
  useEffect(() => {
    if (!asked) return;
    const id = threadInHash();
    if (id) setActive(id);
    setPanel(asked);
  }, [asked, where]);
  useEffect(() => {
    const follow = () => {
      const id = threadInHash();
      if (id) setActive(id);
      if (id || location.hash === "#comments") setPanel("comments");
    };
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, []);
  // Escape closes the panel (one Escape, one thing closed: a menu, a dialog, a draft or the
  // drawer handle theirs first and mark it handled).
  useEffect(() => {
    if (!panel) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target instanceof Element ? e.target : null;
      if (e.key === "Escape" && !e.defaultPrevented && !t?.closest("dialog, .menu, form")) {
        e.preventDefault();
        closePanel();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [panel, closePanel]);

  // Recent files, for the quick switcher.
  useEffect(() => {
    if (urls.at === undefined) pushRecent(urls, { path: c.path, title });
  }, [urls, c.path, title]);

  const work = data.work.filter((w) => w.kind !== "comment" && w.kind !== "lint");
  const moved = live && (live.change.op === "move" || live.change.op === "delete");
  const dir = dirOf(c.path);
  const mayVerify = role !== null && role !== "read";
  const hasContents = contents.length >= 2;
  const classes = ["concept", panel ? "panel-open" : "", markdown ? "markdown-on" : ""];
  return (
    <div className={classes.filter(Boolean).join(" ")}>
      <PageBar
        back={{ href: urls.tree(dir), label: dir ? folderName(dir) : urls.slug }}
        actions={
          <>
            {live && !moved && <NewVersion urls={urls} live={live} />}
            <button
              ref={commentsButton}
              type="button"
              className="icon-button with-count"
              aria-label={openCount > 0 ? `Comments, ${openCount} open` : "Comments"}
              title="Comments"
              aria-pressed={panel === "comments"}
              onClick={() => togglePanel("comments")}
            >
              <Icon name="comments" />
              {openCount > 0 && <span aria-hidden="true">{openCount}</span>}
            </button>
            <CopyPage urls={urls} path={c.path} />
            <PageMenu
              urls={urls}
              path={c.path}
              panel={panel}
              markdown={markdown}
              onPanel={togglePanel}
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
      <div className="concept-grid">
        <article className="doc">
          {compare && (
            <ReviewBar
              urls={urls}
              concept={c}
              compare={compare}
              standing={s}
              name={name}
              mayVerify={mayVerify}
              error={changes.error}
              onVerified={props.onVerified}
            />
          )}
          {props.notice && <div className="notice">{props.notice}</div>}
          {moved && live && <LiveNotice urls={urls} live={live} />}
          <AtNotice urls={urls} head={head} current={urls.pinned(undefined).file(c.path)} />
          {markdown && (
            <RawMarkdown
              urls={urls}
              path={c.path}
              hash={c.hash}
              onBack={() => setMarkdown(false)}
            />
          )}
          {/* Kept mounted under the markdown, so comments keep their place. */}
          <div className="doc-page" hidden={markdown}>
            <header className="doc-head">
              <h1 className="doc-title">{title}</h1>
              {typeof fm.description === "string" && (
                <p className="doc-tagline">{fm.description}</p>
              )}
              <Byline concept={c} history={data.history} name={name} live={live} />
              {hasContents && (
                <details className="toc-inline">
                  <summary>On this page</summary>
                  <Contents headings={contents} />
                </details>
              )}
            </header>
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
        <div className="concept-side" ref={panelBox}>
          {panel === "comments" ? (
            <Panel
              name="comments"
              count={openCount > 0 ? `${openCount} open` : null}
              onClose={closePanel}
            >
              <CommentsList
                urls={urls}
                path={c.path}
                placed={placed}
                error={props.threadsError}
                writable={current}
                draft={draft.draft}
                onDraftDone={draft.clear}
                active={active}
                onActive={setActive}
                onChanged={props.onCommented}
              />
            </Panel>
          ) : panel === "history" ? (
            <Panel name="history" onClose={closePanel}>
              <HistoryList
                urls={urls}
                concept={c}
                standing={s}
                name={name}
                since={compare?.kind === "since" ? compare.seq : null}
              />
            </Panel>
          ) : panel === "properties" ? (
            <Panel name="properties" onClose={closePanel}>
              <PropertiesList
                urls={urls}
                concept={c}
                links={links}
                head={head}
                standing={s}
                name={name}
                work={work}
                current={current}
                reviewing={compare?.kind === "review"}
                mayVerify={mayVerify}
                onVerified={props.onVerified}
              />
            </Panel>
          ) : (
            hasContents && (
              <nav className="concept-contents" aria-label="Contents">
                <Contents headings={contents} />
              </nav>
            )
          )}
        </div>
      </div>
    </div>
  );
}
