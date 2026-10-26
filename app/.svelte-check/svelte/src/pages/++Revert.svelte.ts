///<reference types="svelte" />
;
import { useLibraryLabel } from "../role.svelte.ts";
import { useTitle } from "../ui.svelte.ts";
import type { Urls } from "../urls";
import OwnerOnly from "./OwnerOnly.svelte";
import RevertPage from "./RevertPage.svelte";

;type $$ComponentProps =  { urls: Urls; request: string; actor: string };function $$render() {

  
  
  
  
  

  /** Undoing one change (a ledger request), as a new change by the owner (owner only). */
  let { urls, request }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
  const label = useLibraryLabel(() => urls);
  useTitle(() => `Revert · ${label.current}`);
;
async () => {

 { const $$_ylnOrenwO0C = __sveltets_2_ensureComponent(OwnerOnly); new $$_ylnOrenwO0C({ target: __sveltets_2_any(), props: {children:() => { return __sveltets_2_any(0); },urls,}});
   { const $$_egaPtreveR1C = __sveltets_2_ensureComponent(RevertPage); new $$_egaPtreveR1C({ target: __sveltets_2_any(), props: {  urls,request,}});}
 OwnerOnly}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const Revert__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type Revert__SvelteComponent_ = ReturnType<typeof Revert__SvelteComponent_>;
/*Ωignore_endΩ*/export default Revert__SvelteComponent_;