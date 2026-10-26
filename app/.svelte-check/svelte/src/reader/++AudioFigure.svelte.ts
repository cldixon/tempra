///<reference types="svelte" />
;
/** An audio figure (TEMPRA-164), the registry's `media.audio`. */
import MediaFigure from "./MediaFigure.svelte";
import type { MediaProps } from "./registry";
function $$render() {

  
  
  

  let { figure }: MediaProps = $props();
;
async () => {

 { const $$_erugiFaideM0C = __sveltets_2_ensureComponent(MediaFigure); new $$_erugiFaideM0C({ target: __sveltets_2_any(), props: {   figure,"kind":`audio`,}});}
};
return { props: {} as any as MediaProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const AudioFigure__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type AudioFigure__SvelteComponent_ = ReturnType<typeof AudioFigure__SvelteComponent_>;
/*Ωignore_endΩ*/export default AudioFigure__SvelteComponent_;