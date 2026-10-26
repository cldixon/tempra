///<reference types="svelte" />
;
import { useAgentNames } from "../agents.svelte.ts";
import type { Urls } from "../urls";
import { changeLine, type Live } from "./live";

;type $$ComponentProps =  { urls: Urls; live: Live | null };function $$render() {

  
  
  

  /**
   * Someone else's change, said once in a polite live region (C-27, TEMPRA-133): "New version:
   * Claude Code for @dev changed this: the note." Kept mounted, so the words are announced when
   * they change; no time in them, so they do not change again as it passes.
   */
  let { urls, live }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
  const names = useAgentNames(() => urls);
  const said = $derived.by(() => {
    const e = live?.change;
    if (!e) return "";
    const line = changeLine(e, names.label(e.actor, e.by), "")
      .replace(/ +\./, ".")
      .replace(/ +:/, ":");
    return e.op === "move" || e.op === "delete" ? line : `New version: ${line}`;
  });
;
async () => {

 { svelteHTML.createElement("div", {     "class":`visually-hidden`,"role":`status`,"aria-live":`polite`,});said; }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const LiveAnnouncer__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type LiveAnnouncer__SvelteComponent_ = ReturnType<typeof LiveAnnouncer__SvelteComponent_>;
/*Ωignore_endΩ*/export default LiveAnnouncer__SvelteComponent_;