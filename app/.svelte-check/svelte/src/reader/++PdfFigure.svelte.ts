///<reference types="svelte" />
;
/** A PDF figure (TEMPRA-164), the registry's `media.pdf`: its card, as the paragraph's atom. */
import PdfCard from "./PdfCard.svelte";
import type { MediaProps } from "./registry";
function $$render() {

  
  
  

  let { figure }: MediaProps = $props();
  /** Clicks on the card are not clicks on the text (no thread to open or close). */
  const own = (e: MouseEvent) => e.stopPropagation();
;
async () => {



 { svelteHTML.createElement("span", {   "class":`figure-media`,...__sveltets_2_empty({"data-atom":""}),"onclick":own,}); { const $$_draCfdP1C = __sveltets_2_ensureComponent(PdfCard); new $$_draCfdP1C({ target: __sveltets_2_any(), props: { figure,}});} }
};
return { props: {} as any as MediaProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const PdfFigure__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type PdfFigure__SvelteComponent_ = ReturnType<typeof PdfFigure__SvelteComponent_>;
/*Ωignore_endΩ*/export default PdfFigure__SvelteComponent_;