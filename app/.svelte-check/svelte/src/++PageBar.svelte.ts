///<reference types="svelte" />
;
import type { Snippet } from "svelte";
import { useFrame } from "./frame.svelte.ts";
import Portal from "./Portal.svelte";

;type $$ComponentProps =  {
    path?: Snippet;
    actions?: Snippet;
    /** On a phone the tools take the place of the bell (a concept's, board 33). */
    phoneTools?: boolean;
  };function $$render() {

  
  
  

  /**
   * A page's part of the top bar: its path (a concept's folders and title, TEMPRA-145) and its
   * tools (a concept's ⋯), drawn into the bar's slots from wherever the page is. On a phone the
   * bar names no page and no path: the page's own title does (TEMPRA-140).
   */
  let props:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
  const frame = useFrame();
  const tools = $derived(props.phoneTools === true && props.actions !== undefined);
  $effect.pre(() => {
    if (!tools) return;
    frame.setOwnTools(true);
    return () => frame.setOwnTools(false);
  });
;
async () => {

if(props.path && frame.slots.path){ { const $$_latroP0C = __sveltets_2_ensureComponent(Portal); new $$_latroP0C({ target: __sveltets_2_any(), props: { children:() => { return __sveltets_2_any(0); },"target":frame.slots.path,}});;__sveltets_2_ensureSnippet(props.path()); Portal}}
if(props.actions && frame.slots.tools){ { const $$_latroP0C = __sveltets_2_ensureComponent(Portal); new $$_latroP0C({ target: __sveltets_2_any(), props: { children:() => { return __sveltets_2_any(0); },"target":frame.slots.tools,}});;__sveltets_2_ensureSnippet(props.actions()); Portal}}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const PageBar__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type PageBar__SvelteComponent_ = ReturnType<typeof PageBar__SvelteComponent_>;
/*Ωignore_endΩ*/export default PageBar__SvelteComponent_;