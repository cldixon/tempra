///<reference types="svelte" />
;
/**
   * A figure's image (tempra-dev: app/reader, Figures): a button opening the full-screen view
   * (Lightbox.svelte), or the broken box once it fails.
   *
   * The image is the paragraph's one atom: whatever is drawn for it (a button, the image, the box)
   * is one element marked `data-atom`, so it counts one character as `docText` does. The caption
   * sits outside the paragraph's `data-text` element and is marked `data-skip`: it is not the
   * document's text, so selections, comment anchors and the diff never count it.
   *
   * Figure markup (`:::figure`, tempra-dev: app/media) draws one to four images in one figure
   * (FigureBox): each image still one atom and one figure in the numbering, a group's images side
   * by side with their titles as small labels (`data-skip`), and one caption, the directive's
   * label.
   *
   * An external image (hotlinked from another site, TEMPRA-163; tempra-dev: app/media) is drawn
   * as any other, with a quiet line under its caption naming the site ("From example.com"); its
   * broken box says it is external, and an inline one names the site in its tooltip.
   */
import { figureSizes, type ImageSource } from "../images";
import BrokenImage from "./BrokenImage.svelte";
import { enlargeName } from "./figure";
import Img from "./Img.svelte";
import { useOpenFigure } from "./open-figure";
import type { ImageFigure } from "./prepare";

;type $$ComponentProps =  { figure: ImageFigure };function $$render() {
 const img/*Ωignore_positionΩ*/ = (source: ImageSource)/*Ωignore_startΩ*/: ReturnType<import('svelte').Snippet>/*Ωignore_endΩ*/ => { async ()/*Ωignore_positionΩ*/ => { { const $$_gmI0C = __sveltets_2_ensureComponent(Img); new $$_gmI0C({ target: __sveltets_2_any(), props: {        source,"alt":figure.alt,"sizes":figureSizes(figure.markup?.spec ?? null, figure.markup?.figures.length ?? 1),"onError":() => (failed = source.src),}});}};return __sveltets_2_any(0)};
  
  
  
  
  
  
  

  let { figure }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
  const open = useOpenFigure();
  let failed = $state<string | null>(null);
;
async () => {



if(figure.source === null || failed === figure.source.src){ { const $$_egamInekorB0C = __sveltets_2_ensureComponent(BrokenImage); new $$_egamInekorB0C({ target: __sveltets_2_any(), props: {   figure,"atom":true,}});}}else{ { svelteHTML.createElement("span", {   "class":`figure-media`,...__sveltets_2_empty({"data-atom":""}),});if(open){ { svelteHTML.createElement("button", {        "type":`button`,"class":`figure-open`,"aria-label":enlargeName(figure),"onclick":(e) => {
          // Opening a figure is not a click on the text (no thread to open or close).
          e.stopPropagation();
          open(figure.n);
        },});;__sveltets_2_ensureSnippet(img(figure.source)); }}else{;__sveltets_2_ensureSnippet(img(figure.source));} }}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const FigureImage__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type FigureImage__SvelteComponent_ = ReturnType<typeof FigureImage__SvelteComponent_>;
/*Ωignore_endΩ*/export default FigureImage__SvelteComponent_;