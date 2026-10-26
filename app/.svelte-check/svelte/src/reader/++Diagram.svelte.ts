///<reference types="svelte" />
;
/**
   * A `mermaid` fence drawn as a diagram (tempra-dev: app/diagrams), the registry's first entry.
   * Pele loads on demand (./pele.ts, through diagram.ts); the figure is drawn at its width and
   * again when that changes. It sits in a quiet frame with its caption below ("Figure n." and the
   * fence's `title="…"`) and two small controls in its corner: Source (the Mermaid source in
   * place, and back) and Enlarge (the full-screen view, Lightbox.svelte). What it draws, the
   * controls included, is opaque to comments (`data-opaque`), and the controls and caption are not
   * text (`data-skip`). A diagram that fails shows its source as the default code block would,
   * where comments can anchor, with a quiet notice under it.
   */
import type { Code } from "mdast";
import Icon from "../Icon.svelte";
import Caption from "./Caption.svelte";
import { drawDiagram } from "./diagram";
import { useOpenFigure } from "./open-figure";
import type { BlockProps } from "./registry";
function $$render() {

  
  
  
  
  
  
  

  let { node, id, offset, text, figure }: BlockProps<Code> = $props();
  const open = useOpenFigure();
  let showSource = $state(false);
  let failed = $state.raw<{ source: string; message: string } | null>(null);
  const failure = $derived(failed?.source === node.value ? failed.message : null);
  const captionId = $props.id();
  const fail = (source: string, message: string) => {
    failed = { source, message };
  };
;
async () => {

if(failure !== null){
   { svelteHTML.createElement("figure", {    "class":`diagram failed`,...__sveltets_2_empty({"data-block":id}),}); { svelteHTML.createElement("pre", {   ...__sveltets_2_empty({"data-text":offset}),...__sveltets_2_empty({"data-lang":`mermaid`}),}); { svelteHTML.createElement("code", {});;__sveltets_2_ensureSnippet(text?.()); } } { svelteHTML.createElement("p", {   "class":`diagram-notice`,...__sveltets_2_empty({"data-skip":""}),});   failure; }if(figure){ { const $$_noitpaC1C = __sveltets_2_ensureComponent(Caption); new $$_noitpaC1C({ target: __sveltets_2_any(), props: {   figure,"id":captionId,}});}} }
}else{
   { svelteHTML.createElement("figure", {     "class":`diagram`,...__sveltets_2_empty({"data-block":id}),...__sveltets_2_empty({"data-opaque":""}),}); { svelteHTML.createElement("div", {  "class":`diagram-frame`,});if(showSource){ { svelteHTML.createElement("pre", {   "class":`diagram-source`,...__sveltets_2_empty({"data-lang":`mermaid`}),}); { svelteHTML.createElement("code", {});node.value; } }}else{ { svelteHTML.createElement("div", {          "class":`diagram-svg`,"role":`img`,"aria-labelledby":figure ? captionId : undefined,"aria-label":figure ? undefined : "Diagram",[Symbol("@attach")]:drawDiagram(node.value, `d${id ?? ""}-`, fail),}); }} { svelteHTML.createElement("span", {   "class":`figure-tools`,...__sveltets_2_empty({"data-skip":""}),}); { svelteHTML.createElement("button", {      "type":`button`,"aria-pressed":showSource,"onclick":(e) => {
            e.stopPropagation();
            showSource = !showSource;
          },});  }if(open && figure){ { svelteHTML.createElement("button", {        "type":`button`,"class":`figure-enlarge`,"aria-label":`Enlarge diagram${figure.caption ? `: ${figure.caption}` : ""}`,"onclick":(e) => {
              e.stopPropagation();
              open(figure.n);
            },}); { const $$_nocI4C = __sveltets_2_ensureComponent(Icon); new $$_nocI4C({ target: __sveltets_2_any(), props: {    "name":`enlarge`,"size":14,}});} }} } }if(figure){ { const $$_noitpaC1C = __sveltets_2_ensureComponent(Caption); new $$_noitpaC1C({ target: __sveltets_2_any(), props: {   figure,"id":captionId,}});}} }
}
};
return { props: {} as any as BlockProps<Code>, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const Diagram__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type Diagram__SvelteComponent_ = ReturnType<typeof Diagram__SvelteComponent_>;
/*Ωignore_endΩ*/export default Diagram__SvelteComponent_;