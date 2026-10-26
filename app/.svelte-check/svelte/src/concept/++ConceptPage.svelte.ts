///<reference types="svelte" />
;
  /** The floating actions' button: where the focus goes back to when nothing else opened a panel. */
  const actionsButton = () => document.querySelector<HTMLElement>(".page-actions .page-fab");
;;

import { tick, untrack } from "svelte";
import { useActors } from "../agents.svelte.ts";
import CommentsList from "../comments/CommentsList.svelte";
import { highlightsOf, placeThreads, type Thread } from "../comments/data";
import { useDraft } from "../comments/data.svelte.ts";
import { useFrame } from "../frame.svelte.ts";
import Icon from "../Icon.svelte";
import { attachmentSource } from "../images";
import { here } from "../location.svelte.ts";
import PageBar from "../PageBar.svelte";
import Reader from "../Reader.svelte";
import { type BodyOptions, prepare } from "../reader/prepare";
import { pushRecent } from "../recent";
import { useRole } from "../role.svelte.ts";
import { type Compare, navigate } from "../router";
import { anchorId } from "../ui";
import { useMe, useTitle } from "../ui.svelte.ts";
import { dirOf, folderName, type Urls } from "../urls";
import Byline from "./Byline.svelte";
import CheckedLine from "./CheckedLine.svelte";
import Contents from "./Contents.svelte";
import { useCompare } from "./compare.svelte.ts";
import { contentsOf } from "./contents";
import { bodyHref, type ConceptData, standing, titleOf } from "./data";
import { figureViewOf } from "./figures";
import HistoryList from "./HistoryList.svelte";
import HoverCard from "./HoverCard.svelte";
import { type Card, hoverCards } from "./hover";
import type { Live } from "./live";
import LiveAnnouncer from "./LiveAnnouncer.svelte";
import LiveNotice from "./LiveNotice.svelte";
import NewVersion from "./NewVersion.svelte";
import PageActions from "./PageActions.svelte";
import PageMenu from "./PageMenu.svelte";
import Panel from "./Panel.svelte";
import { type PanelName, panelInUrl, threadInHash } from "./panel";
import PropertiesList from "./PropertiesList.svelte";
import RawMarkdown from "./RawMarkdown.svelte";
import ReviewBar from "./ReviewBar.svelte";
import SourcesSection from "./SourcesSection.svelte";
import VersionBar from "./VersionBar.svelte";

