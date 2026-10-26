///<reference types="svelte" />
;
import { useTitleOf } from "../frame.svelte.ts";
import { useLibraryLabel } from "../role.svelte.ts";
import { useTitle } from "../ui.svelte.ts";
import type { Urls } from "../urls";
import OwnerOnly from "./OwnerOnly.svelte";
import RestorePage from "./RestorePage.svelte";

;type $$ComponentProps =  { urls: Urls; path: string; to?: number; actor: string };function $$render() {

  
  
  
  
  
  

  /** Writing back one page's earlier version, as a revert by the owner (owner only). */
  let props:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
  const titleOf = useTitleOf();
  const title = $derived(titleOf.of(props.path));
  const label = useLibraryLabel(() => props.urls);
  useTitle(() => `Restore ${title} · ${label.current}`);
;
async () => {

 { const $$_ylnOrenwO0C = __sveltets_2_ensureComponent(OwnerOnly); new $$_ylnOrenwO0C({ target: __sveltets_2_any(), props: { children:() => { return __sveltets_2_any(0); },"urls":props.urls,}});
   { const $$_egaPerotseR1C = __sveltets_2_ensureComponent(RestorePage); new $$_egaPerotseR1C({ target: __sveltets_2_any(), props: {       "urls":props.urls,"path":props.path,"to":props.to,title,}});}
 OwnerOnly}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const Restore__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type Restore__SvelteComponent_ = ReturnType<typeof Restore__SvelteComponent_>;
/*Ωignore_endΩ*/export default Restore__SvelteComponent_;