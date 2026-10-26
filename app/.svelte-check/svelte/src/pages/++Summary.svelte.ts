///<reference types="svelte" />
;
import {
    byPerson,
    type Entry,
    groupByDay,
    type LedgerRequest,
    type LiveWrite,
    titleOf,
    toEntry,
  } from "../activity";
import { useActors } from "../agents.svelte.ts";
import EntryRow from "../EntryRow.svelte";
import LiveEntry from "../LiveEntry.svelte";
import type { Urls, Who } from "../urls";

;type $$ComponentProps =  {
    urls: Urls;
    me: string;
    requests: LedgerRequest[];
    empty: boolean;
    titles: Record<string, string>;
    who: Who;
    writing: LiveWrite | null;
    now: number;
  };function $$render() {

  
  
  
  
  

  /** The Summary: the live entry, then one entry per request, by day. */
  let {
    urls,
    me,
    requests,
    empty,
    titles,
    who,
    writing,
    now,
  }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();

  const actors = useActors(
    () => urls,
    () => me || null,
  );
  const entries = $derived.by(() => {
    const ids = new Set<string>();
    const out: Entry[] = [];
    for (const r of requests) {
      if (ids.has(r.request_id)) continue;
      ids.add(r.request_id);
      if (who === "people" && !byPerson(r)) continue;
      if (who === "agents" && byPerson(r)) continue;
      const e = toEntry(r, titles);
      if (e) out.push(e);
    }
    return out;
  });
  const live = $derived(writing && who !== "people" ? writing : null);
  const days = $derived.by(() => {
    const days = groupByDay(entries, now);
    // The live entry heads today's entries (a day of its own when nothing else happened today).
    if (live && days[0]?.label !== "Today") days.unshift({ label: "Today", items: [] });
    return days;
  });
;
async () => {

if(entries.length === 0 && !live){
   { svelteHTML.createElement("p", { "class":`view-empty`,});empty ? "Nothing has happened here yet." : "Nothing matches."; }
}
    for(let day of __sveltets_2_ensureArray(days)){let i = 1;day.label;
   { svelteHTML.createElement("section", {   "class":`activity-day`,"aria-label":day.label,});
     { svelteHTML.createElement("h2", { "class":`view-section-title`,});day.label; }
    if(i === 0 && live){
       { const $$_yrtnEeviL1C = __sveltets_2_ensureComponent(LiveEntry); new $$_yrtnEeviL1C({ target: __sveltets_2_any(), props: {        "write":live,urls,"actor":actors.view(live.actor, live.by),"title":titleOf(live.path, titles),}});}
    }
       for(let e of __sveltets_2_ensureArray(day.items)){e.id;
       { const $$_woRyrtnE1C = __sveltets_2_ensureComponent(EntryRow); new $$_woRyrtnE1C({ target: __sveltets_2_any(), props: {      "entry":e,urls,"actor":actors.view(e.actor, e.by),now,}});}
    }
   }
}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const Summary__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type Summary__SvelteComponent_ = ReturnType<typeof Summary__SvelteComponent_>;
/*Ωignore_endΩ*/export default Summary__SvelteComponent_;