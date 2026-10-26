///<reference types="svelte" />
;
/** The quiet line under a caption naming where external images load from: "From example.com". */
import type { ImageFigure } from "./prepare";

;type $$ComponentProps =  { figures: ImageFigure[] };function $$render() {

  
  

  let { figures }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
  const hosts = $derived([...new Set(figures.map((f) => f.host).filter((h) => h !== null))]);
;
async () => {

if(hosts.length > 0){ { svelteHTML.createElement("span", { "class":`figure-source`,}); hosts.join(", "); }}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const FromHosts__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type FromHosts__SvelteComponent_ = ReturnType<typeof FromHosts__SvelteComponent_>;
/*Ωignore_endΩ*/export default FromHosts__SvelteComponent_;