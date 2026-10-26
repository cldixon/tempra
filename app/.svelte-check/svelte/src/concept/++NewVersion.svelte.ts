///<reference types="svelte" />
;
import { useAgentNames } from "../agents.svelte.ts";
import Icon from "../Icon.svelte";
import Menu from "../Menu.svelte";
import { relativeTime } from "../ui";
import { useNow } from "../ui.svelte.ts";
import type { Urls } from "../urls";
import { CONTENT_OPS } from "./data";
import { changeLine, type Live } from "./live";

;type $$ComponentProps =  { urls: Urls; live: Live };function $$render() {

  
  
  
  
  
  
  
  

  /**
   * A newer version, in the cluster: a pulsing glyph that opens who wrote it, Show diff and Show
   * new version.
   */
  let { urls, live }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
  const names = useAgentNames(() => urls);
  const now = useNow(5000);
  const e = $derived(live.change);
  const by = $derived(names.label(e.actor, e.by));
;
async () => {

 { svelteHTML.createElement("div", { "class":`new-version`,});
   { const $$_uneM1C = __sveltets_2_ensureComponent(Menu); const $$_uneM1 = new $$_uneM1C({ target: __sveltets_2_any(), props: {       children:() => { return __sveltets_2_any(0); },"name":`New version`,"title":`New version · ${by}${e.note ? ` · ${e.note}` : ""}`,"buttonClass":`icon-button`,"align":`end`,label:() => { async ()/*Ωignore_positionΩ*/ => { { const $$_nocI0C = __sveltets_2_ensureComponent(Icon); new $$_nocI0C({ target: __sveltets_2_any(), props: {  "name":`refresh`,}});}};return __sveltets_2_any(0)},}});/*Ωignore_startΩ*/const {label} = $$_uneM1.$$prop_def;/*Ωignore_endΩ*/
     { svelteHTML.createElement("p", {});changeLine(e, by, relativeTime(e.ts, now.current)); }if(CONTENT_OPS.has(e.op)){ { svelteHTML.createElement("a", { "href":urls.diff(e.path, live.shownSeq, e.seq),});  }} { svelteHTML.createElement("button", {   "type":`button`,"onclick":() => live.onSwap(),});   }
   Menu}
 }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const NewVersion__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type NewVersion__SvelteComponent_ = ReturnType<typeof NewVersion__SvelteComponent_>;
/*Ωignore_endΩ*/export default NewVersion__SvelteComponent_;