///<reference types="svelte" />
;
import type { Snippet } from "svelte";
import Icon from "./Icon.svelte";
import { modal } from "./modal";

;type $$ComponentProps =  {
    title: string;
    open: boolean;
    onClose(): void;
    wide?: boolean;
    children: Snippet;
  };function $$render() {

  
  
  

  /**
   * A small modal dialog in the top layer: a title, a close button, its content. Escape, the
   * close button or a click on the backdrop closes it, and the focus goes back where it was.
   */
  let props:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
  const titleId = $props.id();
;
async () => {



  { svelteHTML.createElement("dialog", {         [Symbol("@attach")]:modal(() => props.open),"class":props.wide ? "dialog wide" : "dialog","aria-labelledby":titleId,"onclose":() => props.onClose(),"onclick":(e) => {
    if (e.target === e.currentTarget) props.onClose();
  },});
  if(props.open){
     { svelteHTML.createElement("div", { "class":`dialog-box`,});
       { svelteHTML.createElement("div", { "class":`dialog-head`,});
         { svelteHTML.createElement("h2", { "id":titleId,});props.title; }
         { svelteHTML.createElement("button", {         "type":`button`,"class":`icon-button touch`,"aria-label":`Close`,"title":`Close`,"onclick":() => props.onClose(),});
           { const $$_nocI4C = __sveltets_2_ensureComponent(Icon); new $$_nocI4C({ target: __sveltets_2_any(), props: {  "name":`close`,}});}
         }
       }
       { svelteHTML.createElement("div", { "class":`dialog-body`,});;__sveltets_2_ensureSnippet(props.children()); }
     }
  }
 }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const Dialog__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type Dialog__SvelteComponent_ = ReturnType<typeof Dialog__SvelteComponent_>;
/*Ωignore_endΩ*/export default Dialog__SvelteComponent_;