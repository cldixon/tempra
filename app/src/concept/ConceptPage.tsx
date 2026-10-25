import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useActors } from "../agents";
import { Icon } from "../chrome";
import { CommentsList } from "../comments/CommentsPanel";
import { highlightsOf, placeThreads, type Thread, useDraft } from "../comments/data";
import { Reader } from "../Reader";
import { type BodyOptions, prepare } from "../reader/prepare";
import { pushRecent } from "../recent";
import { useRole } from "../role";
import { type Compare, navigate } from "../router";
import { anchorId, useMe, useTitle } from "../ui";
import { dirOf, folderName, type Urls } from "../urls";
import { PageBar, useFrame } from "../Workspace";
import { Byline } from "./Byline";
import { CheckedLine } from "./Checked";
import { Contents, contentsOf } from "./Contents";
import { useCompare } from "./compare";
import { bodyHref, type ConceptData, standing, titleOf } from "./data";
import { useFigureView } from "./figures";
import { HistoryList } from "./History";
import { useHoverCards } from "./hover";
import { type Live, LiveAnnouncer, LiveNotice, NewVersion } from "./live";
import { Panel, type PanelName, panelInUrl, threadInHash } from "./Panel";
import { PropertiesList } from "./Properties";
import { RawMarkdown } from "./RawMarkdown";
import { ReviewBar, VersionBar } from "./ReviewBar";
import { SourcesSection } from "./Sources";
import { CopyPage, PageMenu } from "./Tools";

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
  // The Markdown view is in the URL (`?view=markdown`), so back and a shared link keep it.
  const markdown = new URLSearchParams(location.search).get("view") === "markdown";
  const setMarkdown = useCallback((on: boolean) => {
    const to = new URL(location.href);
    if (on) to.searchParams.set("view", "markdown");
    else to.searchParams.delete("view");
    navigate(`${to.pathname}${to.search}${to.hash}`);
  }, []);
  const inlineContents = useRef<HTMLDetailsElement>(null);

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
  // The headings' ids: a #fragment naming one goes to the heading, never to a panel.
  const bodyIds = useMemo(() => new Set(prepared.anchors.values()), [prepared]);
  const hover = useHoverCards(urls, sources, prepared);
  const figureView = useFigureView(urls, title, name);

  // Review and history: the text against the last verification, or a chosen version.
  const s = useMemo(() => standing(data.history, c.seq), [data.history, c.seq]);
  // A version from History draws what it changed on that version (`?at=…&since=…`); review mode
  // is of the latest only.
  const compare = current || props.compare?.kind === "since" ? props.compare : null;
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
  const [panel, setPanel] = useState<PanelName | null>(() => panelInUrl(bodyIds));
  const commentsButton = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const panelBox = useRef<HTMLDivElement>(null);
  // Focus (C-25, TEMPRA-133): opening a panel moves the focus to its heading (a draft's text box
  // takes it instead), and closing it gives the focus back to the control that opened it (⋯ for
  // History and Properties), unless the person has moved on. Both wait for the panel to draw (and
  // for the page to be taken out of inert, where the panel overlays it).
  const [focusTo, setFocusTo] = useState<{ to: "heading" | "opener" } | null>(null);
  const openPanel = useCallback((name: PanelName, focus = true) => {
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && !panelBox.current?.contains(focused)) {
      // Nothing focused (a quote clicked, text selected): the Comments control stands in.
      const menu = focused.closest(".menu");
      opener.current =
        focused === document.body
          ? null
          : menu
            ? (menu.querySelector<HTMLElement>(":scope > button") ?? commentsButton.current)
            : focused;
    }
    setPanel(name);
    setFocusTo(focus ? { to: "heading" } : null);
  }, []);
  const closePanel = useCallback(() => {
    const focused = document.activeElement;
    const lost = !focused || focused === document.body || panelBox.current?.contains(focused);
    setPanel(null);
    setFocusTo(lost ? { to: "opener" } : null);
  }, []);
  // Where the panel overlays the page (under 960px of page, and the phone's sheet: the
  // stylesheet's call, read from the panel's position), it is modal (C-26, P-4): the page, the top
  // bar and the sidebar it dims are inert, and a tap on the dimmed page closes it.
  const { setModal } = useFrame();
  const [overlaid, setOverlaid] = useState(false);
  const page = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!panel) return setOverlaid(false);
    const measure = () => {
      const el = panelBox.current?.querySelector(".concept-panel");
      setOverlaid(el ? getComputedStyle(el).position === "fixed" : false);
    };
    measure();
    const watch = new ResizeObserver(measure);
    if (page.current) watch.observe(page.current);
    return () => watch.disconnect();
  }, [panel]);
  const modal = panel !== null && overlaid;
  useLayoutEffect(() => {
    setModal(modal);
    return () => setModal(false);
  }, [modal, setModal]);
  useEffect(() => {
    if (!focusTo) return;
    if (focusTo.to === "heading") {
      panelBox.current?.querySelector<HTMLElement>(".panel-head h2")?.focus();
    } else {
      const back = opener.current?.isConnected ? opener.current : commentsButton.current;
      back?.focus();
    }
    setFocusTo(null);
  }, [focusTo]);
  const togglePanel = useCallback(
    (name: PanelName) => (panel === name ? closePanel() : openPanel(name)),
    [panel, openPanel, closePanel],
  );

  // Comments: each thread's quote found in the body on screen, highlighted while open, listed in
  // the Comments panel.
  const [active, setActive] = useState<string | null>(() => threadInHash(bodyIds));
  const placed = useMemo(
    () => placeThreads(props.threads ?? [], prepared.text),
    [props.threads, prepared],
  );
  const openCount = placed.filter((t) => t.status === "open").length;
  const draft = useDraft(prepared.text);
  const startDraft = useCallback(
    (range: { from: number; to: number }) => {
      draft.start(range);
      openPanel("comments", false);
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
  // A link that asks for a panel or a thread (the Inbox, the home, `?panel=`) opens it when the
  // URL changes to it, and again when the #fragment changes; never on its own otherwise.
  const asked = panelInUrl(bodyIds);
  const where = `${location.search}${location.hash}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: on a move to a URL that asks.
  useEffect(() => {
    if (!asked) return;
    const id = threadInHash(bodyIds);
    if (id) setActive(id);
    setPanel(asked);
  }, [asked, where]);
  useEffect(() => {
    const follow = () => {
      const id = threadInHash(bodyIds);
      if (id) setActive(id);
      if (id || panelInUrl(bodyIds, { search: "", hash: location.hash })) setPanel("comments");
    };
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, [bodyIds]);
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

  const moved = live && (live.change.op === "move" || live.change.op === "delete");
  const dir = dirOf(c.path);
  const folders = dir ? dir.split("/").map((_, i, all) => all.slice(0, i + 1).join("/")) : [];
  const mayVerify = role !== null && role !== "read";
  const hasContents = contents.length >= 2;
  const classes = ["concept", panel ? "panel-open" : "", markdown ? "markdown-on" : ""];
  return (
    <div className={classes.filter(Boolean).join(" ")} ref={page}>
      <PageBar
        phoneTools
        actions={
          <>
            {live && !moved && <NewVersion urls={urls} live={live} />}
            <button
              ref={commentsButton}
              type="button"
              className="icon-button with-count comments-toggle"
              aria-pressed={panel === "comments"}
              onClick={() => togglePanel("comments")}
            >
              {/* Named by what it shows, "Comments 2 open" (WCAG 2.5.3). */}
              <Icon name="comments" />
              <span>Comments</span>
              {openCount > 0 && (
                <>
                  {" "}
                  <span className="comments-count">
                    {openCount}
                    <span className="visually-hidden"> open</span>
                  </span>
                </>
              )}
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
      />
      <div className="concept-grid">
        <article className="doc" inert={modal}>
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
          <LiveAnnouncer urls={urls} live={live} />
          {!compare && !current && <VersionBar urls={urls} concept={c} standing={s} name={name} />}
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
              {/* Where the tree is out of sight (a phone, the sidebar hidden): the page's folders
                  above its title (TEMPRA-139). */}
              <nav className="doc-crumbs" aria-label="Folders">
                {folders.map((f, i) => (
                  <span key={f}>
                    {i > 0 && <span aria-hidden="true"> / </span>}
                    {folderName(f)}
                  </span>
                ))}
              </nav>
              <h1 className="doc-title">{title}</h1>
              {typeof fm.description === "string" && (
                <p className="doc-tagline">{fm.description}</p>
              )}
              <Byline
                concept={c}
                history={data.history}
                name={name}
                live={live}
                current={current}
                status={status}
              />
              {current && <CheckedLine urls={urls} path={c.path} standing={s} name={name} />}
              {hasContents && (
                <details className="toc-inline" ref={inlineContents}>
                  <summary>
                    On this page
                    <Icon name="down" />
                  </summary>
                  <Contents
                    headings={contents}
                    onPick={() => {
                      if (inlineContents.current) inlineContents.current.open = false;
                    }}
                  />
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
        {/* The page dimmed behind an overlaid panel; a tap on it closes the panel (P-4). */}
        {modal && <div className="panel-scrim" aria-hidden="true" onClick={closePanel} />}
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
                loading={props.threads === null && props.threadsError === null}
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
                comparing={compare?.kind === "since"}
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
                current={current}
                reviewing={compare?.kind === "review"}
                mayVerify={mayVerify}
                onVerified={props.onVerified}
              />
            </Panel>
          ) : (
            hasContents &&
            !markdown && (
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
