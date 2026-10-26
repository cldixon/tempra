///<reference types="svelte" />
;
/**
   * Figures that are not images (TEMPRA-164; tempra-dev: app/media, How people see): the same
   * markdown as an image (`![A walkthrough](/x/demo.mp4 "Caption")`), drawn by what the attachment
   * is, through the reader's registry (registry.ts, `media`):
   *
   * - a video (MP4, WebM): Player.svelte, with an Enlarge button to play it in the full-screen view;
   * - audio (MP3, Ogg, WAV): Player.svelte;
   * - a PDF: a card (PdfCard.svelte) with its name, type and size, Open (its attachment page) and
   *   Download; no embedded viewer.
   *
   * Each is the paragraph's one atom, as an image is: one element marked `data-atom`, counting one
   * character in `docText`, so comment anchors and the diff are unchanged. One that fails to play
   * is the broken box, saying so.
   */
import Icon from "../Icon.svelte";
import { baseName } from "../urls";
import BrokenImage from "./BrokenImage.svelte";
import { useOpenFigure } from "./open-figure";
import Player from "./Player.svelte";
import type { ImageFigure } from "./prepare";

;type $$ComponentProps =  { figure: ImageFigure; kind: "video" | "audio" };function $$render() {

  
  
  
  
  
  
  

  let { figure, kind }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
  const open = useOpenFigure();
  let failed = $state<string | null>(null);
  /** What a media figure is called to a screen reader: its alt text, else its caption or name. */
  const name = $derived(
    figure.alt || figure.caption || (figure.path ? baseName(figure.path) : figure.url),
  );
  /** Clicks on a player's controls are not clicks on the text (no thread to open or close). */
  const own = (e: MouseEvent) => e.stopPropagation();
;
async () => {

if(figure.source === null || failed === figure.source.src){ { const $$_egamInekorB0C = __sveltets_2_ensureComponent(BrokenImage); new $$_egamInekorB0C({ target: __sveltets_2_any(), props: {   figure,"atom":true,}});}}else{const source = figure.source;
  
  
   { svelteHTML.createElement("span", {    "class":`figure-media figure-${kind}`,...__sveltets_2_empty({"data-atom":""}),"onclick":own,}); { const $$_reyalP1C = __sveltets_2_ensureComponent(Player); new $$_reyalP1C({ target: __sveltets_2_any(), props: {     kind,source,name,"onError":() => (failed = source.src),}});}if(open && kind === "video"){ { svelteHTML.createElement("span", {    "class":`figure-tools`,...__sveltets_2_empty({"data-skip":""}),}); { svelteHTML.createElement("button", {        "type":`button`,"class":`figure-enlarge`,"aria-label":`Enlarge video: ${name}`,"onclick":() => open(figure.n),}); { const $$_nocI3C = __sveltets_2_ensureComponent(Icon); new $$_nocI3C({ target: __sveltets_2_any(), props: {    "name":`enlarge`,"size":14,}});} } }} }}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const MediaFigure__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type MediaFigure__SvelteComponent_ = ReturnType<typeof MediaFigure__SvelteComponent_>;
/*Ωignore_endΩ*/export default MediaFigure__SvelteComponent_;