;type $$ComponentProps =  {
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
  }; const hoverCard/*Ωignore_positionΩ*/ = (card: Card)/*Ωignore_startΩ*/: ReturnType<import('svelte').Snippet>/*Ωignore_endΩ*/ => { async ()/*Ωignore_positionΩ*/ => { { const $$_draCrevoH0C = __sveltets_2_ensureComponent(HoverCard); new $$_draCrevoH0C({ target: __sveltets_2_any(), props: { card,}});}};return __sveltets_2_any(0)};function $$render() {
  const path/*Ωignore_positionΩ*/ = ()/*Ωignore_startΩ*/: ReturnType<import('svelte').Snippet>/*Ωignore_endΩ*/ => { async ()/*Ωignore_positionΩ*/ => { { svelteHTML.createElement("nav", {    "class":`topbar-crumbs`,"aria-label":`Path`,});   for(let f of __sveltets_2_ensureArray(folders)){f; { svelteHTML.createElement("span", { "class":`crumb`,});folderName(f); }} { svelteHTML.createElement("span", {   "class":`crumb`,"aria-current":`page`,});title; } }};return __sveltets_2_any(0)};  const actions/*Ωignore_positionΩ*/ = ()/*Ωignore_startΩ*/: ReturnType<import('svelte').Snippet>/*Ωignore_endΩ*/ => { async ()/*Ωignore_positionΩ*/ => {if(live && !moved){ { const $$_noisreVweN0C = __sveltets_2_ensureComponent(NewVersion); new $$_noisreVweN0C({ target: __sveltets_2_any(), props: {  urls,live,}});}} { const $$_uneMegaP0C = __sveltets_2_ensureComponent(PageMenu); new $$_uneMegaP0C({ target: __sveltets_2_any(), props: {          urls,"path":c.path,panel,markdown,"onPanel":togglePanel,"onMarkdown":setMarkdown,}});}};return __sveltets_2_any(0)};
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  

  /**
   * A concept's page (take 4, TEMPRA-114; tempra-dev: app/reader, app/comments,
   * decisions/one-panel-from-the-top-bar): its path and ⋯ in the top bar, its actions (Comment,
   * Check) floating at its bottom right (TEMPRA-172, decisions/a-pages-actions-float), the
   * title, description and byline, the body in the reader and its sources at the end, centred in
   * its column; on the right the contents, or one panel in their place (Comments, History,
   * Properties), opened only by the person and never remembered. Review mode and a version chosen
   * in History draw their diff in the text under a slim bar; View Markdown shows the stored file
   * in place of the page.
   */
  let props:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();

  const urls = $derived(props.urls);
  const c = $derived(props.data.concept);
  const sources = $derived(props.data.sources);
  const links = $derived(props.data.links);
  const me = useMe();
  const actors = useActors(
    () => props.urls,
    () => me.current?.actor ?? null,
  );
  const name = actors.view;
  const role = useRole(() => props.urls);
  const fm = $derived(c.frontmatter);
  const title = $derived(titleOf(c));
  useTitle(() => `${title} · ${urls.slug}`);
  const status = $derived(typeof fm.status === "string" ? fm.status : null);
  const current = $derived(urls.at === undefined || urls.at >= props.head);
  // The Markdown view is in the URL (`?view=markdown`), so back and a shared link keep it.
  const markdown = $derived(here.url.searchParams.get("view") === "markdown");
  function setMarkdown(on: boolean) {
    const to = new URL(location.href);
    if (on) to.searchParams.set("view", "markdown");
    else to.searchParams.delete("view");
    navigate(`${to.pathname}${to.search}${to.hash}`);
  }
  let inlineContents: HTMLDetailsElement | undefined = $state();

  // Footnote markers are numbers: the sources in their order, then the body's other footnotes
  // as they are met (`numbers` fills in as the body is prepared, afresh for each body; the
  // sources section reads it).
  const body = $derived.by(() => {
    const ids = sources.sources.map((s) => s.id).filter((id) => typeof id === "string");
    const numbers = new Map<string, number>(ids.map((id, i) => [id, i + 1]));
    const sourceIds = new Set(ids);
    const broken = new Set(links.broken.map((b) => b.path));
    const images = c.images;
    const options: BodyOptions = {
      path: c.path,
      href: bodyHref(urls),
      image: (path) => {
        const ref = images?.[path];
        return ref ? attachmentSource(urls, ref, path) : null;
      },
      exists: (path) => !broken.has(path),
      footnote: (label, defined) => {
        if (!sourceIds.has(label) && !defined) return null;
        if (!numbers.has(label)) numbers.set(label, numbers.size + 1);
        const prefix = sourceIds.has(label) ? "src" : "fn";
        return { href: `#${anchorId(prefix, label)}`, mark: String(numbers.get(label)) };
      },
    };
    return { prepared: prepare(c.doc, options), numbers };
  });
  const prepared = $derived(body.prepared);
  // A leading heading that repeats the title is not shown twice (the stored body is unchanged).
  const hideFirst = $derived.by(() => {
    const first = prepared.headings[0];
    return first?.first === true && first.text.trim().toLowerCase() === title.trim().toLowerCase();
  });
  const contents = $derived(contentsOf(prepared, hideFirst));
  // The headings' ids: a #fragment naming one goes to the heading, never to a panel.
  const bodyIds = $derived(new Set(prepared.anchors.values()));
  // Link targets' cards, loaded once per path while the page is open.
  const targets = new Map();
  const hover = $derived(hoverCards(urls, sources, prepared, targets));
  const figureView = $derived(figureViewOf(urls, title, name));

  // Review and history: the text against the last verification, or a chosen version.
  const s = $derived(standing(props.data.history, c.seq));
  // A version from History draws what it changed on that version (`?at=…&since=…`); review mode
  // is of the latest only.
  const compare = $derived(current || props.compare?.kind === "since" ? props.compare : null);
  const base = $derived(
    compare?.kind === "since"
      ? compare.seq
      : compare?.kind === "review" && s.verified && s.since > 0
        ? s.verified.event.seq
        : null,
  );
  const changes = useCompare(
    () => urls,
    () => c.path,
    () => prepared,
    () => base,
  );

  // The right column: the contents, or one panel. A page opens on its contents; a panel opens
  // only from a control, a quote, or a link asking for one (`?panel=`, `#thread-…`,
  // `#comments`), and closing it (×, Escape, the control again) brings the contents back.
  let panel = $state<PanelName | null>(untrack(() => panelInUrl(bodyIds)));
  let opener: HTMLElement | null = null;
  let panelBox: HTMLDivElement | undefined = $state();
  // Focus (C-25, TEMPRA-133): opening a panel moves the focus to its heading (a draft's text box
  // takes it instead), and closing it gives the focus back to the control that opened it (⋯ for
  // History and Properties), unless the person has moved on. Both wait for the panel to draw (and
  // for the page to be taken out of inert, where the panel overlays it).
  let focusTo = $state<{ to: "heading" | "opener" } | null>(null);
  function openPanel(which: PanelName, focus = true) {
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && !panelBox?.contains(focused)) {
      // Nothing focused (a quote clicked, text selected): the actions' button stands in.
      const menu = focused.closest(".menu");
      opener =
        focused === document.body
          ? null
          : menu
            ? (menu.querySelector<HTMLElement>(":scope > button") ?? actionsButton())
            : focused;
    }
    panel = which;
    focusTo = focus ? { to: "heading" } : null;
  }
  function closePanel() {
    const focused = document.activeElement;
    const lost = !focused || focused === document.body || panelBox?.contains(focused);
    panel = null;
    focusTo = lost ? { to: "opener" } : null;
  }
  // Where the panel overlays the page (under 960px of page, and the phone's sheet: the
  // stylesheet's call, read from the panel's position), it is modal (C-26, P-4): the page, the top
  // bar and the sidebar it dims are inert, and a tap on the dimmed page closes it.
  const frame = useFrame();
  let overlaid = $state(false);
  let page: HTMLDivElement | undefined = $state();
  $effect(() => {
    if (!panel) {
      overlaid = false;
      return;
    }
    const measure = () => {
      const el = panelBox?.querySelector(".concept-panel");
      overlaid = el ? getComputedStyle(el).position === "fixed" : false;
    };
    measure();
    const watch = new ResizeObserver(measure);
    if (page) watch.observe(page);
    return () => watch.disconnect();
  });
  const modal = $derived(panel !== null && overlaid);
  $effect(() => {
    frame.setModal(modal);
    return () => frame.setModal(false);
  });
  $effect(() => {
    const f = focusTo;
    if (!f) return;
    focusTo = null;
    void tick().then(() => {
      if (f.to === "heading") {
        panelBox?.querySelector<HTMLElement>(".panel-head h2")?.focus();
      } else {
        const back = opener?.isConnected ? opener : actionsButton();
        back?.focus();
      }
    });
  });
  function togglePanel(which: PanelName) {
    if (panel === which) closePanel();
    else openPanel(which);
  }

  // Comments: each thread's quote found in the body on screen, highlighted while open, listed in
  // the Comments panel.
  let active = $state<string | null>(untrack(() => threadInHash(bodyIds)));
  const placed = $derived(placeThreads(props.threads ?? [], prepared.text));
  const openCount = $derived(placed.filter((t) => t.status === "open").length);
  const draft = useDraft(() => prepared.text);
  function startDraft(range: { from: number; to: number }) {
    draft.start(range);
    openPanel("comments", false);
  }
  function onMark(id: string | null) {
    active = id;
    if (id) openPanel("comments");
  }
  const highlights = $derived(highlightsOf(placed, active, draft.draft));
  // A link that asks for a panel or a thread (the Inbox, the home, `?panel=`) opens it when the
  // URL changes to it, and again when the #fragment changes; never on its own otherwise.
  const asked = $derived(panelInUrl(bodyIds, here.url));
  const where = $derived(`${here.url.search}${here.url.hash}`);
  $effect(() => {
    const a = asked;
    void where;
    if (!a) return;
    untrack(() => {
      const id = threadInHash(bodyIds);
      if (id) active = id;
      panel = a;
    });
  });
  $effect(() => {
    const ids = bodyIds;
    const follow = () => {
      const id = threadInHash(ids);
      if (id) active = id;
      if (id || panelInUrl(ids, { search: "", hash: location.hash })) panel = "comments";
    };
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  });
  // Escape closes the panel (one Escape, one thing closed: a menu, a dialog, a draft or the
  // drawer handle theirs first and mark it handled).
  $effect(() => {
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
  });

  // Recent files, for the quick switcher.
  $effect(() => {
    if (urls.at === undefined) pushRecent(urls, { path: c.path, title });
  });

  const live = $derived(props.live);
  const moved = $derived(live && (live.change.op === "move" || live.change.op === "delete"));
  const folders = $derived.by(() => {
    const dir = dirOf(c.path);
    return dir ? dir.split("/").map((_, i, all) => all.slice(0, i + 1).join("/")) : [];
  });
  const mayVerify = $derived(role.current !== null && role.current !== "read");
  const hasContents = $derived(contents.length >= 2);
  const classes = $derived(
    ["concept", panel ? "panel-open" : "", markdown ? "markdown-on" : ""].filter(Boolean).join(" "),
  );
