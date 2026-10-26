///<reference types="svelte" />
;
import Icon from "./Icon.svelte";
import LibrarySwitcher from "./LibrarySwitcher.svelte";
import type { BrandLibrary } from "./Shell.svelte";
import { switcherKey } from "./ui";

;type $$ComponentProps =  { library?: BrandLibrary; onSearch?: () => void; short?: boolean };function $$render() {

  
  
  
  

  /**
   * Over the sidebar (and at the phone's drawer's head), as Linear's docs have it (TEMPRA-145): the
   * Tempra mark (to the library list), the library's name (to its home) with its switcher, and
   * search. Off a library, the mark and "Tempra". `short`: the phone's bar, the mark and the name.
   */
  let props:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
;
async () => {

 { svelteHTML.createElement("a", {       "class":`wordmark-tile brand-mark`,"href":`/`,"aria-label":`Tempra`,"title":`Tempra`,});  } { svelteHTML.createElement("span", {   "class":`brand-sep`,"aria-hidden":`true`,}); }if(props.library){ { svelteHTML.createElement("a", {      "class":`brand-name`,"href":props.library.urls.tree(""),"aria-current":props.library.home ? "page" : undefined,});props.library.name; }}else{ { svelteHTML.createElement("a", {   "class":`brand-name`,"href":`/`,});  }}if(props.library && !props.short){ { const $$_rehctiwSyrarbiL0C = __sveltets_2_ensureComponent(LibrarySwitcher); new $$_rehctiwSyrarbiL0C({ target: __sveltets_2_any(), props: {     "urls":props.library.urls,"name":props.library.name,}});}}if(props.onSearch && !props.short){ { svelteHTML.createElement("button", {            "type":`button`,"class":`icon-button search-button`,"aria-label":`Search`,"aria-keyshortcuts":`Control+K Meta+K`,"title":`Search (${switcherKey()})`,"onclick":props.onSearch,}); { const $$_nocI1C = __sveltets_2_ensureComponent(Icon); new $$_nocI1C({ target: __sveltets_2_any(), props: {  "name":`search`,}});} }}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const Brand__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type Brand__SvelteComponent_ = ReturnType<typeof Brand__SvelteComponent_>;
/*Ωignore_endΩ*/export default Brand__SvelteComponent_;