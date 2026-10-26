///<reference types="svelte" />
;
import type { Snippet } from "svelte";
import Icon from "./Icon.svelte";
import { modal } from "./modal";

;type $$ComponentProps =  {
    open: boolean;
    onClose(): void;
    /** Where the new thing goes, shown as a chip before the title. */
    context: Snippet;
    title: string;
    action: string;
    busy?: boolean;
    error?: string | null;
    onSubmit(e: SubmitEvent & { currentTarget: HTMLFormElement }): void;
    /** The row under the main fields: small labelled fields (`.compose-field`). */
    fields?: Snippet;
    children: Snippet;
  };function $$render() {

  
  
  

  /**
   * A dialog that makes something (a new library): anchored high over the page, its context and
   * what it makes at the top ("@ann › New library"), then the form's own fields (a large
   * borderless name, a description; `.compose-title`, `.compose-text`), a row of smaller
   * fields, and the action at the foot. Ctrl/Cmd+Enter submits; Escape, × or a click beside it
   * cancels.
   */
  let props:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
  const titleId = $props.id();
;
async () => {


  { svelteHTML.createElement("dialog", {         [Symbol("@attach")]:modal(() => props.open),"class":`dialog compose`,"aria-labelledby":titleId,"onclose":() => props.onClose(),"onclick":(e) => {
    if (e.target === e.currentTarget) props.onClose();
  },});
  if(props.open){
     { svelteHTML.createElement("form", {       "class":`compose-form`,"onsubmit":(e) => props.onSubmit(e),"onkeydown":(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          e.currentTarget.requestSubmit();
        }
      },});
       { svelteHTML.createElement("div", { "class":`compose-head`,});
         { svelteHTML.createElement("span", { "class":`compose-context`,});;__sveltets_2_ensureSnippet(props.context()); }
         { const $$_nocI3C = __sveltets_2_ensureComponent(Icon); new $$_nocI3C({ target: __sveltets_2_any(), props: {  "name":`chevron`,}});}
         { svelteHTML.createElement("h2", { "id":titleId,});props.title; }
         { svelteHTML.createElement("button", {         "type":`button`,"class":`icon-button touch`,"aria-label":`Close`,"title":`Close`,"onclick":() => props.onClose(),});
           { const $$_nocI4C = __sveltets_2_ensureComponent(Icon); new $$_nocI4C({ target: __sveltets_2_any(), props: {  "name":`close`,}});}
         }
       }
       { svelteHTML.createElement("div", { "class":`compose-body`,});;__sveltets_2_ensureSnippet(props.children()); }
      if(props.fields){ { svelteHTML.createElement("div", { "class":`compose-fields`,});;__sveltets_2_ensureSnippet(props.fields()); }}
      if(props.error){ { svelteHTML.createElement("p", {   "class":`notice`,"role":`alert`,});props.error; }}
       { svelteHTML.createElement("div", { "class":`compose-foot`,});
         { svelteHTML.createElement("button", {     "type":`button`,"class":`ghost`,"onclick":() => props.onClose(),});  }
         { svelteHTML.createElement("button", {     "type":`submit`,"class":`primary`,"disabled":props.busy,});props.action; }
       }
     }
  }
 }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const ComposeDialog__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type ComposeDialog__SvelteComponent_ = ReturnType<typeof ComposeDialog__SvelteComponent_>;
/*Ωignore_endΩ*/export default ComposeDialog__SvelteComponent_;