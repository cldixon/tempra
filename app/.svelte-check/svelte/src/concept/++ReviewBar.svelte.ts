///<reference types="svelte" />
;
import type { Compare } from "../router";
import { day } from "../ui";
import type { Urls } from "../urls";
import type { Namer } from "./byline";
import CheckForm from "./CheckForm.svelte";
import { checker } from "./checked";
import type { Concept, Standing } from "./data";
import VersionWhat from "./VersionWhat.svelte";

;type $$ComponentProps =  {
    urls: Urls;
    concept: Concept;
    compare: Compare;
    standing: Standing;
    name: Namer;
    mayVerify: boolean;
    error: string | null;
    onVerified(): void;
  };function $$render() {

  
  
  
  
  
  
  
  

  /**
   * The slim bar over the text while it shows changes, or an earlier version (tempra-dev:
   * app/reader, Review mode, The panels). In review mode: what the diff is against ("Changes since
   * you checked on Oct 12"), a note and Mark as checked (not for a read member), and Done, the one
   * way out. On a version chosen in History, both views of it by name: "Changes in v3" (the diff
   * from the version before, `?since=`) and "v3 as it was" (`?at=` alone), each linking to the
   * other, with Back to latest.
   */
  let props:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
  const s = $derived(props.standing);
  const plain = $derived(props.urls.pinned(undefined).file(props.concept.path));
  // The version on screen, and what its changes are drawn from: the version before it, from
  // History; any other base says so.
  const since = $derived.by(() => {
    const compare = props.compare;
    if (compare.kind !== "since") return null;
    const version = s.current;
    const i = version ? s.versions.indexOf(version) : -1;
    const base = s.versions.find((v) => v.event.seq === compare.seq);
    const fromBefore = i > 0 && s.versions[i - 1] === base;
    const latest = version !== null && i === s.versions.length - 1;
    return { version, base, fromBefore, latest };
  });
  const against = $derived.by(() => {
    const v = s.verified;
    const who = checker(s, props.name);
    return v && who
      ? s.since === 0
        ? `No changes since ${who} checked on ${day(v.event.ts)}`
        : `Changes since ${who} checked on ${day(v.event.ts)}`
      : "Nobody has checked this page yet";
  });
;
async () => {

if(since){
  const version = since.version;
   { svelteHTML.createElement("section", {    "class":`review-bar`,"aria-label":`Changes`,}); { svelteHTML.createElement("span", {  "class":`review-what`,});if(version){ { const $$_tahWnoisreV2C = __sveltets_2_ensureComponent(VersionWhat); new $$_tahWnoisreV2C({ target: __sveltets_2_any(), props: {      version,"name":props.name,"lead":since.fromBefore || !since.base ? `Changes in v${version.n}` : `Changes since v${since.base.n}`,}});}} }if(props.error){ { svelteHTML.createElement("span", { "class":`warn`,});props.error; }} { svelteHTML.createElement("span", {  "class":`review-actions`,});if(version && !since.latest){ { svelteHTML.createElement("a", {    "class":`button`,"href":`${props.urls.pinned(version.event.seq).file(props.concept.path)}&panel=history`,}); version.n;    }} { svelteHTML.createElement("a", {   "class":`button`,"href":plain,});   } } }
}else{
   { svelteHTML.createElement("section", {    "class":`review-bar`,"aria-label":`Review`,}); { svelteHTML.createElement("span", { "class":`review-what`,});against; }if(props.error){ { svelteHTML.createElement("span", { "class":`warn`,});props.error; }} { svelteHTML.createElement("span", {  "class":`review-actions`,});if(props.mayVerify && (s.since > 0 || !s.verified)){ { const $$_mroFkcehC2C = __sveltets_2_ensureComponent(CheckForm); new $$_mroFkcehC2C({ target: __sveltets_2_any(), props: {       "urls":props.urls,"path":props.concept.path,"onVerified":props.onVerified,}});}} { svelteHTML.createElement("a", {   "class":`button`,"href":plain,});  } } }
}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const ReviewBar__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type ReviewBar__SvelteComponent_ = ReturnType<typeof ReviewBar__SvelteComponent_>;
/*Ωignore_endΩ*/export default ReviewBar__SvelteComponent_;