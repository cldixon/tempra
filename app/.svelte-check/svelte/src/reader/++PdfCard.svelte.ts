///<reference types="svelte" />
;
/** A PDF's card: its name, type and size, Open and Download. Also the full-screen view's. */
import Icon from "../Icon.svelte";
import { formatSize } from "../ui";
import { baseName } from "../urls";
import BrokenImage from "./BrokenImage.svelte";
import type { ImageFigure } from "./prepare";

;type $$ComponentProps =  { figure: ImageFigure; atom?: boolean };function $$render() {

  
  
  
  
  
  

  let { figure, atom }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
  const name = $derived(figure.path ? baseName(figure.path) : figure.url);
;
async () => {

if(figure.source === null){ { const $$_egamInekorB0C = __sveltets_2_ensureComponent(BrokenImage); new $$_egamInekorB0C({ target: __sveltets_2_any(), props: {  figure,atom,}});}}else{const source = figure.source;
   { svelteHTML.createElement("span", {    "class":`figure-pdf`,...__sveltets_2_empty({"data-atom":atom ? "" : undefined}),}); { const $$_nocI1C = __sveltets_2_ensureComponent(Icon); new $$_nocI1C({ target: __sveltets_2_any(), props: {    "name":`file`,"size":24,}});} { svelteHTML.createElement("span", {  "class":`figure-pdf-about`,}); { svelteHTML.createElement("span", { "class":`figure-pdf-name`,});name; } { svelteHTML.createElement("span", {  "class":`figure-pdf-meta`,}); source.size !== undefined ? ` · ${formatSize(source.size)}` : ""; } } { svelteHTML.createElement("span", {  "class":`figure-pdf-actions`,});if(source.page){ { svelteHTML.createElement("a", {   "class":`button`,"href":source.page,});  }} { svelteHTML.createElement("a", {      "class":`button`,"href":source.download ?? source.src,"download":name,}); { const $$_nocI3C = __sveltets_2_ensureComponent(Icon); new $$_nocI3C({ target: __sveltets_2_any(), props: {  "name":`download`,}});}  } } }}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const PdfCard__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type PdfCard__SvelteComponent_ = ReturnType<typeof PdfCard__SvelteComponent_>;
/*Ωignore_endΩ*/export default PdfCard__SvelteComponent_;