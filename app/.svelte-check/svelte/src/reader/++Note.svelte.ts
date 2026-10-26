///<reference types="svelte" />
;
/** Content beside the body (a footnote definition), drawn the same way, outside the text. */
import type { RootContent } from "mdast";
import Blocks from "./Blocks.svelte";
import { noteBlocks } from "./body";
import type { Prepared } from "./prepare";
import { node } from "./registry";

;type $$ComponentProps =  { prepared: Prepared; nodes: readonly RootContent[] };function $$render() {

  
  
  
  
  
  

  let { prepared, nodes }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
  const blocks = $derived(noteBlocks(prepared, nodes, (type) => type in node));
;
async () => {

 { const $$_skcolB0C = __sveltets_2_ensureComponent(Blocks); new $$_skcolB0C({ target: __sveltets_2_any(), props: { blocks,}});}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const Note__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type Note__SvelteComponent_ = ReturnType<typeof Note__SvelteComponent_>;
/*Ωignore_endΩ*/export default Note__SvelteComponent_;