///<reference types="svelte" />
;
import { localTime, relativeTime } from "./ui";
import { useNow } from "./ui.svelte.ts";

;type $$ComponentProps =  { ts: string; now?: number };function $$render() {

  
  

  /**
   * When something happened, the one way the app draws it (TEMPRA-131): `relativeTime` ("just
   * now", "3 min ago", "yesterday", "Oct 12"), kept current, with the reader's local date and
   * time on hover. `now` is a clock the caller already ticks, if it has one.
   */
  let { ts, now }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
  const ticking = useNow();
;
async () => {

 { svelteHTML.createElement("time", {   "datetime":ts,"title":localTime(ts),});relativeTime(ts, now ?? ticking.current); }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const Moment__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type Moment__SvelteComponent_ = ReturnType<typeof Moment__SvelteComponent_>;
/*Ωignore_endΩ*/export default Moment__SvelteComponent_;