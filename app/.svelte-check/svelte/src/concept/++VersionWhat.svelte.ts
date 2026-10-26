///<reference types="svelte" />
;
import { actorText } from "../agents";
import Moment from "../Moment.svelte";
import type { Namer } from "./byline";
import { actedBy, type Version } from "./data";

;type $$ComponentProps =  { version: Version; name: Namer; lead: string };function $$render() {

  
  
  
  

  /** "Changes in v3 · note · who · when". */
  let { version, name, lead }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
  const by = $derived(name(version.event.actor, actedBy(version.event)));
  const note = $derived(typeof version.event.meta?.note === "string" ? version.event.meta.note : "");
;
async () => {

 { svelteHTML.createElement("strong", { "class":`review-lead`,});lead; }if(note){ { svelteHTML.createElement("span", { "class":`review-note`,});` · ${note}`; }} { svelteHTML.createElement("span", { "class":`muted`,});` · ${actorText(by)} · `; { const $$_tnemoM1C = __sveltets_2_ensureComponent(Moment); new $$_tnemoM1C({ target: __sveltets_2_any(), props: {  "ts":version.event.ts,}});} }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const VersionWhat__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type VersionWhat__SvelteComponent_ = ReturnType<typeof VersionWhat__SvelteComponent_>;
/*Ωignore_endΩ*/export default VersionWhat__SvelteComponent_;