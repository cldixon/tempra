///<reference types="svelte" />
;
/**
   * A popover in the top layer, placed above `rect` (below it when there is no room), kept inside
   * the viewport. Only its coordinates are set here, as custom properties the stylesheet reads,
   * through the CSSOM (CSP: no style attribute is written).
   */
import type { Snippet } from "svelte";

;type $$ComponentProps =  {
    rect: DOMRect;
    class: string;
    id?: string;
    role?: string;
    children: Snippet;
    onpointerenter?(): void;
    onpointerleave?(): void;
  };function $$render() {

  
  

  let {
    rect,
    class: className,
    id,
    role,
    children,
    onpointerenter,
    onpointerleave,
  }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
  let el: HTMLDivElement | undefined = $state();
  $effect(() => {
    const r = rect;
    if (!el) return;
    if (typeof el.showPopover === "function" && !el.matches(":popover-open")) el.showPopover();
    const gap = 8;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const x = Math.max(gap, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - gap));
    const above = r.top - h - gap;
    const y = above >= gap ? above : r.bottom + gap;
    el.style.setProperty("--float-x", `${Math.round(x)}px`);
    el.style.setProperty("--float-y", `${Math.round(y)}px`);
  });
;
async () => {

  { const $$_div0 = svelteHTML.createElement("div", {           "popover":`manual`,id,role,"class":`floating ${className}`,"onpointerenter":() => onpointerenter?.(),"onpointerleave":() => onpointerleave?.(),});el = $$_div0;
  ;__sveltets_2_ensureSnippet(children());
 }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const Floating__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type Floating__SvelteComponent_ = ReturnType<typeof Floating__SvelteComponent_>;
/*Ωignore_endΩ*/export default Floating__SvelteComponent_;