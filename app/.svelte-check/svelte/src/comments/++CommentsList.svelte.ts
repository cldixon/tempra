///<reference types="svelte" />
;
import { threadElementId } from "../concept/panel";
import type { Urls } from "../urls";
import { type Draft, type Placed, panelOrder } from "./data";
import NewComment from "./NewComment.svelte";
import ThreadView from "./ThreadView.svelte";

;type $$ComponentProps =  {
    urls: Urls;
    path: string;
    placed: Placed[];
    /** The threads could not be loaded (a new comment can still be made). */
    error: string | null;
    /** The threads are still loading. */
    loading: boolean;
    /** Comments can be made (the latest version; an earlier one shows its threads read-only). */
    writable: boolean;
    draft: Draft | null;
    onDraftDone(): void;
    active: string | null;
    onActive(id: string | null): void;
    onChanged(): void;
  };function $$render() {

  
  
  
  
  

  /**
   * The Comments panel's list (take 4, TEMPRA-114; tempra-dev: app/comments, In the app): Open and
   * Resolved n, a box to start a comment on the page (TEMPRA-172), or the draft in its place while
   * one is being written, then the threads in document order
   * (those on the whole concept and outdated ones first), the active one as a card, the others
   * compact. Its frame (title, count, ×) is the concept's Panel.
   */
  let props:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
  const open = $derived(panelOrder(props.placed, "open"));
  const resolved = $derived(panelOrder(props.placed, "resolved"));
  let tab = $state<"open" | "resolved">("open");
  let composing = $state(false);
  // A thread made active (a quote clicked, a link to it) shows under its tab, once it has
  // loaded; a thread resolved while it is active stays where it is. A draft is under Open.
  const activeStatus = $derived(props.placed.find((t) => t.id === props.active)?.status);
  let switched: string | null = null;
  $effect(() => {
    const active = props.active;
    const status = activeStatus;
    if (!active || !status || switched === active) return;
    switched = active;
    tab = status;
  });
  $effect(() => {
    if (props.draft) tab = "open";
  });

  // The active thread comes into view in the panel, once it is there.
  let list: HTMLDivElement | undefined = $state();
  let shown: string | null = null;
  $effect(() => {
    const active = props.active;
    // `placed` changes as threads load.
    void props.placed;
    void tab;
    if (!active || shown === active) return;
    const el = list?.querySelector(`[id="${CSS.escape(threadElementId(active))}"]`);
    if (!el) return;
    shown = active;
    el.scrollIntoView({ block: "nearest" });
  });

  function posted(id: string) {
    props.onActive(id);
    props.onChanged();
  }
  const threads = $derived(tab === "open" ? open : resolved);
;
async () => {

 { const $$_div0 = svelteHTML.createElement("div", {   "class":`comments-list`,});list = $$_div0; { svelteHTML.createElement("fieldset", {  "class":`segmented`,}); { svelteHTML.createElement("legend", { "class":`visually-hidden`,});  } { svelteHTML.createElement("button", {     "type":`button`,"aria-pressed":tab === "open","onclick":() => (tab = "open"),});  } { svelteHTML.createElement("button", {     "type":`button`,"aria-pressed":tab === "resolved","onclick":() => (tab = "resolved"),}); resolved.length; } }if(props.error){ { svelteHTML.createElement("p", { "class":`small warn`,});     props.error; }}if(tab === "open" && props.draft){ { const $$_tnemmoCweN1C = __sveltets_2_ensureComponent(NewComment); new $$_tnemmoCweN1C({ target: __sveltets_2_any(), props: {           "urls":props.urls,"path":props.path,"draft":props.draft,"onDone":props.onDraftDone,"onPosted":posted,}});}}if(tab === "open" && !props.draft && composing){ { const $$_tnemmoCweN1C = __sveltets_2_ensureComponent(NewComment); new $$_tnemmoCweN1C({ target: __sveltets_2_any(), props: {           "urls":props.urls,"path":props.path,"draft":null,"onDone":() => (composing = false),"onPosted":posted,}});}}if(tab === "open" && props.writable && !props.draft && !composing){ { svelteHTML.createElement("div", {  "class":`new-thread-box`,}); { svelteHTML.createElement("button", {     "type":`button`,"class":`new-thread`,"onclick":() => (composing = true),});    } { svelteHTML.createElement("p", { "class":`small muted`,});       } }}   for(let t of __sveltets_2_ensureArray(threads)){t.id; { const $$_weiVdaerhT1C = __sveltets_2_ensureComponent(ThreadView); new $$_weiVdaerhT1C({ target: __sveltets_2_any(), props: {             "urls":props.urls,"thread":t,"active":t.id === props.active,"writable":props.writable,"onActive":props.onActive,"onChanged":props.onChanged,}});}}if(props.loading){ { svelteHTML.createElement("p", { "class":`small muted`,});  }}if(!props.loading && threads.length === 0 && !props.draft && !composing){ { svelteHTML.createElement("p", {  "class":`small muted`,});tab === "resolved" ? "No resolved threads." : "No open threads."; }} }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const CommentsList__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type CommentsList__SvelteComponent_ = ReturnType<typeof CommentsList__SvelteComponent_>;
/*Ωignore_endΩ*/export default CommentsList__SvelteComponent_;