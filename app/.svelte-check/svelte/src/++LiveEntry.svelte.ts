///<reference types="svelte" />
;
import type { LiveWrite } from "./activity";
import AgentName from "./AgentName.svelte";
import type { ActorView } from "./agents";
import Avatar from "./Avatar.svelte";
import type { Urls } from "./urls";

;type $$ComponentProps =  { write: LiveWrite; urls: Urls; actor: ActorView; title: string };function $$render() {

  
  
  
  
  

  /**
   * The live entry at the top of the Summary: an agent writing now ("Claude Code is editing
   * Reader"), with the pulsing dot, while its writes keep arriving.
   */
  let {
    write: w,
    urls,
    actor,
    title,
  }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
;
async () => {

 { svelteHTML.createElement("article", {   "class":`entry live`,"aria-live":`polite`,});
   { const $$_ratavA1C = __sveltets_2_ensureComponent(Avatar); new $$_ratavA1C({ target: __sveltets_2_any(), props: {    "name":actor.mark,"agent":actor.agent,}});}
   { svelteHTML.createElement("div", { "class":`entry-body`,});
     { svelteHTML.createElement("p", { "class":`entry-line`,}); { const $$_emaNtnegA3C = __sveltets_2_ensureComponent(AgentName); new $$_emaNtnegA3C({ target: __sveltets_2_any(), props: {  "who":actor,}});}    { svelteHTML.createElement("a", { "href":urls.file(w.path),});title; } }
   }
   { svelteHTML.createElement("span", { "class":`entry-side entry-now`,}); { svelteHTML.createElement("span", {   "class":`change-dot live`,"aria-hidden":`true`,}); }  }
 }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const LiveEntry__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type LiveEntry__SvelteComponent_ = ReturnType<typeof LiveEntry__SvelteComponent_>;
/*Ωignore_endΩ*/export default LiveEntry__SvelteComponent_;