;
async () => {







 { const $$_div0 = svelteHTML.createElement("div", {   "class":classes,});page = $$_div0; { const $$_raBegaP1C = __sveltets_2_ensureComponent(PageBar); new $$_raBegaP1C({ target: __sveltets_2_any(), props: {  path,actions,}});} { svelteHTML.createElement("div", {  "class":`concept-grid`,}); { svelteHTML.createElement("article", {    "class":`doc`,"inert":modal,});if(compare){ { const $$_raBweiveR3C = __sveltets_2_ensureComponent(ReviewBar); new $$_raBweiveR3C({ target: __sveltets_2_any(), props: {             urls,"concept":c,compare,"standing":s,name,mayVerify,"error":changes.error,"onVerified":props.onVerified,}});}}if(props.notice){ { svelteHTML.createElement("div", { "class":`notice`,});props.notice; }}if(moved && live){ { const $$_ecitoNeviL3C = __sveltets_2_ensureComponent(LiveNotice); new $$_ecitoNeviL3C({ target: __sveltets_2_any(), props: {   urls,live,}});}} { const $$_recnuonnAeviL3C = __sveltets_2_ensureComponent(LiveAnnouncer); new $$_recnuonnAeviL3C({ target: __sveltets_2_any(), props: {  urls,live,}});}if(!compare && !current){ { const $$_raBnoisreV3C = __sveltets_2_ensureComponent(VersionBar); new $$_raBnoisreV3C({ target: __sveltets_2_any(), props: {       urls,"concept":c,"standing":s,name,}});}}if(markdown){ { const $$_nwodkraMwaR3C = __sveltets_2_ensureComponent(RawMarkdown); new $$_nwodkraMwaR3C({ target: __sveltets_2_any(), props: {       urls,"path":c.path,"hash":c.hash,"onBack":() => setMarkdown(false),}});}} { svelteHTML.createElement("div", {     "class":`doc-page`,"hidden":markdown,}); { svelteHTML.createElement("header", {  "class":`doc-head`,}); { svelteHTML.createElement("nav", {    "class":`doc-crumbs`,"aria-label":`Folders`,});    for(let f of __sveltets_2_ensureArray(folders)){let i = 1;f; { svelteHTML.createElement("span", {});if(i > 0){ { svelteHTML.createElement("span", { "aria-hidden":`true`,});   }}folderName(f); }} } { svelteHTML.createElement("h1", { "class":`doc-title`,});title; }if(typeof fm.description === "string"){ { svelteHTML.createElement("p", { "class":`doc-tagline`,});fm.description; }} { const $$_enilyB5C = __sveltets_2_ensureComponent(Byline); new $$_enilyB5C({ target: __sveltets_2_any(), props: {         "concept":c,"history":props.data.history,name,live,current,status,}});}if(current){ { const $$_eniLdekcehC5C = __sveltets_2_ensureComponent(CheckedLine); new $$_eniLdekcehC5C({ target: __sveltets_2_any(), props: {      urls,"path":c.path,"standing":s,name,}});}}if(hasContents){ { const $$_details5 = svelteHTML.createElement("details", {    "class":`toc-inline`,});inlineContents = $$_details5; { svelteHTML.createElement("summary", {});   { const $$_nocI7C = __sveltets_2_ensureComponent(Icon); new $$_nocI7C({ target: __sveltets_2_any(), props: {  "name":`down`,}});} } { const $$_stnetnoC6C = __sveltets_2_ensureComponent(Contents); new $$_stnetnoC6C({ target: __sveltets_2_any(), props: {     "headings":contents,"onPick":() => {
                  if (inlineContents) inlineContents.open = false;
                },}});} }} } { const $$_redaeR4C = __sveltets_2_ensureComponent(Reader); new $$_redaeR4C({ target: __sveltets_2_any(), props: {             prepared,"diff":changes.diff,hideFirst,hover,"card":hoverCard,highlights,onMark,"onComment":current ? startDraft : undefined,figureView,}});} { const $$_noitceSsecruoS4C = __sveltets_2_ensureComponent(SourcesSection); new $$_noitceSsecruoS4C({ target: __sveltets_2_any(), props: {      urls,"data":sources,prepared,"numbers":body.numbers,}});} } } { const $$_snoitcAegaP2C = __sveltets_2_ensureComponent(PageActions); new $$_snoitcAegaP2C({ target: __sveltets_2_any(), props: {                  urls,"path":c.path,"standing":s,name,openCount,current,"reviewing":compare?.kind === "review",mayVerify,"hidden":panel !== null,"onComment":() => openPanel("comments"),"onVerified":props.onVerified,}});}if(modal){ { svelteHTML.createElement("div", {       "class":`panel-scrim`,"aria-hidden":`true`,"onclick":closePanel,}); }} { const $$_div2 = svelteHTML.createElement("div", {   "class":`concept-side`,});panelBox = $$_div2;if(panel === "comments"){ { const $$_lenaP3C = __sveltets_2_ensureComponent(Panel); new $$_lenaP3C({ target: __sveltets_2_any(), props: {      children:() => { return __sveltets_2_any(0); },"name":`comments`,"count":openCount > 0 ? `${openCount} open` : null,"onClose":closePanel,}}); { const $$_tsiLstnemmoC4C = __sveltets_2_ensureComponent(CommentsList); new $$_tsiLstnemmoC4C({ target: __sveltets_2_any(), props: {                    urls,"path":c.path,placed,"error":props.threadsError,"loading":props.threads === null && props.threadsError === null,"writable":current,"draft":draft.draft,"onDraftDone":draft.clear,active,"onActive":(id) => (active = id),"onChanged":props.onCommented,}});}  Panel}} else if (panel === "history"){ { const $$_lenaP3C = __sveltets_2_ensureComponent(Panel); new $$_lenaP3C({ target: __sveltets_2_any(), props: {    children:() => { return __sveltets_2_any(0); },"name":`history`,"onClose":closePanel,}}); { const $$_tsiLyrotsiH4C = __sveltets_2_ensureComponent(HistoryList); new $$_tsiLyrotsiH4C({ target: __sveltets_2_any(), props: {        urls,"concept":c,"standing":s,name,"comparing":compare?.kind === "since",}});}  Panel}} else if (panel === "properties"){ { const $$_lenaP3C = __sveltets_2_ensureComponent(Panel); new $$_lenaP3C({ target: __sveltets_2_any(), props: {    children:() => { return __sveltets_2_any(0); },"name":`properties`,"onClose":closePanel,}}); { const $$_tsiLseitreporP4C = __sveltets_2_ensureComponent(PropertiesList); new $$_tsiLseitreporP4C({ target: __sveltets_2_any(), props: {                urls,"concept":c,links,"head":props.head,"standing":s,name,current,"reviewing":compare?.kind === "review",mayVerify,"onVerified":props.onVerified,}});}  Panel}} else if (hasContents && !markdown){ { svelteHTML.createElement("nav", {    "class":`concept-contents`,"aria-label":`Contents`,}); { const $$_stnetnoC4C = __sveltets_2_ensureComponent(Contents); new $$_stnetnoC4C({ target: __sveltets_2_any(), props: {  "headings":contents,}});} }} } } }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const ConceptPage__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type ConceptPage__SvelteComponent_ = ReturnType<typeof ConceptPage__SvelteComponent_>;
/*Ωignore_endΩ*/export default ConceptPage__SvelteComponent_;