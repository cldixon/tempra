///<reference types="svelte" />
;
/** A video figure (TEMPRA-164), the registry's `media.video`. */
import MediaFigure from "./MediaFigure.svelte";
import type { MediaProps } from "./registry";
function $$render() {

  
  
  

  let { figure }: MediaProps = $props();
;
async () => {

 { const $$_erugiFaideM0C = __sveltets_2_ensureComponent(MediaFigure); new $$_erugiFaideM0C({ target: __sveltets_2_any(), props: {   figure,"kind":`video`,}});}
};
return { props: {} as any as MediaProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const VideoFigure__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type VideoFigure__SvelteComponent_ = ReturnType<typeof VideoFigure__SvelteComponent_>;
/*Ωignore_endΩ*/export default VideoFigure__SvelteComponent_;