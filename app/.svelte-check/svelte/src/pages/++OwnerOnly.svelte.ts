///<reference types="svelte" />
;
import type { Snippet } from "svelte";
import { useRole } from "../role.svelte.ts";
import type { Urls } from "../urls";

;type $$ComponentProps =  { urls: Urls; children: Snippet };function $$render() {

  
  
  

  /**
   * The owner's recovery tools (Import, Recovery, Revert, Restore; tempra-dev:
   * decisions/read-and-comment-only, its one exception): nothing until the role is known, and a
   * plain line for anyone else.
   */
  let { urls, children }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
  const role = useRole(() => urls);
;
async () => {

if(role.current === null){
   { svelteHTML.createElement("p", { "class":`muted`,});  }
} else if (role.current !== "owner"){
   { svelteHTML.createElement("h1", {});  }
   { svelteHTML.createElement("p", {}); urls.owner;       }
}else{
  ;__sveltets_2_ensureSnippet(children());
}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const OwnerOnly__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type OwnerOnly__SvelteComponent_ = ReturnType<typeof OwnerOnly__SvelteComponent_>;
/*Ωignore_endΩ*/export default OwnerOnly__SvelteComponent_;