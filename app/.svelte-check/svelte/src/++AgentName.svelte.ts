///<reference types="svelte" />
;
import type { ActorView } from "./agents.svelte.ts";

;type $$ComponentProps =  { who: Pick<ActorView, "name" | "for"> };function $$render() {

  

  /**
   * Who acted, the one way the app names them (TEMPRA-131, X-1): an agent for its person
   * ("Claude Code for @dev"), a person by handle, the signed-in person as "You". Never the raw
   * actor id: the ActorView comes from `useActors` (the library's `GET …/agents`).
   */
  let { who }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
;
async () => {

 { svelteHTML.createElement("span", { "class":`agent-name`,}); { svelteHTML.createElement("b", {});who.name; }if(who.for){ { svelteHTML.createElement("span", { "class":`agent-for`,});  who.for; }} }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const AgentName__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type AgentName__SvelteComponent_ = ReturnType<typeof AgentName__SvelteComponent_>;
/*Ωignore_endΩ*/export default AgentName__SvelteComponent_;