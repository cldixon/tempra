///<reference types="svelte" />
;
import AgentName from "../AgentName.svelte";
import Icon from "../Icon.svelte";
import Moment from "../Moment.svelte";
import { relativeTime } from "../ui";
import { baseName, type Urls } from "../urls";
import { type Name, sizeText, type Version } from "./attachment";

;type $$ComponentProps =  { urls: Urls; path: string; versions: readonly Version[]; name: Name };function $$render() {

  
  
  
  
  
  

  /**
   * File history: every version newest first, who and when, its size and dimensions, Download for
   * each (the version's own bytes, `?at=`), the one on screen marked Current.
   */
  let props:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
;
async () => {

 { svelteHTML.createElement("section", {    "class":`attachment-history`,"aria-labelledby":`file-history`,}); { svelteHTML.createElement("h2", {   "id":`file-history`,"class":`view-section-title`,});  } { svelteHTML.createElement("ol", {});
       for(let v of __sveltets_2_ensureArray(props.versions)){v.seq; { svelteHTML.createElement("li", {  "class":v.current ? "current" : undefined,}); { svelteHTML.createElement("span", { "class":`attachment-version-when`,}); { const $$_tnemoM4C = __sveltets_2_ensureComponent(Moment); new $$_tnemoM4C({ target: __sveltets_2_any(), props: {  "ts":v.ts,}});}if(v.current){ { svelteHTML.createElement("span", { "class":`chip`,});  }} } { svelteHTML.createElement("span", { "class":`attachment-version-who`,});v.what;   { const $$_emaNtnegA4C = __sveltets_2_ensureComponent(AgentName); new $$_emaNtnegA4C({ target: __sveltets_2_any(), props: {  "who":props.name(v.actor, v.by),}});} } { svelteHTML.createElement("span", { "class":`attachment-version-size muted`,});sizeText(v.size, v.width, v.height); } { svelteHTML.createElement("a", {      "class":`attachment-version-download`,"href":props.urls.pinned(v.seq).download(props.path),"download":baseName(props.path),}); { const $$_nocI4C = __sveltets_2_ensureComponent(Icon); new $$_nocI4C({ target: __sveltets_2_any(), props: {  "name":`download`,}});}  { svelteHTML.createElement("span", { "class":`visually-hidden`,});` the version from ${relativeTime(v.ts)}`; } } }}
   } }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const FileHistory__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type FileHistory__SvelteComponent_ = ReturnType<typeof FileHistory__SvelteComponent_>;
/*Ωignore_endΩ*/export default FileHistory__SvelteComponent_;