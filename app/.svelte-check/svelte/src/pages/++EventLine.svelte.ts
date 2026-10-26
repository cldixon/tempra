///<reference types="svelte" />
;
import { type EventRow, entryTime } from "../activity";
import AgentName from "../AgentName.svelte";
import type { ActorView } from "../agents";
import Avatar from "../Avatar.svelte";
import { localTime } from "../ui";
import type { Urls } from "../urls";

;type $$ComponentProps =  {
    row: EventRow;
    urls: Urls;
    actor: ActorView;
    live: boolean;
    revert: boolean;
    now: number;
  };function $$render() {

  
  
  
  
  
  

  /** One row of Every event. */
  let {
    row,
    urls,
    actor,
    live,
    revert,
    now,
  }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();

  /** Events that made a version of a file, so a diff shows what they changed. */
  const DIFFABLE = new Set(["put", "import", "revert", "attach"]);

  const e = $derived(row.event);
  // A deleted file is shown as it was just before; a comment opens on its page.
  const href = $derived(
    e.op === "comment"
      ? urls.file(e.path)
      : urls.pinned(e.op === "delete" ? e.seq - 1 : e.seq).file(e.path),
  );
;
async () => {

 { svelteHTML.createElement("tr", { "class":row.lead ? "lead" : undefined,});
   { svelteHTML.createElement("td", { "class":`events-seq`,});if(live){ { svelteHTML.createElement("span", { "class":`change-dot live`,}); { svelteHTML.createElement("span", { "class":`visually-hidden`,});   } }}e.seq; }
   { svelteHTML.createElement("td", { "class":`events-when`,});
    if(row.lead){
       { svelteHTML.createElement("time", {   "datetime":e.ts,"title":localTime(e.ts),});entryTime(e.ts, now, true); }
    }
   }
   { svelteHTML.createElement("td", { "class":`events-who`,});
    if(row.lead){
       { svelteHTML.createElement("span", { "class":`events-person`,}); { const $$_ratavA3C = __sveltets_2_ensureComponent(Avatar); new $$_ratavA3C({ target: __sveltets_2_any(), props: {    "name":actor.mark,"agent":actor.agent,}});} { const $$_emaNtnegA3C = __sveltets_2_ensureComponent(AgentName); new $$_emaNtnegA3C({ target: __sveltets_2_any(), props: {  "who":actor,}});} }
    }
   }
   { svelteHTML.createElement("td", { "class":`events-kind`,});row.kind; }
   { svelteHTML.createElement("td", { "class":`events-path`,}); { svelteHTML.createElement("a", { "href":href,}); { svelteHTML.createElement("code", {});e.path; } }if(row.note){ { svelteHTML.createElement("span", { "class":`events-note`,});row.note; }}if(DIFFABLE.has(e.op) && e.path.endsWith(".md")){ { svelteHTML.createElement("a", {   "class":`events-aside`,"href":urls.diff(e.path, undefined, e.seq),});  }}if(revert){ { svelteHTML.createElement("a", {   "class":`events-aside`,"href":urls.revert(row.request.request_id),});  }} }
 }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const EventLine__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type EventLine__SvelteComponent_ = ReturnType<typeof EventLine__SvelteComponent_>;
/*Ωignore_endΩ*/export default EventLine__SvelteComponent_;