///<reference types="svelte" />
;
import type { Urls } from "./urls";

;type $$ComponentProps =  { urls: Urls; head: number; current: string };function $$render() {

  

  /** An earlier version on screen (`?at=`), said in words, with the way back to the latest. */
  let { urls, head, current }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
;
async () => {

if(urls.at !== undefined && urls.at < head){
   { svelteHTML.createElement("div", { "class":`notice`,});    { svelteHTML.createElement("a", { "href":current,});   } }
}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const AtNotice__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type AtNotice__SvelteComponent_ = ReturnType<typeof AtNotice__SvelteComponent_>;
/*Ωignore_endΩ*/export default AtNotice__SvelteComponent_;