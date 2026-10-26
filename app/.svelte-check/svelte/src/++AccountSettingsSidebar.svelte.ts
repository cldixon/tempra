///<reference types="svelte" />
;
import type { AccountPage } from "./frame";
import NavRow from "./NavRow.svelte";
import { ACCOUNT_SETTINGS } from "./sidebar";

;type $$ComponentProps =  { page: AccountPage };function $$render() {

  
  
  

  /** The account settings' sidebar: back to the libraries, then each page. */
  let { page }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
;
async () => {

 { svelteHTML.createElement("nav", {   "class":`nav`,"aria-label":`Settings`,});
   { const $$_woRvaN1C = __sveltets_2_ensureComponent(NavRow); new $$_woRvaN1C({ target: __sveltets_2_any(), props: {        "href":`/`,"icon":`previous`,"label":`Back to libraries`,"className":`back`,}});}
     for(let [key, href, label] of __sveltets_2_ensureArray(ACCOUNT_SETTINGS)){key;
     { const $$_woRvaN1C = __sveltets_2_ensureComponent(NavRow); new $$_woRvaN1C({ target: __sveltets_2_any(), props: {    href,"current":page === key,label,}});}
  }
 }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const AccountSettingsSidebar__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type AccountSettingsSidebar__SvelteComponent_ = ReturnType<typeof AccountSettingsSidebar__SvelteComponent_>;
/*Ωignore_endΩ*/export default AccountSettingsSidebar__SvelteComponent_;