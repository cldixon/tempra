///<reference types="svelte" />
;
import { useLibraryLabel } from "../role.svelte.ts";
import { useTitle } from "../ui.svelte.ts";
import type { Urls } from "../urls";
import OwnerOnly from "./OwnerOnly.svelte";
import TransferPage from "./TransferPage.svelte";

;type $$ComponentProps =  { urls: Urls };function $$render() {

  
  
  
  
  

  /** Export a bundle, import one as a single change, and the nightly exports (owner only). */
  let { urls }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
  const label = useLibraryLabel(() => urls);
  useTitle(() => `Import & export · ${label.current}`);
;
async () => {

 { const $$_ylnOrenwO0C = __sveltets_2_ensureComponent(OwnerOnly); new $$_ylnOrenwO0C({ target: __sveltets_2_any(), props: {children:() => { return __sveltets_2_any(0); },urls,}});
   { const $$_egaPrefsnarT1C = __sveltets_2_ensureComponent(TransferPage); new $$_egaPrefsnarT1C({ target: __sveltets_2_any(), props: { urls,}});}
 OwnerOnly}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const Transfer__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type Transfer__SvelteComponent_ = ReturnType<typeof Transfer__SvelteComponent_>;
/*Ωignore_endΩ*/export default Transfer__SvelteComponent_;