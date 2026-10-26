///<reference types="svelte" />
;
import { useFeedStatus } from "./live.svelte.ts";
import type { Urls } from "./urls";

;type $$ComponentProps =  { urls: Urls };function $$render() {

  
  

  /**
   * "Reconnecting…", quietly, while the library's feed is trying to get back (F-19): a page then
   * stops following agents' writes until it does. Nothing while the feed is live.
   */
  let { urls }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
  const status = useFeedStatus(() => urls);
;
async () => {

 { svelteHTML.createElement("span", {   "class":`feed-status`,"role":`status`,});status.current === "reconnecting" ? "Reconnecting…" : ""; }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const FeedNotice__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type FeedNotice__SvelteComponent_ = ReturnType<typeof FeedNotice__SvelteComponent_>;
/*Ωignore_endΩ*/export default FeedNotice__SvelteComponent_;