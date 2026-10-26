///<reference types="svelte" />
;
import type { Snippet } from "svelte";

;type $$ComponentProps =  { children: Snippet; wide?: boolean };function $$render() {

  

  /** A page's column in the frame (everything but a concept, which lays out its own columns). */
  let { children, wide = false }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
;
async () => {

 { svelteHTML.createElement("div", { "class":wide ? "page-column wide" : "page-column",});;__sveltets_2_ensureSnippet(children()); }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const PageColumn__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type PageColumn__SvelteComponent_ = ReturnType<typeof PageColumn__SvelteComponent_>;
/*Ωignore_endΩ*/export default PageColumn__SvelteComponent_;