///<reference types="svelte" />
;
import AgentName from "../AgentName.svelte";
import { actorText } from "../agents";
import Avatar from "../Avatar.svelte";
import Moment from "../Moment.svelte";
import { EDITING_MS, type Namer } from "./byline";
import { actedBy, type Concept, type HistoryEvent, standing } from "./data";
import type { Live } from "./live";
import StatusPills from "./StatusPills.svelte";

;type $$ComponentProps =  {
    concept: Concept;
    history: HistoryEvent[];
    name: Namer;
    live: Live | null;
    /** The latest version is on screen: an earlier one is never being edited now. */
    current: boolean;
    /** The page's `status` from its frontmatter, if any. */
    status?: string | null;
  };function $$render() {
  const sep/*Ωignore_positionΩ*/ = ()/*Ωignore_startΩ*/: ReturnType<import('svelte').Snippet>/*Ωignore_endΩ*/ => { async ()/*Ωignore_positionΩ*/ => { { svelteHTML.createElement("span", {   "class":`byline-sep`,"aria-hidden":`true`,});  }};return __sveltets_2_any(0)};
  
  
  
  
  
  
  
  

  /**
   * The concept's byline (take 4, TEMPRA-114; tempra-dev: app/reader, The byline): who wrote the
   * version on screen, for whom when an agent ("Claude Code for @ann"), and when ("edited 14 min
   * ago"); while an agent writes the page (a write within the last minute, or one on the feed not
   * yet shown) "· editing now" with the pulsing dot, the agent named once (TEMPRA-131: "Claude
   * Code for @ann · editing now · edited just now"). It follows the version on screen: an earlier
   * one shows who wrote it and when, never "editing now". Versions are in History; whether a person
   * checked the page is the quiet line under it (`CheckedLine.svelte`). At its end, grey pills say
   * what is exceptional: a status that is not stable ("Draft") and "Stale" (TEMPRA-139).
   */
  let props:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();

  const live = $derived(props.current ? props.live : null);
  const s = $derived(standing(props.history, props.concept.seq));
  const author = $derived(s.current?.event);
  const who = $derived(author ? props.name(author.actor, actedBy(author)) : null);
  // An agent's write on the feed (not yet swapped in) or the version on screen, if recent.
  const pendingAgent = $derived.by(() => {
    const pending = live?.change;
    return pending &&
      pending.op !== "comment" &&
      (pending.by?.agent || !pending.actor.startsWith("human:"))
      ? pending
      : null;
  });
  const writer = $derived(
    pendingAgent ? props.name(pendingAgent.actor, pendingAgent.by ?? null) : who?.agent ? who : null,
  );
  const at = $derived(
    pendingAgent ? Date.parse(pendingAgent.ts) : who?.agent && author ? Date.parse(author.ts) : null,
  );

  // True until `at` is EDITING_MS old, turning false on its own when it is.
  let now = $state(Date.now());
  const since = $derived(props.current ? at : null);
  $effect(() => {
    const ts = since;
    if (ts === null) return;
    const left = ts + EDITING_MS - Date.now();
    if (left <= 0) return;
    now = Date.now();
    const timer = setTimeout(() => {
      now = Date.now();
    }, left + 50);
    return () => clearTimeout(timer);
  });
  const editing = $derived(since !== null && now - since < EDITING_MS && writer !== null);
  // The agent is named once: when the one writing now wrote the version on screen, "editing
  // now" follows its name; another writer is named in that clause.
  const same = $derived(writer !== null && who !== null && actorText(writer) === actorText(who));
;
async () => {


if(!who || !author){
   { svelteHTML.createElement("div", { "class":`byline`,}); { const $$_slliPsutatS1C = __sveltets_2_ensureComponent(StatusPills); new $$_slliPsutatS1C({ target: __sveltets_2_any(), props: {    "status":props.status ?? null,"stale":props.concept.stale,}});} }
}else{
   { svelteHTML.createElement("div", {  "class":`byline`,}); { const $$_ratavA1C = __sveltets_2_ensureComponent(Avatar); new $$_ratavA1C({ target: __sveltets_2_any(), props: {    "name":who.mark,"agent":who.agent,}});} { svelteHTML.createElement("span", { "class":`byline-name`,}); { const $$_emaNtnegA2C = __sveltets_2_ensureComponent(AgentName); new $$_emaNtnegA2C({ target: __sveltets_2_any(), props: { who,}});} }if(editing && writer){;__sveltets_2_ensureSnippet(sep()); { svelteHTML.createElement("span", {    "class":`byline-live`,"role":`status`,}); { svelteHTML.createElement("span", {   "class":`change-dot live`,"aria-hidden":`true`,}); }same ? "editing now" : `${actorText(writer)} is editing now`; }};__sveltets_2_ensureSnippet(sep()); { svelteHTML.createElement("span", { "class":`muted`,});  { const $$_tnemoM2C = __sveltets_2_ensureComponent(Moment); new $$_tnemoM2C({ target: __sveltets_2_any(), props: {  "ts":author.ts,}});} } { const $$_slliPsutatS1C = __sveltets_2_ensureComponent(StatusPills); new $$_slliPsutatS1C({ target: __sveltets_2_any(), props: {    "status":props.status ?? null,"stale":props.concept.stale,}});} }
}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const Byline__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type Byline__SvelteComponent_ = ReturnType<typeof Byline__SvelteComponent_>;
/*Ωignore_endΩ*/export default Byline__SvelteComponent_;