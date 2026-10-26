///<reference types="svelte" />
;
import { initials } from "./chrome";

;type $$ComponentProps =  { name: string; agent?: boolean };function $$render() {

  

  /**
   * Someone who acts in a library, as a small round mark with their initials: a person on a
   * light fill, an agent on ink (take 3). The name beside it is the caller's to draw.
   */
  let { name, agent = false }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
;
async () => {

 { svelteHTML.createElement("span", {    "class":agent ? "avatar-mark agent" : "avatar-mark","aria-hidden":`true`,});agent ? (name.trim()[0] ?? "?").toUpperCase() : initials(name); }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const Avatar__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type Avatar__SvelteComponent_ = ReturnType<typeof Avatar__SvelteComponent_>;
/*Ωignore_endΩ*/export default Avatar__SvelteComponent_;