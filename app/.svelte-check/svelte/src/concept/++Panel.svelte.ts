///<reference types="svelte" />
;
import type { Snippet } from "svelte";
import Icon from "../Icon.svelte";
import { DRAG_TO_CLOSE, PANEL_TITLES, type PanelName } from "./panel";

;type $$ComponentProps =  {
    name: PanelName;
    count?: string | null;
    onClose(): void;
    children: Snippet;
  };function $$render() {

  
  
  

  /**
   * A panel's frame: its title, a count where it has one, and ×. On a narrow page it overlays the
   * page, and on a phone it is a sheet from the bottom with a drag handle, the page dimmed behind
   * it (the stylesheet's call; take 4, board 35).
   */
  let props:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
  const title = $derived(PANEL_TITLES[props.name]);
  // On a phone the sheet's head is a handle too: dragged down far enough, the sheet closes.
  let drag: { id: number; y: number } | null = null;
;
async () => {

 { svelteHTML.createElement("aside", {      "class":`concept-panel panel-${props.name}`,"aria-label":title,"id":`panel-${props.name}`,}); { svelteHTML.createElement("header", {         "class":`panel-head`,"onpointerdown":(e) => {
      if (e.pointerType === "mouse" || (e.target as Element).closest("button")) return;
      drag = { id: e.pointerId, y: e.clientY };
    },"onpointerup":(e) => {
      const from = drag;
      drag = null;
      if (from && from.id === e.pointerId && e.clientY - from.y > DRAG_TO_CLOSE) props.onClose();
    },"onpointercancel":() => {
      drag = null;
    },}); { svelteHTML.createElement("span", {   "class":`panel-grip`,"aria-hidden":`true`,}); } { svelteHTML.createElement("h2", { "tabindex":-1,});title; }if(props.count){ { svelteHTML.createElement("span", { "class":`count`,});props.count; }} { svelteHTML.createElement("button", {          "type":`button`,"class":`icon-button touch`,"aria-label":`Close ${title.toLowerCase()}`,"title":`Close`,"onclick":() => props.onClose(),}); { const $$_nocI3C = __sveltets_2_ensureComponent(Icon); new $$_nocI3C({ target: __sveltets_2_any(), props: {  "name":`close`,}});} } } { svelteHTML.createElement("div", { "class":`panel-body`,});;__sveltets_2_ensureSnippet(props.children()); } }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const Panel__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type Panel__SvelteComponent_ = ReturnType<typeof Panel__SvelteComponent_>;
/*Ωignore_endΩ*/export default Panel__SvelteComponent_;