///<reference types="svelte" />
;
import Icon from "./Icon.svelte";
import LibraryTile from "./LibraryTile.svelte";
import Menu from "./Menu.svelte";
import { libraryLabel, type ReachableLibrary } from "./role";
import { useLibraries } from "./role.svelte.ts";
import { byKind } from "./sidebar";
import { Urls } from "./urls";

;type $$ComponentProps =  { urls: Urls; name: string };function $$render() {
 const row/*Ωignore_positionΩ*/ = (l: ReachableLibrary)/*Ωignore_startΩ*/: ReturnType<import('svelte').Snippet>/*Ωignore_endΩ*/ => { async ()/*Ωignore_positionΩ*/ => { { svelteHTML.createElement("a", {       "class":`menu-lib`,"href":new Urls(l.owner, l.slug).tree(""),"aria-current":here(l) ? "page" : undefined,}); { const $$_eliTyrarbiL1C = __sveltets_2_ensureComponent(LibraryTile); new $$_eliTyrarbiL1C({ target: __sveltets_2_any(), props: {    "name":l.title || l.slug,"shared":(l.role ?? "owner") !== "owner",}});} { svelteHTML.createElement("span", { });libraryLabel(l); }if((l.role ?? "owner") !== "owner"){ { svelteHTML.createElement("span", {  "class":`menu-lib-role`,});l.role === "write" ? "Write" : "Read"; }}if(here(l)){ { svelteHTML.createElement("span", { "class":`menu-lib-check`,}); { const $$_nocI2C = __sveltets_2_ensureComponent(Icon); new $$_nocI2C({ target: __sveltets_2_any(), props: {    "name":`check`,"size":14,}});} }} }};return __sveltets_2_any(0)};
  
  
  
  
  
  
  

  /**
   * The library switcher (take 4, board 07; TEMPRA-145): ⌄ beside the library's name in the bar;
   * its menu only switches: the person's libraries (Yours, then Shared with you with their role,
   * this one ticked), then All libraries and New library. The library's settings are the
   * sidebar's foot's.
   */
  let { urls, name }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
  const libs = useLibraries();
  const kinds = $derived(byKind(libs.data?.libraries ?? []));
  const here = (l: ReachableLibrary) => l.owner === urls.owner && l.slug === urls.slug;
;
async () => {


 { const $$_uneM0C = __sveltets_2_ensureComponent(Menu); const $$_uneM0 = new $$_uneM0C({ target: __sveltets_2_any(), props: {       children:() => { return __sveltets_2_any(0); },"name":`Switch library`,"title":`Switch from ${name}`,"buttonClass":`icon-button lib-switch`,"listClass":`libraries`,label:() => { async ()/*Ωignore_positionΩ*/ => { { const $$_nocI0C = __sveltets_2_ensureComponent(Icon); new $$_nocI0C({ target: __sveltets_2_any(), props: {    "name":`down`,"size":14,}});}};return __sveltets_2_any(0)},}});/*Ωignore_startΩ*/const {label} = $$_uneM0.$$prop_def;/*Ωignore_endΩ*/
  
  if(kinds.yours.length > 0){ { svelteHTML.createElement("div", { "class":`menu-note`,});  }}
     for(let l of __sveltets_2_ensureArray(kinds.yours)){`${l.owner}/${l.slug}`;;__sveltets_2_ensureSnippet(row(l));}
  if(kinds.shared.length > 0){ { svelteHTML.createElement("div", { "class":`menu-note`,});   }}
     for(let l of __sveltets_2_ensureArray(kinds.shared)){`${l.owner}/${l.slug}`;;__sveltets_2_ensureSnippet(row(l));}
   { svelteHTML.createElement("hr", {});}
   { svelteHTML.createElement("a", {   "class":`menu-item`,"href":`/`,}); { const $$_nocI2C = __sveltets_2_ensureComponent(Icon); new $$_nocI2C({ target: __sveltets_2_any(), props: {  "name":`libraries`,}});}  }
   { svelteHTML.createElement("a", {   "class":`menu-item`,"href":`/?new=1`,}); { const $$_nocI2C = __sveltets_2_ensureComponent(Icon); new $$_nocI2C({ target: __sveltets_2_any(), props: {  "name":`plus`,}});}  }
 Menu}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const LibrarySwitcher__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type LibrarySwitcher__SvelteComponent_ = ReturnType<typeof LibrarySwitcher__SvelteComponent_>;
/*Ωignore_endΩ*/export default LibrarySwitcher__SvelteComponent_;