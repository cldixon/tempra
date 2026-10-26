///<reference types="svelte" />
;
import type { Confirming } from "./confirm.svelte.ts";
import Dialog from "./Dialog.svelte";

;type $$ComponentProps =  { asking: Confirming };function $$render() {

  
  

  let { asking }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
  const ask = $derived(asking.ask);
;
async () => {

 { const $$_golaiD0C = __sveltets_2_ensureComponent(Dialog); new $$_golaiD0C({ target: __sveltets_2_any(), props: {     children:() => { return __sveltets_2_any(0); },"title":ask?.title ?? "","open":ask !== null,"onClose":() => asking.close(),}});
  if(ask){
     { svelteHTML.createElement("div", { "class":`confirm-body`,});
      if(typeof ask.body === "string"){ask.body;}else{;__sveltets_2_ensureSnippet(ask.body());}
     }
     { svelteHTML.createElement("p", { "class":`actions`,});
       { svelteHTML.createElement("button", {      "type":`button`,"class":`primary`,"onclick":() => {
          const run = ask.run;
          asking.close();
          run();
        },});ask.action; }
       { svelteHTML.createElement("button", {   "type":`button`,"onclick":() => asking.close(),});  }
     }
  }
 Dialog}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const ConfirmDialog__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type ConfirmDialog__SvelteComponent_ = ReturnType<typeof ConfirmDialog__SvelteComponent_>;
/*Ωignore_endΩ*/export default ConfirmDialog__SvelteComponent_;