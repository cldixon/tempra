///<reference types="svelte" />
;
/**
   * A concept body drawn from its stored tree (tempra-dev: app/reader): what body.ts works out,
   * drawn by Blocks.svelte. `hideFirst` keeps a leading heading that repeats the title in the DOM,
   * hidden, so offsets stay where the text has them.
   */
import type { WordDiff } from "@tempra/editor";
import Blocks from "./Blocks.svelte";
import { bodyBlocks } from "./body";
import type { Prepared } from "./prepare";
import { node } from "./registry";

;type $$ComponentProps =  { prepared: Prepared; diff: WordDiff | null; hideFirst: boolean };function $$render() {

  
  
  
  
  
  

  let { prepared, diff, hideFirst }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ =
    $props();
  const blocks = $derived(bodyBlocks(prepared, diff, hideFirst, (type) => type in node));
;
async () => {

 { const $$_skcolB0C = __sveltets_2_ensureComponent(Blocks); new $$_skcolB0C({ target: __sveltets_2_any(), props: { blocks,}});}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const Body__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type Body__SvelteComponent_ = ReturnType<typeof Body__SvelteComponent_>;
/*Ωignore_endΩ*/export default Body__SvelteComponent_;