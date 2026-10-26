///<reference types="svelte" />
;
import AtNotice from "../AtNotice.svelte";
import { bodyHref, type FileJson } from "../concept/data";
import Reader from "../Reader.svelte";
import { prepare } from "../reader/prepare";
import { useLibraryLabel } from "../role.svelte.ts";
import { useTitle } from "../ui.svelte.ts";
import type { Urls } from "../urls";

;type $$ComponentProps =  { urls: Urls; head: number; file: Extract<FileJson, { kind: "derived" }> };function $$render() {

  
  
  
  
  
  
  

  /** A synthesized file (index.md, log.md) in the reader: the file as an agent reads it. */
  let { urls, head, file }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ =
    $props();
  const label = useLibraryLabel(() => urls);
  useTitle(() => `${file.path} · ${label.current}`);
  const prepared = $derived(
    prepare(file.doc, { path: file.path, href: bodyHref(urls), footnote: () => null }),
  );
;
async () => {

 { const $$_ecitoNtA0C = __sveltets_2_ensureComponent(AtNotice); new $$_ecitoNtA0C({ target: __sveltets_2_any(), props: {    urls,head,"current":urls.pinned(undefined).file(file.path),}});} { svelteHTML.createElement("p", {  "class":`small muted`,});     { svelteHTML.createElement("a", { "href":urls.raw(file.path),});  } } { const $$_redaeR0C = __sveltets_2_ensureComponent(Reader); new $$_redaeR0C({ target: __sveltets_2_any(), props: {     prepared,"diff":null,"hideFirst":false,}});}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const Derived__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type Derived__SvelteComponent_ = ReturnType<typeof Derived__SvelteComponent_>;
/*Ωignore_endΩ*/export default Derived__SvelteComponent_;