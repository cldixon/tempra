///<reference types="svelte" />
;
import AgentName from "../AgentName.svelte";
import { ApiError } from "../api";
import { useTitleOf } from "../frame.svelte.ts";
import Moment from "../Moment.svelte";
import { day, plural } from "../ui";
import type { Urls } from "../urls";
import type { Namer } from "./byline";
import { changesSince, markChecked } from "./checked";
import { actedBy, type Concept, type Json, type Links, type Standing } from "./data";

;type $$ComponentProps =  {
    urls: Urls;
    concept: Concept;
    links: Links;
    head: number;
    standing: Standing;
    name: Namer;
    /** The page is current (not a pinned old version), so it can be checked. */
    current: boolean;
    /** Review mode is on (the changes since the last check are drawn). */
    reviewing: boolean;
    /** A write member: may mark it as checked. */
    mayVerify: boolean;
    onVerified(): void;
  };function $$render() {
  const notSet/*Ωignore_positionΩ*/ = ()/*Ωignore_startΩ*/: ReturnType<import('svelte').Snippet>/*Ωignore_endΩ*/ => { async ()/*Ωignore_positionΩ*/ => { { svelteHTML.createElement("span", { "class":`muted`,});  }};return __sveltets_2_any(0)};
  
  
  
  
  
  
  
  
  

  /**
   * The Properties panel (take 4, TEMPRA-114; TEMPRA-122 and 134; tempra-dev: app/reader, The
   * panels): short and in people's words. What a reader needs (status, stale or not, who changed
   * it last, type, tags, sources, what links here by title), then Check when there is something to
   * do (decisions/take4-followups-ui-only). What agents would fix (lint, work items, broken links)
   * is theirs, through `work`, not the panel's (TEMPRA-144).
   */
  let props:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();

  /** A frontmatter value as text: a list joined, anything else as it reads. */
  function text(v: Json | undefined): string | null {
    if (v === undefined || v === null || v === "") return null;
    if (Array.isArray(v)) {
      const words = v.filter((x) => x !== null && typeof x !== "object").map(String);
      return words.length > 0 ? words.join(", ") : null;
    }
    return typeof v === "object" ? null : String(v);
  }

  /** "No, until Nov 19", "Soon, on Nov 2", "Yes, since Oct 3", or "No". */
  function staleWords(c: Concept): string {
    const after = text(c.frontmatter.stale_after);
    const on = after ? day(after) : null;
    if (c.stale) return on ? `Yes, since ${on}` : "Yes";
    if (c.stale_soon && on) return `Soon, on ${on}`;
    return on ? `No, until ${on}` : "No";
  }

  // What a reader asks about the page, in a fixed order.
  const fm = $derived(props.concept.frontmatter);
  const sources = $derived(Array.isArray(fm.sources) ? fm.sources.length : 0);
  const last = $derived(props.standing.current?.event);
  const status = $derived(text(fm.status));
  const type = $derived(text(fm.type));
  const tags = $derived(text(fm.tags));

  // What links here, by title: one row per page, however many times it links here.
  const atHead = $derived(props.urls.at === undefined || props.urls.at >= props.head);
  const titles = useTitleOf();
  const pages = $derived([...new Map(props.links.inbound.map((l) => [l.path, l])).values()]);

  /*
   * Whether a person checked the page, when there is something to do about it: a page nobody
   * checked offers only Mark as checked (to a write member); a page checked and changed since says
   * how much and offers Show changes (review mode, whose bar has Mark as checked and Done); nothing
   * once the version on screen is the checked one.
   */
  const s = $derived(props.standing);
  const showCheck = $derived(
    props.current &&
      !(s.verified && s.since === 0) &&
      !(!s.verified && (!props.mayVerify || props.reviewing)),
  );
  let busy = $state(false);
  let error = $state<string | null>(null);
  async function check() {
    busy = true;
    error = null;
    try {
      await markChecked(props.urls, props.concept.path);
      props.onVerified();
    } catch (err) {
      error = err instanceof ApiError ? err.message : String(err);
    } finally {
      busy = false;
    }
  }
;
async () => {


 { svelteHTML.createElement("dl", {  "class":`facts`,}); { svelteHTML.createElement("div", { "class":`fact`,}); { svelteHTML.createElement("dt", {});  } { svelteHTML.createElement("dd", {});if(status !== null){status;}else{;__sveltets_2_ensureSnippet(notSet());} } } { svelteHTML.createElement("div", { "class":`fact`,}); { svelteHTML.createElement("dt", {});  } { svelteHTML.createElement("dd", {});staleWords(props.concept); } }if(last){ { svelteHTML.createElement("div", {  "class":`fact`,}); { svelteHTML.createElement("dt", {});  } { svelteHTML.createElement("dd", {}); { svelteHTML.createElement("span", {}); { const $$_emaNtnegA4C = __sveltets_2_ensureComponent(AgentName); new $$_emaNtnegA4C({ target: __sveltets_2_any(), props: {  "who":props.name(last.actor, actedBy(last)),}});}  { const $$_tnemoM4C = __sveltets_2_ensureComponent(Moment); new $$_tnemoM4C({ target: __sveltets_2_any(), props: {  "ts":last.ts,}});} } } }} { svelteHTML.createElement("div", { "class":`fact`,}); { svelteHTML.createElement("dt", {});  } { svelteHTML.createElement("dd", {});if(type !== null){type;}else{;__sveltets_2_ensureSnippet(notSet());} } }if(tags){ { svelteHTML.createElement("div", { "class":`fact`,}); { svelteHTML.createElement("dt", {});  } { svelteHTML.createElement("dd", {});tags; } }} { svelteHTML.createElement("div", {  "class":`fact`,}); { svelteHTML.createElement("dt", {});  } { svelteHTML.createElement("dd", {});if(sources > 0){ { svelteHTML.createElement("a", { "href":`#doc-sources`,});plural(sources, "source"); }}else{ } } } } { svelteHTML.createElement("section", {  "class":`panel-section`,}); { svelteHTML.createElement("h3", { "class":`label`,});  }if(pages.length > 0){ { svelteHTML.createElement("ul", { "class":`linked`,});
         for(let l of __sveltets_2_ensureArray(pages)){l.path; { svelteHTML.createElement("li", {}); { svelteHTML.createElement("a", { "href":props.urls.pinned(undefined).file(l.path),});titles.of(l.path); }if(l.kind === "source"){ { svelteHTML.createElement("span", { "class":`muted`,});" cites it"; }} }}
     }}else{ { svelteHTML.createElement("p", { "class":`small muted`,});atHead ? "Nothing links here." : "Shown for the latest version."; }} }if(showCheck){ { svelteHTML.createElement("section", {    "class":`panel-section check`,"aria-label":`Check`,});if(s.verified){ { svelteHTML.createElement("p", { "class":`check-state`,});changesSince(s, props.name); }if(!props.reviewing){ { svelteHTML.createElement("div", { "class":`actions`,}); { svelteHTML.createElement("a", {   "class":`button`,"href":props.urls.review(props.concept.path),});  } }}}else{ { svelteHTML.createElement("div", { "class":`actions`,}); { svelteHTML.createElement("button", {     "type":`button`,"disabled":busy,"onclick":check,});   } }}if(error){ { svelteHTML.createElement("p", { "class":`small warn`,});error; }} }}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const PropertiesList__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type PropertiesList__SvelteComponent_ = ReturnType<typeof PropertiesList__SvelteComponent_>;
/*Ωignore_endΩ*/export default PropertiesList__SvelteComponent_;