///<reference types="svelte" />
;
import { actorLabel, agentLabel } from "../agents";
import { useActors } from "../agents.svelte.ts";
import type { Urls, Who } from "../urls";

;type $$ComponentProps =  {
    urls: Urls;
    me: string;
    view: "summary" | "events";
    who: Who;
    actor: string;
    onChange(who: Who, actor: string): void;
  };function $$render() {

  
  
  

  /**
   * Who: Anyone, Agents or People, and in Every event each one who has worked here (one exact
   * actor, filtered by the server). A native select, so it works by keyboard and on a phone.
   */
  let {
    urls,
    me,
    view,
    who,
    actor,
    onChange,
  }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();

  const actors = useActors(
    () => urls,
    () => me || null,
  );
  const value = $derived(actor ? `actor:${actor}` : who);
  const people = $derived(view === "events" ? actors.contributors : []);

  function change(e: Event & { currentTarget: HTMLSelectElement }) {
    const v = e.currentTarget.value;
    if (v.startsWith("actor:")) onChange("everyone", v.slice("actor:".length));
    else onChange(v as Who, "");
  }
;
async () => {

 { svelteHTML.createElement("select", {      "class":`pill-select`,"aria-label":`Who`,value,"onchange":change,});
   { svelteHTML.createElement("option", { "value":`everyone`,});  }
   { svelteHTML.createElement("option", { "value":`agents`,});  }
   { svelteHTML.createElement("option", { "value":`people`,});  }
  if(people.length > 0){
     { svelteHTML.createElement("optgroup", { "label":`Who worked here`,});
         for(let c of __sveltets_2_ensureArray(people)){c.actor;
         { svelteHTML.createElement("option", { "value":`actor:${c.actor}`,});agentLabel(c); }
      }
     }
  }
  if(actor && !people.some((c) => c.actor === actor)){
     { svelteHTML.createElement("option", { "value":`actor:${actor}`,});actorLabel(actor, null, {}); }
  }
 }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const WhoFilter__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type WhoFilter__SvelteComponent_ = ReturnType<typeof WhoFilter__SvelteComponent_>;
/*Ωignore_endΩ*/export default WhoFilter__SvelteComponent_;