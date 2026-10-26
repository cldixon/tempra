///<reference types="svelte" />
;
import Icon from "./Icon.svelte";
import { useCopy } from "./ui.svelte.ts";

;type $$ComponentProps =  { value: string; label: string; id?: string };function $$render() {

  
  

  /** A value to copy (the MCP URL, a token's secret): the text in mono, a Copy button at its end. */
  let { value, label, id }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
  const copied = useCopy();
;
async () => {

 { svelteHTML.createElement("span", { "class":`copy-field`,});
   { svelteHTML.createElement("code", {id,});value; }
   { svelteHTML.createElement("button", {           "type":`button`,"class":`icon-button`,"aria-label":`Copy ${label}`,"title":copied.state === "copied" ? "Copied" : "Copy","onclick":() => void copied.copy(value),});
     { const $$_nocI2C = __sveltets_2_ensureComponent(Icon); new $$_nocI2C({ target: __sveltets_2_any(), props: {  "name":copied.state === "copied" ? "check" : "copy",}});}
   }
 }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const CopyField__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type CopyField__SvelteComponent_ = ReturnType<typeof CopyField__SvelteComponent_>;
/*Ωignore_endΩ*/export default CopyField__SvelteComponent_;