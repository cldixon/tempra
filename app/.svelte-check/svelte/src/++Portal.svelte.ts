///<reference types="svelte" />
;
import { getAllContexts, mount, type Snippet, unmount } from "svelte";
import Render from "./Render.svelte";

;type $$ComponentProps =  { target: HTMLElement; children: Snippet };function $$render() {

  
  

  /**
   * Draws its content into another element (React's createPortal): the top bar's slots that a
   * page fills through PageBar. Mounted straight into `target`, with no wrapper, and with this
   * place's contexts.
   */
  let { target, children }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
  const context = getAllContexts();
  $effect(() => {
    const instance = mount(Render, { target, props: { children }, context });
    return () => void unmount(instance);
  });
;
async () => {
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const Portal__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type Portal__SvelteComponent_ = ReturnType<typeof Portal__SvelteComponent_>;
/*Ωignore_endΩ*/export default Portal__SvelteComponent_;