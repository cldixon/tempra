///<reference types="svelte" />
;
import { THEMES, type Theme } from "./theme.svelte.ts";

;type $$ComponentProps =  { value: Theme; onChange(theme: Theme): void };function $$render() {

  

  /** System, Light, Dark as one segmented control (the avatar's menu, the Account page). */
  let { value, onChange }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
;
async () => {

 { svelteHTML.createElement("fieldset", { "class":`segmented`,});
   { svelteHTML.createElement("legend", { "class":`visually-hidden`,});  }
     for(let [key, label] of __sveltets_2_ensureArray(THEMES)){key;
     { svelteHTML.createElement("button", {     "type":`button`,"aria-pressed":value === key,...__sveltets_2_empty({"data-stay":true}),"onclick":() => onChange(key),});label; }
  }
 }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const ThemeChoice__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type ThemeChoice__SvelteComponent_ = ReturnType<typeof ThemeChoice__SvelteComponent_>;
/*Ωignore_endΩ*/export default ThemeChoice__SvelteComponent_;