///<reference types="svelte" />
;
/** A diagram in the full-screen view, drawn again at the view's size; its source if it fails. */
import { drawDiagram } from "./diagram";
import type { DiagramFigure } from "./prepare";

;type $$ComponentProps =  { figure: DiagramFigure };function $$render() {

  
  
  

  let { figure }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
  let failed = $state<string | null>(null);
  const fail = (source: string) => {
    failed = source;
  };
;
async () => {

if(failed === figure.source){
   { svelteHTML.createElement("pre", { "class":`lightbox-source`,}); { svelteHTML.createElement("code", {});figure.source; } }
}else{
   { svelteHTML.createElement("div", {        "class":`lightbox-diagram`,"role":`img`,"aria-label":`Diagram`,[Symbol("@attach")]:drawDiagram(figure.source, `lb${figure.n}-`, fail),}); }
}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const DiagramStage__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type DiagramStage__SvelteComponent_ = ReturnType<typeof DiagramStage__SvelteComponent_>;
/*Ωignore_endΩ*/export default DiagramStage__SvelteComponent_;