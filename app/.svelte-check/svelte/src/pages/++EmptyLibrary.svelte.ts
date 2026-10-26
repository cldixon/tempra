///<reference types="svelte" />
;
import type { LedgerRequest } from "../activity";
import { type ActorView, actorAgentName, actorText } from "../agents";
import Icon from "../Icon.svelte";
import Moment from "../Moment.svelte";
import type { Role } from "../role";
import { clip } from "../ui";
import { useCopy } from "../ui.svelte.ts";
import type { Urls } from "../urls";

;type $$ComponentProps =  {
    urls: Urls;
    access: Role | null;
    latest: LedgerRequest | null;
    who: ActorView | null;
    now: number;
    heading?: string;
  };function $$render() {

  
  
  
  
  
  
  
  

  /**
   * A library with no pages (board 31): the steps to connect an agent, the MCP URL to copy, then
   * "Waiting for the first write" with the pulsing dot until an agent writes (the home reloads on
   * the feed, so it fills in live), and Import a bundle. By role (H-11): a read member, who can
   * neither connect an agent here nor import, sees only that nothing is here yet; Import is the
   * owner's (TEMPRA-124). `heading` names the box when it heads a library with pages but no agent.
   */
  let {
    urls,
    access: role,
    latest,
    who,
    now,
    heading,
  }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();

  const mcp = `${typeof location === "undefined" ? "" : location.origin}/mcp`;
  const copied = useCopy();
  const canWrite = $derived(role === "owner" || role === "write");
;
async () => {

 { svelteHTML.createElement("section", {   "class":`empty-library`,"aria-labelledby":`empty-title`,});
   { svelteHTML.createElement("h2", {   "id":`empty-title`,"class":`view-section-title`,});heading ?? "Nothing here yet"; }
  if(role === "read"){
     { svelteHTML.createElement("p", { "class":`view-empty`,});        }
  }
  if(canWrite){
     { svelteHTML.createElement("ol", { "class":`empty-steps`,});
       { svelteHTML.createElement("li", {});
         { svelteHTML.createElement("span", {});     } { svelteHTML.createElement("span", { "class":`copy-field`,}); { svelteHTML.createElement("code", {});mcp; } { svelteHTML.createElement("button", {           "type":`button`,"class":`icon-button`,"aria-label":`Copy the MCP URL`,"title":copied.state === "copied" ? "Copied" : "Copy","onclick":() => void copied.copy(mcp),}); { const $$_nocI5C = __sveltets_2_ensureComponent(Icon); new $$_nocI5C({ target: __sveltets_2_any(), props: {  "name":copied.state === "copied" ? "check" : "copy",}});} } }
       }
       { svelteHTML.createElement("li", {});
         { svelteHTML.createElement("span", {});        urls.slug;          }
       }
     }
  }
  if(canWrite || !heading){
     { svelteHTML.createElement("p", {   "class":`empty-wait`,"aria-live":`polite`,});
      if(latest){
         { svelteHTML.createElement("span", {   "class":`change-dot`,"aria-hidden":`true`,}); } { svelteHTML.createElement("span", {});   who ? actorText(who) : actorAgentName(latest.actor);  { const $$_tnemoM3C = __sveltets_2_ensureComponent(Moment); new $$_tnemoM3C({ target: __sveltets_2_any(), props: {   "ts":latest.ts,now,}});}latest.note ? `: ${clip(latest.note, 80)}` : ""; }
      }else{
         { svelteHTML.createElement("span", {   "class":`change-dot live`,"aria-hidden":`true`,}); } { svelteHTML.createElement("span", {});     }
      }
     }
  }
 }
if(canWrite){
   { svelteHTML.createElement("p", { "class":`empty-more`,});if(role === "owner"){ { svelteHTML.createElement("a", { "href":urls.transfer(),});   }" · ";} { svelteHTML.createElement("a", { "href":urls.connect(),});    } }
}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const EmptyLibrary__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type EmptyLibrary__SvelteComponent_ = ReturnType<typeof EmptyLibrary__SvelteComponent_>;
/*Ωignore_endΩ*/export default EmptyLibrary__SvelteComponent_;