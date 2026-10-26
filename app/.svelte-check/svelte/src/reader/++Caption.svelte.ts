///<reference types="svelte" />
;
/** A figure's caption: its number, then its text when it has one. Not part of the text. */
import FromHosts from "./FromHosts.svelte";
import type { Figure } from "./prepare";

;type $$ComponentProps =  { figure: Figure; id?: string };function $$render() {

  
  
  

  let { figure, id }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
;
async () => {

 { svelteHTML.createElement("figcaption", {  ...__sveltets_2_empty({"data-skip":""}),id,}); { svelteHTML.createElement("span", { "class":`figure-number`,}); figure.n;  }if(figure.caption){` ${figure.caption}`;}if(figure.kind === "image"){ { const $$_stsoHmorF1C = __sveltets_2_ensureComponent(FromHosts); new $$_stsoHmorF1C({ target: __sveltets_2_any(), props: {   "figures":[figure],}});}} }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const Caption__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type Caption__SvelteComponent_ = ReturnType<typeof Caption__SvelteComponent_>;
/*Ωignore_endΩ*/export default Caption__SvelteComponent_;