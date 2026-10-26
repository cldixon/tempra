///<reference types="svelte" />
;
import type { Snippet } from "svelte";
import Icon, { type Glyph } from "./Icon.svelte";
import LibraryTile from "./LibraryTile.svelte";

;type $$ComponentProps =  {
    href: string;
    current?: boolean;
    icon?: Glyph;
    tile?: { name: string; shared?: boolean };
    label: string;
    end?: Snippet;
    className?: string;
  };function $$render() {

  
  
  

  /** A row of the sidebar: a glyph (or a tile), a name, a count or a mark at the end. */
  let props:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
;
async () => {

 { svelteHTML.createElement("a", {       "class":props.className ? `nav-row ${props.className}` : "nav-row","href":props.href,"aria-current":props.current ? "page" : undefined,});if(props.icon){ { const $$_nocI1C = __sveltets_2_ensureComponent(Icon); new $$_nocI1C({ target: __sveltets_2_any(), props: {  "name":props.icon,}});}}if(props.tile){ { const $$_eliTyrarbiL1C = __sveltets_2_ensureComponent(LibraryTile); new $$_eliTyrarbiL1C({ target: __sveltets_2_any(), props: {     "name":props.tile.name,"shared":props.tile.shared,}});}} { svelteHTML.createElement("span", { "class":`nav-label`,});props.label; };__sveltets_2_ensureSnippet(props.end?.()); }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const NavRow__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type NavRow__SvelteComponent_ = ReturnType<typeof NavRow__SvelteComponent_>;
/*Ωignore_endΩ*/export default NavRow__SvelteComponent_;