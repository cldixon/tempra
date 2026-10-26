///<reference types="svelte" />
;
import type { Urls } from "../urls";
import type { Namer } from "./byline";
import type { Concept, Standing } from "./data";
import VersionWhat from "./VersionWhat.svelte";

;type $$ComponentProps =  { urls: Urls; concept: Concept; standing: Standing; name: Namer };function $$render() {

  
  
  
  

  /**
   * An earlier version on screen with no changes drawn (`?at=` alone): "v3 as it was · note · who
   * · when", Changes in v3 (the diff from the version before) and Back to latest.
   */
  let { urls, concept: c, standing: s, name }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ =
    $props();
  const version = $derived(s.current);
  const before = $derived.by(() => {
    const i = version ? s.versions.indexOf(version) : -1;
    return i > 0 ? s.versions[i - 1] : undefined;
  });
  const page = $derived(version ? urls.pinned(version.event.seq).file(c.path) : "");
;
async () => {

if(version){
   { svelteHTML.createElement("section", {    "class":`review-bar`,"aria-label":`Version`,}); { svelteHTML.createElement("span", { "class":`review-what`,}); { const $$_tahWnoisreV2C = __sveltets_2_ensureComponent(VersionWhat); new $$_tahWnoisreV2C({ target: __sveltets_2_any(), props: {    version,name,"lead":`v${version.n} as it was`,}});} } { svelteHTML.createElement("span", {  "class":`review-actions`,});if(before){ { svelteHTML.createElement("a", {   "class":`button`,"href":`${page}${page.includes("?") ? "&" : "?"}since=${before.event.seq}`,});  version.n; }} { svelteHTML.createElement("a", {    "class":`button`,"href":urls.pinned(undefined).file(c.path),});   } } }
}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const VersionBar__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type VersionBar__SvelteComponent_ = ReturnType<typeof VersionBar__SvelteComponent_>;
/*Ωignore_endΩ*/export default VersionBar__SvelteComponent_;