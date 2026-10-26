///<reference types="svelte" />
;
import type { Snippet } from "svelte";

;type $$ComponentProps =  { children: Snippet };function $$render() {

  

  let { children }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
;
async () => {

;__sveltets_2_ensureSnippet(children());
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const Render__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type Render__SvelteComponent_ = ReturnType<typeof Render__SvelteComponent_>;
/*Ωignore_endΩ*/export default Render__SvelteComponent_;