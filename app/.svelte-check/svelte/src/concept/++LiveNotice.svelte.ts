///<reference types="svelte" />
;
import { useAgentNames } from "../agents.svelte.ts";
import { relativeTime } from "../ui";
import { useNow } from "../ui.svelte.ts";
import type { Urls } from "../urls";
import { CONTENT_OPS } from "./data";
import { changeLine, type Live } from "./live";

;type $$ComponentProps =  { urls: Urls; live: Live };function $$render() {

  
  
  
  
  
  

  /**
   * A change the cluster cannot show: the open file was moved or deleted (or it is not a concept).
   * A notice on the page, with the way to where it went.
   */
  let { urls, live }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
  const names = useAgentNames(() => urls);
  const now = useNow(5000);
  const e = $derived(live.change);
;
async () => {

 { svelteHTML.createElement("div", { "class":`notice`,});changeLine(e, names.label(e.actor, e.by), relativeTime(e.ts, now.current)); if(e.op === "move"){ { svelteHTML.createElement("a", { "href":urls.pinned(undefined).file(e.path),});      }} else if (e.op === "delete"){ { svelteHTML.createElement("a", { "href":urls.tree(""),});  }}else{if(CONTENT_OPS.has(e.op)){ { svelteHTML.createElement("a", { "href":urls.diff(e.path, live.shownSeq, e.seq),});  } } { svelteHTML.createElement("button", {   "type":`button`,"onclick":() => live.onSwap(),});   }} }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const LiveNotice__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type LiveNotice__SvelteComponent_ = ReturnType<typeof LiveNotice__SvelteComponent_>;
/*Ωignore_endΩ*/export default LiveNotice__SvelteComponent_;