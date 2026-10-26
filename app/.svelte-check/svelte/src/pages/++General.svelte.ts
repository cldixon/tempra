///<reference types="svelte" />
;
import { api, field } from "../api";
import { useAction } from "../load.svelte.ts";
import { librariesChanged } from "../role";
import { useLibraries, useLibraryLabel, useRole } from "../role.svelte.ts";
import { navigate } from "../router";
import { useTitle } from "../ui.svelte.ts";
import type { Urls } from "../urls";

;type $$ComponentProps =  { urls: Urls };function $$render() {

  
  
  
  
  
  
  

  /**
   * General (take 4's first settings tab; TEMPRA-102): the library's title and description, which
   * the owner edits under the limits create_library enforces; a write member reads them. A read
   * member's settings are Members alone, so General sends them there.
   */
  let { urls }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
  const label = useLibraryLabel(() => urls);
  useTitle(() => `General · ${label.current}`);
  const libs = useLibraries();
  const role = useRole(() => urls);
  const action = useAction();
  let notice = $state<string | null>(null);
  $effect(() => {
    if (role.current === "read") navigate(urls.members(), { replace: true });
  });
  const lib = $derived(
    libs.data?.libraries.find((l) => l.owner === urls.owner && l.slug === urls.slug),
  );

  function save(e: SubmitEvent & { currentTarget: HTMLFormElement }) {
    e.preventDefault();
    const form = e.currentTarget;
    const title = field(form, "title").trim();
    const description = field(form, "description").trim();
    void action.run(async () => {
      await api(urls.apiRoot(), {
        method: "PATCH",
        body: JSON.stringify({ title: title || null, description: description || null }),
      });
      notice = "Saved.";
      librariesChanged();
    });
  }
;
async () => {

if(role.current === null || role.current === "read"){
   { svelteHTML.createElement("p", { "class":`muted`,});  }
}else{
   { svelteHTML.createElement("h1", {});  }
  if(notice){ { svelteHTML.createElement("div", { "class":`notice ok`,});notice; }}
  if(action.error){ { svelteHTML.createElement("div", { "class":`notice`,});action.error; }}
  if(role.current === "owner"){
    `${lib?.title}|${lib?.description}`; {
       { svelteHTML.createElement("form", {   "class":`stack`,"onsubmit":save,});
         { svelteHTML.createElement("p", { "class":`field`,});
           { svelteHTML.createElement("label", { "for":`library-title`,});  } { svelteHTML.createElement("input", {             "id":`library-title`,"name":`title`,"type":`text`,"maxlength":120,"defaultvalue":lib?.title ?? "","placeholder":urls.slug,});}
         }
         { svelteHTML.createElement("p", { "class":`field`,});
           { svelteHTML.createElement("label", { "for":`library-description`,});  } { svelteHTML.createElement("input", {             "id":`library-description`,"name":`description`,"type":`text`,"maxlength":300,"defaultvalue":lib?.description ?? "","placeholder":`What this library is for, in one line`,});}
         }
         { svelteHTML.createElement("p", { "class":`small muted`,});    urls.owner; urls.slug;  }
         { svelteHTML.createElement("p", {});
           { svelteHTML.createElement("button", {     "type":`submit`,"class":`primary`,"disabled":action.busy,});  }
         }
       }
    }
  }else{
     { svelteHTML.createElement("dl", { "class":`facts`,});
       { svelteHTML.createElement("dt", {});  }
       { svelteHTML.createElement("dd", {});if((lib?.title ?? null) !== null){lib?.title;}else{ { svelteHTML.createElement("span", { "class":`muted`,});urls.slug; }} }
       { svelteHTML.createElement("dt", {});  }
       { svelteHTML.createElement("dd", {});
        if((lib?.description ?? null) !== null){lib?.description;}else{ { svelteHTML.createElement("span", { "class":`muted`,});  }}
       }
       { svelteHTML.createElement("dt", {});  }
       { svelteHTML.createElement("dd", {});urls.owner; urls.slug; }
     }
  }
}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const General__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type General__SvelteComponent_ = ReturnType<typeof General__SvelteComponent_>;
/*Ωignore_endΩ*/export default General__SvelteComponent_;