///<reference types="svelte" />
;
import type { Tone } from "./ui";

;type $$ComponentProps =  { text: string; tone?: Tone; title?: string };function $$render() {

  

  let { text, tone = "", title }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
;
async () => {

 { svelteHTML.createElement("span", {  "class":tone ? `chip ${tone}` : "chip",title,});text; }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const Chip__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type Chip__SvelteComponent_ = ReturnType<typeof Chip__SvelteComponent_>;
/*Ωignore_endΩ*/export default Chip__SvelteComponent_;