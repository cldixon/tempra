///<reference types="svelte" />
;
import type { Place } from "./frame";
import NavRow from "./NavRow.svelte";
import { useRole } from "./role.svelte.ts";
import { settingsTabs } from "./sidebar";
import type { Urls } from "./urls";

;type $$ComponentProps =  { urls: Urls; place: Place };function $$render() {

  
  
  
  
  

  /**
   * The settings' sidebar: back to the library (its name is already over the sidebar, so the row
   * does not say it again), then its tabs.
   */
  let { urls, place }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
  const role = useRole(() => urls);
  const tabs = $derived(settingsTabs(urls, role.current));
;
async () => {

 { svelteHTML.createElement("nav", {   "class":`nav`,"aria-label":`Library settings`,});
   { const $$_woRvaN1C = __sveltets_2_ensureComponent(NavRow); new $$_woRvaN1C({ target: __sveltets_2_any(), props: {        "href":urls.tree(""),"icon":`previous`,"label":`Back to library`,"className":`back`,}});}
     for(let t of __sveltets_2_ensureArray(tabs)){t.view;
     { const $$_woRvaN1C = __sveltets_2_ensureComponent(NavRow); new $$_woRvaN1C({ target: __sveltets_2_any(), props: {      "href":t.href,"current":place.view === t.view,"label":t.label,}});}
  }
 }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const SettingsSidebar__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type SettingsSidebar__SvelteComponent_ = ReturnType<typeof SettingsSidebar__SvelteComponent_>;
/*Ωignore_endΩ*/export default SettingsSidebar__SvelteComponent_;