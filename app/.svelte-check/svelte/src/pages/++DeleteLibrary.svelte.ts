///<reference types="svelte" />
;
import { api, field } from "../api";
import { useAction } from "../load.svelte.ts";
import { useLibraryLabel } from "../role.svelte.ts";
import { useTitle } from "../ui.svelte.ts";
import type { Urls } from "../urls";
import { json } from "./manage";
import OwnerOnly from "./OwnerOnly.svelte";

;type $$ComponentProps =  { urls: Urls };function $$render() {

  
  
  
  
  
  
  

  /** Deleting the library, typing its name (v2 spec: Accounts; owner only). */
  let { urls }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
  const label = useLibraryLabel(() => urls);
  useTitle(() => `Delete · ${label.current}`);
  const action = useAction();

  function submit(e: SubmitEvent & { currentTarget: HTMLFormElement }) {
    e.preventDefault();
    const confirm = field(e.currentTarget, "confirm");
    void action.run(async () => {
      if (confirm !== urls.slug) throw new Error(`Type ${urls.slug} to confirm.`);
      await api(urls.api("delete"), json({ confirm }));
      // A full load: the library list, or first run if it was the last one.
      location.assign("/");
    });
  }
;
async () => {

 { const $$_ylnOrenwO0C = __sveltets_2_ensureComponent(OwnerOnly); new $$_ylnOrenwO0C({ target: __sveltets_2_any(), props: {children:() => { return __sveltets_2_any(0); },urls,}});
   { svelteHTML.createElement("h1", {}); label.current; }
  if(action.error){ { svelteHTML.createElement("div", { "class":`notice`,});action.error; }}
   { svelteHTML.createElement("p", {});
             
     { svelteHTML.createElement("a", { "href":urls.exportTar(),});   }
   }
   { svelteHTML.createElement("form", { "onsubmit":submit,});
     { svelteHTML.createElement("p", {});
       { svelteHTML.createElement("label", {});
         urls.slug;  
          { svelteHTML.createElement("input", {      "type":`text`,"name":`confirm`,"autocomplete":`off`,"required":true,});}
       }
     }
     { svelteHTML.createElement("p", {});
       { svelteHTML.createElement("button", {   "type":`submit`,"disabled":action.busy,});  }
     }
   }
 OwnerOnly}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const DeleteLibrary__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type DeleteLibrary__SvelteComponent_ = ReturnType<typeof DeleteLibrary__SvelteComponent_>;
/*Ωignore_endΩ*/export default DeleteLibrary__SvelteComponent_;