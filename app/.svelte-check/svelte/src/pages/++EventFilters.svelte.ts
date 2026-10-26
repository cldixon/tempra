///<reference types="svelte" />
;
import { untrack } from "svelte";
import { KINDS } from "../activity";
import Icon from "../Icon.svelte";

;type $$ComponentProps =  { kind: string; q: string; onChange(change: { kind?: string; q?: string }): void };function $$render() {

  
  
  

  /** Every event's own filters: the kind, and text to find in the path or the note. */
  let {
    kind,
    q,
    onChange,
  }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ =
    $props();

  let text = $state(untrack(() => q));
  // The URL's text wins when it changes (back and forward, a link).
  $effect.pre(() => {
    text = q;
  });
  // The text goes to the URL a moment after typing stops, or at once on Enter.
  $effect(() => {
    const t = text.trim();
    if (t === q) return;
    const timer = setTimeout(() => onChange({ q: t || undefined }), 300);
    return () => clearTimeout(timer);
  });

  function submit(e: SubmitEvent) {
    e.preventDefault();
    onChange({ q: text.trim() || undefined });
  }
;
async () => {

  { svelteHTML.createElement("select", {        "class":`pill-select`,"aria-label":`Kind`,"value":kind,"onchange":(e) => onChange({ kind: e.currentTarget.value || undefined }),});
   { svelteHTML.createElement("option", {"value":"",});  }
     for(let k of __sveltets_2_ensureArray(KINDS)){k;
     { svelteHTML.createElement("option", { "value":k,});k; }
  }
 }
 { svelteHTML.createElement("form", {   "class":`activity-find`,"onsubmit":submit,});
   { const $$_nocI1C = __sveltets_2_ensureComponent(Icon); new $$_nocI1C({ target: __sveltets_2_any(), props: {  "name":`search`,}});}
   { svelteHTML.createElement("input", {         "type":`search`,"aria-label":`Filter by path or note`,"placeholder":`Filter by path or note`,"bind:value":text,});/*Ωignore_startΩ*/() => text = __sveltets_2_any(null);/*Ωignore_endΩ*/}
 }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const EventFilters__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type EventFilters__SvelteComponent_ = ReturnType<typeof EventFilters__SvelteComponent_>;
/*Ωignore_endΩ*/export default EventFilters__SvelteComponent_;