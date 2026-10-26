///<reference types="svelte" />
;
/** What an image can't show: the box that keeps its place, saying why, its path and alt text. */
import Icon from "../Icon.svelte";
import type { ImageFigure } from "./prepare";

;type $$ComponentProps =  { figure: ImageFigure; atom?: boolean };function $$render() {

  
  
  

  let { figure, atom }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
  const where = $derived(figure.path ?? figure.url);
  const kind = $derived(figure.source?.kind);
  // A video or audio file that does not play says so (TEMPRA-164); anything else is an image.
  const playable = $derived(kind === "video" || kind === "audio");
  const what = $derived(
    playable
      ? `This ${kind}`
      : figure.host
        ? `This external image from ${figure.host}`
        : "This image",
  );
  const verb = $derived(playable ? "can't be played" : "can't be shown");
;
async () => {

 { svelteHTML.createElement("span", {         "class":`figure-broken`,...__sveltets_2_empty({"data-atom":atom ? "" : undefined}),"role":`img`,"aria-label":`${what} ${verb}: ${figure.alt || where}`,}); { const $$_nocI1C = __sveltets_2_ensureComponent(Icon); new $$_nocI1C({ target: __sveltets_2_any(), props: {    "name":playable ? (kind as "video" | "audio") : "broken","size":20,}});} { svelteHTML.createElement("span", {  "class":`figure-broken-title`,});playable ? `This ${kind} ${verb}` : "This image can't be shown"; }if(figure.host){ { svelteHTML.createElement("span", {});    figure.host; }} { svelteHTML.createElement("span", {});where; }if(figure.alt){ { svelteHTML.createElement("span", {});  figure.alt;  }} }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const BrokenImage__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type BrokenImage__SvelteComponent_ = ReturnType<typeof BrokenImage__SvelteComponent_>;
/*Ωignore_endΩ*/export default BrokenImage__SvelteComponent_;