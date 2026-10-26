///<reference types="svelte" />
;
import { day } from "../ui";
import type { Urls } from "../urls";
import type { Namer } from "./byline";
import { checker } from "./checked";
import type { Standing } from "./data";

;type $$ComponentProps =  { urls: Urls; path: string; standing: Standing; name: Namer };function $$render() {

  
  
  
  
  

  /**
   * The quiet line under the byline: "Checked by you, Oct 12", and "· changed since" (opening
   * review mode) when the page was edited after. Nothing when nobody has checked it.
   */
  let { urls, path, standing: s, name }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ =
    $props();
  const who = $derived(checker(s, name));
;
async () => {

if(who && s.verified){
   { svelteHTML.createElement("p", { "class":`doc-checked`,});  who; day(s.verified.event.ts);if(s.since > 0){ { svelteHTML.createElement("span", {   "class":`byline-sep`,"aria-hidden":`true`,});" · "; } { svelteHTML.createElement("a", { "href":urls.review(path),});  }} }
}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const CheckedLine__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type CheckedLine__SvelteComponent_ = ReturnType<typeof CheckedLine__SvelteComponent_>;
/*Ωignore_endΩ*/export default CheckedLine__SvelteComponent_;