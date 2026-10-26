///<reference types="svelte" />
;
/**
   * An image in the full-screen view, as large as fits; the broken box once it fails. A video
   * plays here, audio too; a PDF is its card, Open going to its page (TEMPRA-164).
   */
import { LIGHTBOX_SIZES } from "../images";
import BrokenImage from "./BrokenImage.svelte";
import Img from "./Img.svelte";
import PdfCard from "./PdfCard.svelte";
import Player from "./Player.svelte";
import type { ImageFigure } from "./prepare";

;type $$ComponentProps =  { figure: ImageFigure };function $$render() {

  
  
  
  
  
  
  

  let { figure }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
  let failed = $state<string | null>(null);
;
async () => {

if(figure.source === null || failed === figure.source.src){
   { const $$_egamInekorB0C = __sveltets_2_ensureComponent(BrokenImage); new $$_egamInekorB0C({ target: __sveltets_2_any(), props: { figure,}});}
} else if (figure.source.kind === "pdf"){
   { const $$_draCfdP0C = __sveltets_2_ensureComponent(PdfCard); new $$_draCfdP0C({ target: __sveltets_2_any(), props: { figure,}});}
} else if (figure.source.kind === "video" || figure.source.kind === "audio"){
  const source = figure.source;
   { const $$_reyalP0C = __sveltets_2_ensureComponent(Player); new $$_reyalP0C({ target: __sveltets_2_any(), props: {        "kind":figure.source.kind,source,"name":figure.alt || figure.caption || figure.url,"onError":() => (failed = source.src),}});}
}else{
  const source = figure.source;
   { const $$_gmI0C = __sveltets_2_ensureComponent(Img); new $$_gmI0C({ target: __sveltets_2_any(), props: {          source,"alt":figure.alt,"sizes":LIGHTBOX_SIZES,"lazy":false,"onError":() => (failed = source.src),}});}
}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const ImageStage__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type ImageStage__SvelteComponent_ = ReturnType<typeof ImageStage__SvelteComponent_>;
/*Ωignore_endΩ*/export default ImageStage__SvelteComponent_;