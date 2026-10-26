///<reference types="svelte" />
;
import { api, field } from "../api";
import { useAction } from "../load.svelte.ts";
import type { Me } from "../ui";
import { useTitle } from "../ui.svelte.ts";
import { Urls } from "../urls";
import { post } from "./account";

;type $$ComponentProps =  { me: Me | null };function $$render() {

  
  
  
  
  
  

  /**
   * First run (v2 spec: Onboarding): pick a handle and name the first library, both parts of the
   * library's address (H-12), then land on the new library's home, which shows how to connect an
   * agent and waits for its first write.
   */
  let { me }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
  useTitle(() => "Welcome");
  const action = useAction();

  function submit(e: SubmitEvent & { currentTarget: HTMLFormElement }) {
    e.preventDefault();
    const m = me;
    if (!m) return;
    const form = e.currentTarget;
    const handle = field(form, "handle");
    const slug = field(form, "library");
    const starter = new FormData(form).get("starter") === "1";
    void action.run(async () => {
      if (handle.toLowerCase() !== m.handle)
        await post("/api/v1/account/handle", { handle }, "PUT");
      const lib = await api<{ owner: string; slug: string }>("/api/v1/libraries", {
        method: "POST",
        body: JSON.stringify({ slug, starter }),
      });
      // A full load: the header and links follow the new handle.
      location.assign(new Urls(lib.owner, lib.slug).tree(""));
    });
  }
;
async () => {

if(!me){
   { svelteHTML.createElement("p", { "class":`muted`,});  }
}else{
   { svelteHTML.createElement("h1", {});  }
  if(action.error){ { svelteHTML.createElement("div", { "class":`notice`,});action.error; }}
   { svelteHTML.createElement("form", { "onsubmit":submit,});
     { svelteHTML.createElement("p", {});
       { svelteHTML.createElement("label", {});
        
         { svelteHTML.createElement("input", {              "type":`text`,"name":`handle`,"defaultvalue":me.handle,"required":true,"autocapitalize":`off`,"spellcheck":`false`,"aria-describedby":`welcome-handle-hint`,});}
       } { svelteHTML.createElement("span", {   "id":`welcome-handle-hint`,"class":`field-hint`,});
             location.host;    
            
       }
     }
     { svelteHTML.createElement("p", {});
       { svelteHTML.createElement("label", {});
         
         { svelteHTML.createElement("input", {                "type":`text`,"name":`library`,"defaultvalue":`notes`,"required":true,"pattern":"[a-z0-9][a-z0-9\\-]{0,62}","autocapitalize":`off`,"spellcheck":`false`,"aria-describedby":`welcome-library-hint`,});}
       } { svelteHTML.createElement("span", {   "id":`welcome-library-hint`,"class":`field-hint`,});
                  
       }
     }
     { svelteHTML.createElement("p", {});
       { svelteHTML.createElement("label", {});
          { svelteHTML.createElement("input", {      "type":`checkbox`,"name":`starter`,"value":`1`,"defaultchecked":true,});}    
       }
     }
     { svelteHTML.createElement("p", {});
       { svelteHTML.createElement("button", {     "class":`primary`,"type":`submit`,"disabled":action.busy,});  }
     }
   }
}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const Welcome__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type Welcome__SvelteComponent_ = ReturnType<typeof Welcome__SvelteComponent_>;
/*Ωignore_endΩ*/export default Welcome__SvelteComponent_;