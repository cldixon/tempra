///<reference types="svelte" />
;
import { actorText } from "../agents";
import Moment from "../Moment.svelte";
import type { Urls } from "../urls";
import type { Namer } from "./byline";
import { actedBy, type Concept, type Standing } from "./data";
import { PAGE, versionHref } from "./history";

;type $$ComponentProps =  {
    urls: Urls;
    concept: Concept;
    standing: Standing;
    name: Namer;
    /** Whether the version on screen has its changes drawn (`?since=`). */
    comparing: boolean;
  };function $$render() {

  
  
  
  
  
  

  /**
   * The History panel (take 4, TEMPRA-114; tempra-dev: app/reader, The panels): the concept's
   * versions, newest first (number, note, who and when). Each opens that version with what it
   * changed drawn in its text (`versionHref`). Verification is in Properties, not here
   * (decisions/verification-out-of-the-way).
   */
  let props:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
  let shown = $state(PAGE);
  const versions = $derived([...props.standing.versions].reverse());
  const older = $derived(versions.length - shown);
;
async () => {

 { svelteHTML.createElement("ol", { "class":`versions`,});
     for(let version of __sveltets_2_ensureArray((versions.slice(0, shown)))){version.event.seq;
    const e = version.event;
    const who = props.name(e.actor, actedBy(e));
    const note = typeof e.meta?.note === "string" ? e.meta.note : "";
    const onScreen = e.seq === props.standing.current?.event.seq;
    const chosen = onScreen && props.comparing;
     { svelteHTML.createElement("li", { }); { svelteHTML.createElement("a", {         "class":chosen ? "version chosen" : onScreen ? "version current" : "version","href":versionHref(props.urls, props.concept.path, props.standing.versions, version.n),"aria-current":onScreen ? "true" : undefined,"title":version.n === 1 ? "The first version" : `What version ${version.n} changed`,}); { svelteHTML.createElement("span", { "class":`version-n`,}); version.n; } { svelteHTML.createElement("span", {  "class":`version-what`,}); { svelteHTML.createElement("span", { "class":`version-note`,});note || (version.n === 1 ? "Created" : "Edited"); } { svelteHTML.createElement("span", {  "class":`version-who`,});actorText(who);   { const $$_tnemoM5C = __sveltets_2_ensureComponent(Moment); new $$_tnemoM5C({ target: __sveltets_2_any(), props: {  "ts":e.ts,}});} } } } }
  }
 }if(older > 0){ { svelteHTML.createElement("button", {     "type":`button`,"class":`ghost older-versions`,"onclick":() => (shown += PAGE),});older;  older === 1 ? "" : "s"; }}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const HistoryList__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type HistoryList__SvelteComponent_ = ReturnType<typeof HistoryList__SvelteComponent_>;
/*Ωignore_endΩ*/export default HistoryList__SvelteComponent_;