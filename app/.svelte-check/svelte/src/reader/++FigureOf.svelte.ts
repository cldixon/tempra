///<reference types="svelte" />
;
/** A figure's image, or its video, audio or PDF through the registry (TEMPRA-164). */
import FigureImage from "./FigureImage.svelte";
import type { ImageFigure } from "./prepare";
import { media } from "./registry";

;type $$ComponentProps =  { figure: ImageFigure };function $$render() {

  
  
  
  

  let { figure }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
  const Media = $derived(figure.source?.kind ? media[figure.source.kind] : undefined);
;
async () => {

if(Media){ { const $$_aideM0C = __sveltets_2_ensureComponent(Media); new $$_aideM0C({ target: __sveltets_2_any(), props: { figure,}});}}else{ { const $$_egamIerugiF0C = __sveltets_2_ensureComponent(FigureImage); new $$_egamIerugiF0C({ target: __sveltets_2_any(), props: { figure,}});}}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const FigureOf__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type FigureOf__SvelteComponent_ = ReturnType<typeof FigureOf__SvelteComponent_>;
/*Ωignore_endΩ*/export default FigureOf__SvelteComponent_;