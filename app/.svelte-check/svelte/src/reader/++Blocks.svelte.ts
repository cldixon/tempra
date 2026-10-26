///<reference types="svelte" />
;
/**
   * Blocks of a body as body.ts describes them (tempra-dev: app/reader): the stored tree drawn as
   * elements, with nothing parsed and no HTML injected. Blocks are keyed by their IDs, so a block a
   * new version leaves alone keeps its DOM nodes, and the highlights and selection over them.
   *
   * Inline content is written with no whitespace between elements: the DOM's text inside a
   * `data-text` element must read exactly as the document's text (dom.ts counts it).
   */
import CodeBlock from "./CodeBlock.svelte";
import Caption from "./Caption.svelte";
import FigureBox from "./FigureBox.svelte";
import FigureOf from "./FigureOf.svelte";
import FromHosts from "./FromHosts.svelte";
import InlineImage from "./InlineImage.svelte";
import type { Block, Inline } from "./body";
import { figureNumber } from "./figure";
import { code, node as nodeBlocks } from "./registry";

;type $$ComponentProps =  { blocks: Block[] };function $$render() {
 const inline/*Ωignore_positionΩ*/ = (nodes: Inline[])/*Ωignore_startΩ*/: ReturnType<import('svelte').Snippet>/*Ωignore_endΩ*/ => { async ()/*Ωignore_positionΩ*/ => {
    for(let x of __sveltets_2_ensureArray(nodes)){
    if(typeof x === "string"){
      x;
    } else if (x.k === "ins"){
      
       { svelteHTML.createElement("ins", { "class":`diff-added`,}); { svelteHTML.createElement("span", {  "class":`visually-hidden`,...__sveltets_2_empty({"data-skip":""}),});"added: "; }x.text; }
    } else if (x.k === "del"){
       { svelteHTML.createElement("del", {  "class":`diff-removed`,...__sveltets_2_empty({"data-skip":""}),}); { svelteHTML.createElement("span", { "class":`visually-hidden`,});"removed: "; }x.text; }
    } else if (x.k === "code"){
       { svelteHTML.createElement("code", {});;__sveltets_2_ensureSnippet(inline(x.kids)); }
    } else if (x.k === "strong"){
       { svelteHTML.createElement("strong", {});;__sveltets_2_ensureSnippet(inline(x.kids)); }
    } else if (x.k === "em"){
       { svelteHTML.createElement("em", {});;__sveltets_2_ensureSnippet(inline(x.kids)); }
    } else if (x.k === "s"){
       { svelteHTML.createElement("s", {});;__sveltets_2_ensureSnippet(inline(x.kids)); }
    } else if (x.k === "span"){
       { svelteHTML.createElement("span", {});;__sveltets_2_ensureSnippet(inline(x.kids)); }
    } else if (x.k === "gap"){
       { svelteHTML.createElement("span", { "class":`figure-gap`,});;__sveltets_2_ensureSnippet(inline(x.kids)); }
    } else if (x.k === "br"){
        { svelteHTML.createElement("br", {...__sveltets_2_empty({"data-atom":""}),});}
    } else if (x.k === "a"){
       { svelteHTML.createElement("a", {          "href":x.href,"title":x.title,"rel":x.rel,"class":x.cls,...__sveltets_2_empty({"data-path":x.path}),});;__sveltets_2_ensureSnippet(inline(x.kids)); }
    } else if (x.k === "figure"){
       { const $$_fOerugiF0C = __sveltets_2_ensureComponent(FigureOf); new $$_fOerugiF0C({ target: __sveltets_2_any(), props: {  "figure":x.figure,}});}
    } else if (x.k === "cell"){
       { svelteHTML.createElement("span", {  "class":`figure-cell`,}); { const $$_fOerugiF1C = __sveltets_2_ensureComponent(FigureOf); new $$_fOerugiF1C({ target: __sveltets_2_any(), props: {  "figure":x.figure,}});}if(x.label){ { svelteHTML.createElement("span", {   "class":`figure-label`,...__sveltets_2_empty({"data-skip":""}),});x.label; }} }
    } else if (x.k === "dropped"){
       { svelteHTML.createElement("span", {  "class":`image-dropped`,...__sveltets_2_empty({"data-atom":""}),});x.alt; }
    } else if (x.k === "media"){
      
       { svelteHTML.createElement("a", {  "href":x.href,...__sveltets_2_empty({"data-atom":""}),});x.text; }
    } else if (x.k === "img"){
       { const $$_egamIenilnI0C = __sveltets_2_ensureComponent(InlineImage); new $$_egamIenilnI0C({ target: __sveltets_2_any(), props: {        "source":x.source,"alt":x.alt,"title":x.title,"host":x.host,}});}
    } else if (x.k === "fn"){
      
       { svelteHTML.createElement("sup", {    "class":`fnref`,...__sveltets_2_empty({"data-atom":""}),...__sveltets_2_empty({"data-label":x.label}),});if(x.href === null){x.mark;}else{ { svelteHTML.createElement("a", {    "href":x.href,"aria-label":`footnote ${x.mark}`,});x.mark; }} }
    } else if (x.k === "raw"){
      
       { svelteHTML.createElement("code", {  "class":`raw`,...__sveltets_2_empty({"data-atom":""}),});x.text; }
    }
  }
};return __sveltets_2_any(0)}; const blocks/*Ωignore_positionΩ*/ = (nodes: Block[])/*Ωignore_startΩ*/: ReturnType<import('svelte').Snippet>/*Ωignore_endΩ*/ => { async ()/*Ωignore_positionΩ*/ => {
     for(let b of __sveltets_2_ensureArray(nodes)){b.key;
    if(b.kind === "p"){
       { svelteHTML.createElement("p", {   ...__sveltets_2_empty({"data-block":b.id}),...__sveltets_2_empty({"data-text":b.offset}),});;__sveltets_2_ensureSnippet(inline(b.text)); }
    } else if (b.kind === "figure"){
       { svelteHTML.createElement("figure", {    "class":`figure`,...__sveltets_2_empty({"data-block":b.id}),}); { svelteHTML.createElement("p", { ...__sveltets_2_empty({"data-text":b.offset}),});;__sveltets_2_ensureSnippet(inline(b.text)); } { const $$_noitpaC1C = __sveltets_2_ensureComponent(Caption); new $$_noitpaC1C({ target: __sveltets_2_any(), props: {  "figure":b.figure,}});} }
    } else if (b.kind === "heading"){
       { svelteHTML.createElement(`h${b.depth}`, {         "id":b.anchor,...__sveltets_2_empty({"data-block":b.id}),...__sveltets_2_empty({"data-text":b.offset}),"hidden":b.hidden || undefined,});;__sveltets_2_ensureSnippet(inline(b.text)); }
    } else if (b.kind === "blockquote"){
       { svelteHTML.createElement("blockquote", { ...__sveltets_2_empty({"data-block":b.id}),});;__sveltets_2_ensureSnippet(blocks(b.blocks)); }
    } else if (b.kind === "list"){
      if(b.ordered){
         { svelteHTML.createElement("ol", {     ...__sveltets_2_empty({"data-block":b.id}),"start":b.start,"class":b.cls,});;__sveltets_2_ensureSnippet(items(b.items)); }
      }else{
         { svelteHTML.createElement("ul", {   ...__sveltets_2_empty({"data-block":b.id}),"class":b.cls,});;__sveltets_2_ensureSnippet(items(b.items)); }
      }
    } else if (b.kind === "code"){
        const codeText/*Ωignore_positionΩ*/ = ()/*Ωignore_startΩ*/: ReturnType<import('svelte').Snippet>/*Ωignore_endΩ*/ => { async ()/*Ωignore_positionΩ*/ => {;__sveltets_2_ensureSnippet(inline(b.text));};return __sveltets_2_any(0)};const C = (b.lang && code[b.lang]) || CodeBlock;
      
       { const $$_C0C = __sveltets_2_ensureComponent(C); new $$_C0C({ target: __sveltets_2_any(), props: {          "node":b.node,"id":b.id,"offset":b.offset,"text":codeText,"figure":b.figure,}});}
    } else if (b.kind === "custom"){
        const customText/*Ωignore_positionΩ*/ = ()/*Ωignore_startΩ*/: ReturnType<import('svelte').Snippet>/*Ωignore_endΩ*/ => { async ()/*Ωignore_positionΩ*/ => {if(b.text){;__sveltets_2_ensureSnippet(inline(b.text));}};return __sveltets_2_any(0)};const C = nodeBlocks[b.type];
      
      if(C){ { const $$_C0C = __sveltets_2_ensureComponent(C); new $$_C0C({ target: __sveltets_2_any(), props: {        "node":b.node,"id":b.id,"offset":b.offset,"text":b.text ? customText : null,}});}}
    } else if (b.kind === "hr"){
       { svelteHTML.createElement("hr", {  ...__sveltets_2_empty({"data-block":b.id}),});}
    } else if (b.kind === "table"){
       { svelteHTML.createElement("div", {    "class":`table`,...__sveltets_2_empty({"data-block":b.id}),}); { svelteHTML.createElement("table", { });if(b.head){ { svelteHTML.createElement("thead", { }); { svelteHTML.createElement("tr", { });  for(let c of __sveltets_2_ensureArray(b.head)){ { svelteHTML.createElement("th", {    ...__sveltets_2_empty({"data-text":c.offset}),...__sveltets_2_empty({"data-align":c.align}),});;__sveltets_2_ensureSnippet(inline(c.text)); }} } }}if(b.rows.length > 0){ { svelteHTML.createElement("tbody", { });  for(let row of __sveltets_2_ensureArray(b.rows)){ { svelteHTML.createElement("tr", { });  for(let c of __sveltets_2_ensureArray(row)){ { svelteHTML.createElement("td", {    ...__sveltets_2_empty({"data-text":c.offset}),...__sveltets_2_empty({"data-align":c.align}),});;__sveltets_2_ensureSnippet(inline(c.text)); }} }} }} } }
    } else if (b.kind === "markup"){
       { const $$_xoBerugiF0C = __sveltets_2_ensureComponent(FigureBox); new $$_xoBerugiF0C({ target: __sveltets_2_any(), props: {      children:() => { return __sveltets_2_any(0); },"spec":b.spec,"count":b.count,"block":b.id,}});   for(let row of __sveltets_2_ensureArray(b.rows)){row.key; { svelteHTML.createElement("p", {      "class":row.group ? "figure-row" : undefined,...__sveltets_2_empty({"data-block":row.id}),...__sveltets_2_empty({"data-text":row.offset}),});;__sveltets_2_ensureSnippet(inline(row.text)); }} { svelteHTML.createElement("figcaption", {  ...__sveltets_2_empty({"data-skip":""}),...__sveltets_2_empty({"data-block":b.labelId}),}); { svelteHTML.createElement("span", { "class":`figure-number`,});figureNumber(b.number, b.count); }if(b.caption){" ";if(typeof b.caption === "string"){b.caption;}else{;__sveltets_2_ensureSnippet(inline(
                b.caption,
              ));}} { const $$_stsoHmorF2C = __sveltets_2_ensureComponent(FromHosts); new $$_stsoHmorF2C({ target: __sveltets_2_any(), props: {  "figures":b.figures,}});} }  FigureBox}
    } else if (b.kind === "directive"){
       { svelteHTML.createElement("div", {    "class":`directive`,...__sveltets_2_empty({"data-block":b.id}),}); { svelteHTML.createElement("p", {    "class":`raw-fence`,...__sveltets_2_empty({"data-skip":""}),...__sveltets_2_empty({"data-block":b.labelId}),}); { svelteHTML.createElement("code", { "class":`raw`,});b.open; } };__sveltets_2_ensureSnippet(blocks(b.blocks)); { svelteHTML.createElement("p", {   "class":`raw-fence`,...__sveltets_2_empty({"data-skip":""}),}); { svelteHTML.createElement("code", { "class":`raw`,});b.close; } } }
    } else if (b.kind === "div"){
       { svelteHTML.createElement("div", { ...__sveltets_2_empty({"data-block":b.id}),});;__sveltets_2_ensureSnippet(blocks(b.blocks)); }
    } else if (b.kind === "raw"){
      
       { svelteHTML.createElement("pre", {   "class":`raw`,...__sveltets_2_empty({"data-block":b.id}),}); { svelteHTML.createElement("code", {});b.text; } }
    }
  }
};return __sveltets_2_any(0)}; const items/*Ωignore_positionΩ*/ = (list: Extract<Block, { kind: "list" }>["items"])/*Ωignore_startΩ*/: ReturnType<import('svelte').Snippet>/*Ωignore_endΩ*/ => { async ()/*Ωignore_positionΩ*/ => {
     for(let item of __sveltets_2_ensureArray(list)){item.key;
     { svelteHTML.createElement("li", {    ...__sveltets_2_empty({"data-block":item.id}),"class":item.checked !== null ? "task" : undefined,});if(item.checked !== null){ { svelteHTML.createElement("input", {         "type":`checkbox`,"checked":item.checked,"disabled":true,"aria-label":`Done`,"readonly":true,});}};__sveltets_2_ensureSnippet(blocks(item.blocks)); }
  }
};return __sveltets_2_any(0)};
  
  
  
  
  
  
  
  
  
  

  let { blocks: list }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
;
async () => {







;__sveltets_2_ensureSnippet(blocks(list));
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const Blocks__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type Blocks__SvelteComponent_ = ReturnType<typeof Blocks__SvelteComponent_>;
/*Ωignore_endΩ*/export default Blocks__SvelteComponent_;