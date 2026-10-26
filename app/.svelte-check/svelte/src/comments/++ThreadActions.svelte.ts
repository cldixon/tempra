///<reference types="svelte" />
;
import { api } from "../api";
import { useAction } from "../load.svelte.ts";
import MentionArea from "../MentionArea.svelte";
import { useMentionable } from "../mentions.svelte.ts";
import type { Urls } from "../urls";
import { useComposing } from "./composing.svelte.ts";
import type { Placed } from "./data";

;type $$ComponentProps =  {
    urls: Urls;
    thread: Placed;
    active: boolean;
    writable: boolean;
    onActive(id: string | null): void;
    onChanged(): void;
  };function $$render() {

  
  
  
  
  
  
  

  /** Reply, Resolve, Reopen: what a person can do with an expanded thread. */
  let props:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
  const action = useAction();
  let reply = $state("");
  const people = useMentionable(() => props.urls);
  useComposing(() => reply.trim() !== "");
  const t = $derived(props.thread);
  function act(kind: "reply" | "resolve" | "reopen", e?: Event) {
    e?.preventDefault();
    const body = reply.trim();
    if (kind === "reply" && !body) return;
    void action.run(async () => {
      const suffix = kind === "reply" ? "" : `/${kind}`;
      await api(props.urls.api(`comments/${encodeURIComponent(t.id)}${suffix}`), {
        method: "POST",
        body: JSON.stringify(body ? { body } : {}),
      });
      reply = "";
      // A resolved thread is no longer highlighted: nothing stays active.
      if (kind === "resolve") props.onActive(null);
      props.onChanged();
    });
  }
;
async () => {

if(props.writable){
   { svelteHTML.createElement("form", {    "class":`reply-form`,"onsubmit":(e) => act("reply", e),});if(t.status === "open"){ { svelteHTML.createElement("label", {   "class":`visually-hidden`,"for":`reply-${t.id}`,});  } { const $$_aerAnoitneM1C = __sveltets_2_ensureComponent(MentionArea); new $$_aerAnoitneM1C({ target: __sveltets_2_any(), props: {           "id":`reply-${t.id}`,"value":reply,"onValue":(v) => (reply = v),"people":people.current,"placeholder":`Reply…`,}});}}if(action.error){ { svelteHTML.createElement("div", { "class":`notice`,});action.error; }} { svelteHTML.createElement("div", {  "class":`actions`,});if(t.status === "open"){ { svelteHTML.createElement("button", {     "type":`button`,"disabled":action.busy,"onclick":() => act("resolve"),});  } { svelteHTML.createElement("button", {     "type":`submit`,"class":`primary`,"disabled":action.busy || !reply.trim(),});  }}else{ { svelteHTML.createElement("button", {     "type":`button`,"disabled":action.busy,"onclick":() => act("reopen"),});  }} } }
}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const ThreadActions__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type ThreadActions__SvelteComponent_ = ReturnType<typeof ThreadActions__SvelteComponent_>;
/*Ωignore_endΩ*/export default ThreadActions__SvelteComponent_;