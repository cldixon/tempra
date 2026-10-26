///<reference types="svelte" />
;
/** The default code block: the text, with the fence's language as a quiet label (CSS only). */
import type { Code } from "mdast";
import type { BlockProps } from "./registry";
function $$render() {

  
  
  

  let { node, id, offset, text }: BlockProps<Code> = $props();
;
async () => {

 { svelteHTML.createElement("pre", {     ...__sveltets_2_empty({"data-block":id}),...__sveltets_2_empty({"data-text":offset}),...__sveltets_2_empty({"data-lang":node.lang ?? undefined}),}); { svelteHTML.createElement("code", { });;__sveltets_2_ensureSnippet(text?.()); } }
};
return { props: {} as any as BlockProps<Code>, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const CodeBlock__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type CodeBlock__SvelteComponent_ = ReturnType<typeof CodeBlock__SvelteComponent_>;
/*Ωignore_endΩ*/export default CodeBlock__SvelteComponent_;