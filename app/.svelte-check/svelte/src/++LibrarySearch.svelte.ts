///<reference types="svelte" />
;
import QuickSearch from "./QuickSearch.svelte";
import { useLibraries } from "./role.svelte.ts";
import { libraryOptions } from "./switcher";

;type $$ComponentProps =  { open: boolean; onClose(): void };function $$render() {

  
  
  

  /**
   * Search off a library (the account's pages, TEMPRA-127): the person's libraries by title or
   * owner/slug, from the list the app already has; Enter opens the library's home.
   */
  let props:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
  const libs = useLibraries();
  let q = $state("");
  $effect(() => {
    if (props.open) q = "";
  });
  const options = $derived(libraryOptions(libs.data?.libraries ?? [], q.trim().toLowerCase()));
;
async () => {

 { const $$_hcraeSkciuQ0C = __sveltets_2_ensureComponent(QuickSearch); new $$_hcraeSkciuQ0C({ target: __sveltets_2_any(), props: {             "open":props.open,"onClose":props.onClose,"label":`Search libraries`,q,"onQuery":(v) => (q = v),options,"empty":libs.state !== "ready" ? "Loading libraries…" : "No library matches.",}});}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const LibrarySearch__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type LibrarySearch__SvelteComponent_ = ReturnType<typeof LibrarySearch__SvelteComponent_>;
/*Ωignore_endΩ*/export default LibrarySearch__SvelteComponent_;