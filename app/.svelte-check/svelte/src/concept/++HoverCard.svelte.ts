///<reference types="svelte" />
;
import Note from "../reader/Note.svelte";
import type { Card } from "./hover";

;type $$ComponentProps =  { card: Card };function $$render() {

  
  

  /** A card over the body, as `hover` described it (concept/hover.ts). */
  let { card }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
;
async () => {

if(card.kind === "note"){
   { svelteHTML.createElement("div", { "class":`small`,}); { const $$_etoN1C = __sveltets_2_ensureComponent(Note); new $$_etoN1C({ target: __sveltets_2_any(), props: {    "prepared":card.prepared,"nodes":card.nodes,}});} }
} else if (card.kind === "source"){
   { svelteHTML.createElement("div", {}); { svelteHTML.createElement("strong", {});card.title; }if(card.resource){ { svelteHTML.createElement("div", { "class":`small muted`,});card.resource; }}if(card.broken){ { svelteHTML.createElement("div", { "class":`small`,});  }}if(card.stale){ { svelteHTML.createElement("div", { "class":`small`,});  }} }
} else if (card.kind === "text"){
   { svelteHTML.createElement("div", { "class":`small`,});card.text; }
}else{
   { svelteHTML.createElement("div", {}); { svelteHTML.createElement("strong", {});card.title; }if(card.facts){ { svelteHTML.createElement("div", { "class":`small muted`,});card.facts; }}if(card.description){ { svelteHTML.createElement("div", { "class":`small`,});card.description; }} }
}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const HoverCard__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type HoverCard__SvelteComponent_ = ReturnType<typeof HoverCard__SvelteComponent_>;
/*Ωignore_endΩ*/export default HoverCard__SvelteComponent_;