///<reference types="svelte" />
;
  /** Whether the Markdown view wraps long lines, for this tab (a per-viewer convenience). */
  let wrapped = false;
;;

import Icon from "../Icon.svelte";
import { useLoad } from "../load.svelte.ts";
import Status from "../Status.svelte";
import { baseName, type Urls } from "../urls";
import { storedFile } from "./tools";

;type $$ComponentProps =  { urls: Urls; path: string; hash: string; onBack(): void };function $$render() {

  
  
  
  
  

  /**
   * The Markdown view (take 4, TEMPRA-114; TEMPRA-134; tempra-dev: app/reader, Markdown view): the
   * file as stored, frontmatter and body, in the mono with line numbers, in place of the page
   * (`?view=markdown`), with Back to page, its path, Wrap lines and Download. Each line is a span
   * whose number is a CSS counter in the gutter, so copying the text copies no numbers.
   */
  let { urls, path, hash, onBack }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ =
    $props();
  const loaded = useLoad(
    () => `markdown ${urls.file(path)} ${hash}`,
    () => storedFile(urls, path),
  );
  let wrap = $state(wrapped);
;
async () => {



 { svelteHTML.createElement("section", {    "class":`raw-markdown`,"aria-label":`Markdown`,}); { svelteHTML.createElement("div", {  "class":`raw-head`,}); { svelteHTML.createElement("button", {     "type":`button`,"class":`pill-button`,"onclick":() => onBack(),}); { const $$_nocI3C = __sveltets_2_ensureComponent(Icon); new $$_nocI3C({ target: __sveltets_2_any(), props: {  "name":`previous`,}});}    } { svelteHTML.createElement("code", { "class":`raw-path`,});path; } { svelteHTML.createElement("button", {      "type":`button`,"aria-pressed":wrap,"onclick":() => {
        wrapped = !wrap;
        wrap = !wrap;
      },});  } { svelteHTML.createElement("a", {     "class":`button pill-button`,"href":urls.raw(path),"download":baseName(path),}); { const $$_nocI3C = __sveltets_2_ensureComponent(Icon); new $$_nocI3C({ target: __sveltets_2_any(), props: {  "name":`download`,}});}  } } { const $$_sutatS1C = __sveltets_2_ensureComponent(Status); const $$_sutatS1 = new $$_sutatS1C({ target: __sveltets_2_any(), props: {  "loaded":loaded.current,children:(text: string) => { async ()/*Ωignore_positionΩ*/ => { { svelteHTML.createElement("pre", { "class":wrap ? "raw-file wrap" : "raw-file",});    for(let line of __sveltets_2_ensureArray((text.replace(/\n$/, "").split("\n")))){let i = 1;i; { svelteHTML.createElement("span", { "class":`raw-line`,});line;"\n"; }} }};return __sveltets_2_any(0)},}});/*Ωignore_startΩ*/const {children} = $$_sutatS1.$$prop_def;/*Ωignore_endΩ*/  Status} }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const RawMarkdown__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type RawMarkdown__SvelteComponent_ = ReturnType<typeof RawMarkdown__SvelteComponent_>;
/*Ωignore_endΩ*/export default RawMarkdown__SvelteComponent_;