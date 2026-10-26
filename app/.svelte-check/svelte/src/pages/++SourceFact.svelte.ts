///<reference types="svelte" />
;
import AgentName from "../AgentName.svelte";
import type { AttachSource } from "../concept/data";
import Moment from "../Moment.svelte";
import { baseName, type Urls } from "../urls";
import { hostOf, type Name, type Use, type Version } from "./attachment";

;type $$ComponentProps =  {
    urls: Urls;
    source: AttachSource | null | undefined;
    /** The version on screen, for who uploaded it. */
    version: Version | null;
    uses: readonly Use[] | null;
    titles: ReadonlyMap<string, string>;
    name: Name;
  };function $$render() {

  
  
  
  
  

  /**
   * Source: "From example.com, fetched 2 hours ago" linking the URL (and where it was redirected
   * to), or "Uploaded by Claude Code for @dev" for bytes an agent sent; then the page that cites
   * it, when one does.
   */
  let props:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
  // A link to the web, its attributes in the order the page has always drawn them.
  const outbound = (href: string) => ({ href, rel: "noopener noreferrer", target: "_blank" });
  const cited = $derived((props.uses ?? []).find((u) => u.cites !== null));
  const redirected = $derived(
    props.source?.final_url && props.source.final_url !== props.source.url ? props.source.final_url : null,
  );
;
async () => {

if(props.source){ { svelteHTML.createElement("div", { });  { svelteHTML.createElement("a", {...outbound(props.source.url),});hostOf(props.source.url); }if(props.source.fetched_at){   { const $$_tnemoM1C = __sveltets_2_ensureComponent(Moment); new $$_tnemoM1C({ target: __sveltets_2_any(), props: {  "ts":props.source.fetched_at,}});}} }} else if (props.version){ { svelteHTML.createElement("div", {});   { const $$_emaNtnegA1C = __sveltets_2_ensureComponent(AgentName); new $$_emaNtnegA1C({ target: __sveltets_2_any(), props: {  "who":props.name(props.version.actor, props.version.by),}});} }}else{ { svelteHTML.createElement("div", { "class":`muted`,});  }}if(redirected){ { svelteHTML.createElement("div", {  "class":`muted`,});   { svelteHTML.createElement("a", {...outbound(redirected),});hostOf(redirected); } }}if(cited){ { svelteHTML.createElement("div", {  "class":`muted`,});   { svelteHTML.createElement("a", { "href":props.urls.file(cited.path),});props.titles.get(cited.path) ?? baseName(cited.path); }  cited.cites;  }}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const SourceFact__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type SourceFact__SvelteComponent_ = ReturnType<typeof SourceFact__SvelteComponent_>;
/*Ωignore_endΩ*/export default SourceFact__SvelteComponent_;