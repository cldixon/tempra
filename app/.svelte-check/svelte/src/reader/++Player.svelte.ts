///<reference types="svelte" />
;
/**
   * A video or audio element for a source (TEMPRA-164; tempra-dev: app/media, How people see):
   * `<video controls preload="metadata">`, never autoplaying, its stored size and its poster when
   * known; `<audio controls>`. `onError` when it cannot be played.
   */
import type { ImageSource } from "../images";

;type $$ComponentProps =  { kind: "video" | "audio"; source: ImageSource; name: string; onError(): void };function $$render() {
  const fallback/*Ωignore_positionΩ*/ = ()/*Ωignore_startΩ*/: ReturnType<import('svelte').Snippet>/*Ωignore_endΩ*/ => { async ()/*Ωignore_positionΩ*/ => { { svelteHTML.createElement("a", {  "href":source.download ?? source.src,"download":"",});  }};return __sveltets_2_any(0)};
  
  

  let {
    kind,
    source,
    name,
    onError,
  }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
;
async () => {



if(kind === "video"){
  
   { svelteHTML.createElement("video", {               "controls":true,"preload":`metadata`,"src":source.src,"poster":source.poster,"width":source.width,"height":source.height,"aria-label":name,"onerror":() => onError(),});;__sveltets_2_ensureSnippet(fallback()); }
}else{
  
   { svelteHTML.createElement("audio", {         "controls":true,"preload":`metadata`,"src":source.src,"aria-label":name,"onerror":() => onError(),});;__sveltets_2_ensureSnippet(fallback()); }
}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const Player__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type Player__SvelteComponent_ = ReturnType<typeof Player__SvelteComponent_>;
/*Ωignore_endΩ*/export default Player__SvelteComponent_;