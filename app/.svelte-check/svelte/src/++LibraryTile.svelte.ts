///<reference types="svelte" />
;
;type $$ComponentProps =  { name: string; shared?: boolean };function $$render() {

  /** A library's tile: its initial on a dark square (a lighter round one for a shared library). */
  let { name, shared = false }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
;
async () => {

 { svelteHTML.createElement("span", {   "class":shared ? "lib-tile shared" : "lib-tile","aria-hidden":`true`,});(name.trim()[0] ?? "?").toUpperCase(); }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const LibraryTile__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type LibraryTile__SvelteComponent_ = ReturnType<typeof LibraryTile__SvelteComponent_>;
/*Ωignore_endΩ*/export default LibraryTile__SvelteComponent_;