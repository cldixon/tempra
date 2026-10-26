///<reference types="svelte" />
;
import AgentName from "../AgentName.svelte";
import { type ActorView, actorText } from "../agents";
import { useActors } from "../agents.svelte.ts";
import Avatar from "../Avatar.svelte";
import { threadElementId } from "../concept/panel";
import Moment from "../Moment.svelte";
import { revealOffset } from "../reader/reading";
import { clip } from "../ui";
import { useMe } from "../ui.svelte.ts";
import type { Urls } from "../urls";
import type { CommentT, Placed } from "./data";
import ThreadActions from "./ThreadActions.svelte";

;type $$ComponentProps =  {
    urls: Urls;
    thread: Placed;
    active: boolean;
    writable: boolean;
    onActive(id: string | null): void;
    onChanged(): void;
  };function $$render() {
 const by/*Ωignore_positionΩ*/ = (who: ActorView)/*Ωignore_startΩ*/: ReturnType<import('svelte').Snippet>/*Ωignore_endΩ*/ => { async ()/*Ωignore_positionΩ*/ => { { const $$_ratavA0C = __sveltets_2_ensureComponent(Avatar); new $$_ratavA0C({ target: __sveltets_2_any(), props: {    "name":who.mark,"agent":who.agent,}});} { const $$_emaNtnegA0C = __sveltets_2_ensureComponent(AgentName); new $$_emaNtnegA0C({ target: __sveltets_2_any(), props: { who,}});}};return __sveltets_2_any(0)};  const outdatedMark/*Ωignore_positionΩ*/ = ()/*Ωignore_startΩ*/: ReturnType<import('svelte').Snippet>/*Ωignore_endΩ*/ => { async ()/*Ωignore_positionΩ*/ => { { svelteHTML.createElement("span", {   "class":`thread-outdated`,"title":`The quoted text is no longer on the page`,});  }};return __sveltets_2_any(0)}; const comment/*Ωignore_positionΩ*/ = (c: CommentT)/*Ωignore_startΩ*/: ReturnType<import('svelte').Snippet>/*Ωignore_endΩ*/ => { async ()/*Ωignore_positionΩ*/ => { { svelteHTML.createElement("div", {  "class":`said`,}); { svelteHTML.createElement("div", { "class":`said-by`,});;__sveltets_2_ensureSnippet(by(name(c.actor, c.by)));  { const $$_tnemoM2C = __sveltets_2_ensureComponent(Moment); new $$_tnemoM2C({ target: __sveltets_2_any(), props: {  "ts":c.ts,}});} } { svelteHTML.createElement("p", { "class":`comment`,});c.body; } }};return __sveltets_2_any(0)};
  
  
  
  
  
  
  
  
  
  
  
  

  /*
   * One comment thread as the Comments panel draws it (tempra-dev: app/comments): compact (its
   * quote, then who, the first words, when) until it is the active thread, a card with its
   * comments, a reply field and Resolve (Reopen once resolved). The composer for a new comment is
   * NewComment.svelte.
   */
  let props:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();

  // Names actors for comments: agents for their person, the signed-in person as "You".
  const me = useMe();
  const actors = useActors(
    () => props.urls,
    () => me.current?.actor ?? null,
  );
  const name = actors.view;
  const t = $derived(props.thread);
  const first = $derived(t.comments[0]);
  const outdated = $derived(t.anchor !== null && t.at === null);
  function select() {
    props.onActive(t.id);
    if (t.at) revealOffset(t.at.from);
  }
  // A compact thread expanded from the panel hands the focus to its card (C-25), which replaces
  // the button that had it.
  let card: HTMLElement | undefined = $state();
  let expanding = false;
  $effect(() => {
    if (!props.active || !expanding || !card) return;
    expanding = false;
    card.focus();
  });
;
async () => {






if(!props.active){
   { svelteHTML.createElement("button", {           "type":`button`,"id":threadElementId(t.id),"class":t.status === "open" ? "thread collapsed" : "thread collapsed resolved","aria-expanded":`false`,"onclick":() => {
      expanding = true;
      select();
    },});if(outdated){;__sveltets_2_ensureSnippet(outdatedMark());}if(t.anchor){ { svelteHTML.createElement("span", { "class":`quote thread-quote`,});clip(t.anchor.quote, 120); }} { svelteHTML.createElement("span", {   "class":`thread-meta`,});if(first){;__sveltets_2_ensureSnippet(by(name(first.actor, first.by)));} { svelteHTML.createElement("span", { "class":`thread-words`,});first ? clip(first.body, 80) : ""; }if(t.replies > 0){ { svelteHTML.createElement("span", { "class":`thread-replies`,});t.replies + 1; }}if(first){ { const $$_tnemoM2C = __sveltets_2_ensureComponent(Moment); new $$_tnemoM2C({ target: __sveltets_2_any(), props: {   "ts":t.comments[t.comments.length - 1]?.ts ?? first.ts,}});}} } }
}else{
   { const $$_section0 = svelteHTML.createElement("section", {          "tabindex":-1,"id":threadElementId(t.id),"class":t.status === "open" ? "thread open" : "thread open resolved","aria-label":`Comment thread`,});card = $$_section0;if(outdated){;__sveltets_2_ensureSnippet(outdatedMark());}if(t.anchor){ { svelteHTML.createElement("blockquote", {  "class":`quote thread-quote`,});if(t.at){ { svelteHTML.createElement("a", {    "href":`#thread-${t.id}`,"onclick":(e) => {
              e.preventDefault();
              select();
            },});clip(t.anchor.quote, 300); }}else{clip(t.anchor.quote, 300);} }}if(!t.actions){   for(let c of __sveltets_2_ensureArray(t.comments)){c.id;;__sveltets_2_ensureSnippet(comment(c));}}else{   for(let a of __sveltets_2_ensureArray(t.actions)){a.seq;const c = a.comment ? t.comments.find((x) => x.id === a.comment) : undefined;if(a.kind === "resolve" || a.kind === "reopen"){ { svelteHTML.createElement("div", { }); { svelteHTML.createElement("p", { "class":`said-change`,});a.kind === "resolve" ? "Resolved" : "Reopened";  actorText(name(a.actor, a.by));  { const $$_tnemoM3C = __sveltets_2_ensureComponent(Moment); new $$_tnemoM3C({ target: __sveltets_2_any(), props: {  "ts":a.ts,}});} }if(c){ { svelteHTML.createElement("p", { "class":`comment`,});c.body; }} }} else if (c){;__sveltets_2_ensureSnippet(comment(c));}}} { const $$_snoitcAdaerhT1C = __sveltets_2_ensureComponent(ThreadActions); new $$_snoitcAdaerhT1C({ target: __sveltets_2_any(), props: { ...props,}});} }
}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const ThreadView__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type ThreadView__SvelteComponent_ = ReturnType<typeof ThreadView__SvelteComponent_>;
/*Ωignore_endΩ*/export default ThreadView__SvelteComponent_;