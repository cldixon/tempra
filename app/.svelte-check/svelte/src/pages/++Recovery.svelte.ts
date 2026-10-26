///<reference types="svelte" />
;
import { useLibraryLabel } from "../role.svelte.ts";
import { useTitle } from "../ui.svelte.ts";
import type { Urls } from "../urls";
import OwnerOnly from "./OwnerOnly.svelte";
import RecoveryPage from "./RecoveryPage.svelte";

;type $$ComponentProps =  { urls: Urls };function $$render() {

  
  
  
  
  

  /** Point-in-time restore of the whole library, and undoing one (owner only). */
  let { urls }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
  const label = useLibraryLabel(() => urls);
  useTitle(() => `Recovery · ${label.current}`);
;
async () => {

 { const $$_ylnOrenwO0C = __sveltets_2_ensureComponent(OwnerOnly); new $$_ylnOrenwO0C({ target: __sveltets_2_any(), props: {children:() => { return __sveltets_2_any(0); },urls,}});
   { const $$_egaPyrevoceR1C = __sveltets_2_ensureComponent(RecoveryPage); new $$_egaPyrevoceR1C({ target: __sveltets_2_any(), props: { urls,}});}
 OwnerOnly}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const Recovery__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type Recovery__SvelteComponent_ = ReturnType<typeof Recovery__SvelteComponent_>;
/*Ωignore_endΩ*/export default Recovery__SvelteComponent_;