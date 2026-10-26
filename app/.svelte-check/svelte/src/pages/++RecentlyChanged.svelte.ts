///<reference types="svelte" />
;
import type { ActedBy, ActorView } from "../agents";
import Moment from "../Moment.svelte";
import { dirOf, folderName, type Urls } from "../urls";
import type { Changed } from "./home";

;type $$ComponentProps =  { urls: Urls; changed: Changed[]; view(actor: string, by: ActedBy | null): ActorView };function $$render() {

  
  
  
  

  /** Recently changed: the last few pages edited, each with who and when; absent when none. */
  let {
    urls,
    changed,
    view,
  }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ =
    $props();
;
async () => {

if(changed.length > 0){
   { svelteHTML.createElement("section", {   "class":`home-section`,"aria-labelledby":`home-recent`,});
     { svelteHTML.createElement("div", { "class":`view-section-head`,});
       { svelteHTML.createElement("h2", {   "id":`home-recent`,"class":`view-section-title`,});  }
     }
     { svelteHTML.createElement("ul", { "class":`home-recent`,});
         for(let c of __sveltets_2_ensureArray(changed)){c.path;
        const who = view(c.actor, c.by);
        const folder = dirOf(c.path);
         { svelteHTML.createElement("li", { "class":`home-recent-row`,});
           { svelteHTML.createElement("a", {   "class":`home-recent-title`,"href":urls.file(c.path),});c.title; }
           { svelteHTML.createElement("span", { "class":`home-recent-meta`,});if(folder){ { svelteHTML.createElement("span", {});`${folderName(folder)} · `; }}who.name;who.for ? ` for ${who.for}` : "";   { const $$_tnemoM4C = __sveltets_2_ensureComponent(Moment); new $$_tnemoM4C({ target: __sveltets_2_any(), props: {  "ts":c.ts,}});} }
         }
      }
     }
   }
}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const RecentlyChanged__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type RecentlyChanged__SvelteComponent_ = ReturnType<typeof RecentlyChanged__SvelteComponent_>;
/*Ωignore_endΩ*/export default RecentlyChanged__SvelteComponent_;