///<reference types="svelte" />
;
/** An image in running text: stays inline, with no caption; its alt text if it fails to load. */
import { figureSizes, type ImageSource } from "../images";
import Img from "./Img.svelte";

;type $$ComponentProps =  { source: ImageSource; alt: string; title: string | null; host?: string | null };function $$render() {

  
  
  

  let {
    source,
    alt,
    title,
    host,
  }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
  let failed = $state<string | null>(null);
  const from = $derived(host ? `From ${host}` : null);
  const named = $derived(title?.trim() || null);
;
async () => {

if(failed === source.src){ { svelteHTML.createElement("span", {      "class":`image-broken`,...__sveltets_2_empty({"data-atom":""}),"title":host ? `This external image from ${host} can't be shown` : "This image can't be shown",});alt || "image"; }}else{ { const $$_gmI0C = __sveltets_2_ensureComponent(Img); new $$_gmI0C({ target: __sveltets_2_any(), props: {          "atom":true,source,alt,"title":named && from ? `${named} (${from.toLowerCase()})` : (named ?? from ?? undefined),"sizes":figureSizes(null),"onError":() => (failed = source.src),}});}}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const InlineImage__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type InlineImage__SvelteComponent_ = ReturnType<typeof InlineImage__SvelteComponent_>;
/*Ωignore_endΩ*/export default InlineImage__SvelteComponent_;