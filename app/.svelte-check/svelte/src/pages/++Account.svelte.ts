///<reference types="svelte" />
;
import { untrack } from "svelte";
import { api, field } from "../api";
import ConfirmDialog from "../ConfirmDialog.svelte";
import { useConfirm } from "../confirm.svelte.ts";
import { useAction, useLoad } from "../load.svelte.ts";
import Moment from "../Moment.svelte";
import Status from "../Status.svelte";
import ThemeChoice from "../ThemeChoice.svelte";
import { useTheme } from "../theme.svelte.ts";
import { localTime } from "../ui";
import { useTitle } from "../ui.svelte.ts";
import { type AccountData, DONE, LEGAL, post } from "./account";

;type $$ComponentProps =  { done: string | null };function $$render() {
  const handleBody/*Ωignore_positionΩ*/ = ()/*Ωignore_startΩ*/: ReturnType<import('svelte').Snippet>/*Ωignore_endΩ*/ => { async ()/*Ωignore_positionΩ*/ => {
   { svelteHTML.createElement("p", {});
               renaming.handle;    
       
   }
   { svelteHTML.createElement("p", {}); renaming.current;           }
};return __sveltets_2_any(0)};
  
  
  
  
  
  
  
  
  
  
  
  

  /** The account: email, handle, limits, sessions, deleting it (v2 spec: Accounts). */
  let { done }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
  useTitle(() => "Account");
  const loaded = useLoad(
    () => "account",
    () => api<AccountData>("/api/v1/account"),
  );
  const action = useAction();
  // The page opened from a link that says what was done (`?done=`): said once, as React's initial state was.
  let notice = $state<string | null>(untrack(() => (done ? (DONE[done] ?? null) : null)));
  let devLink = $state<string | null>(null);
  let deleted = $state(false);
  const c = useConfirm();
  /** The theme (take 4): System, Light or Dark, applied at once and saved on the account. */
  const theme = useTheme();
  /** The handle a confirmation is about: the new one and the one it replaces. */
  let renaming = $state.raw<{ handle: string; current: string }>({ handle: "", current: "" });

  function changeEmail(e: SubmitEvent & { currentTarget: HTMLFormElement }) {
    e.preventDefault();
    const email = field(e.currentTarget, "email");
    void action.run(async () => {
      const res = await api<{ sent_to: string; dev_link?: string }>("/api/v1/account/email", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      notice = `Check ${res.sent_to} for a link, and open it while signed in as you are now.`;
      devLink = res.dev_link ?? null;
    });
  }
  function changeHandle(e: SubmitEvent & { currentTarget: HTMLFormElement }, current: string) {
    e.preventDefault();
    const handle = field(e.currentTarget, "handle").replace(/^@/, "");
    if (handle.toLowerCase() === current.toLowerCase()) return;
    renaming = { handle, current };
    c.confirm({
      title: `Change your handle to @${handle}?`,
      body: handleBody,
      action: "Change handle",
      run: () =>
        action.run(async () => {
          await post("/api/v1/account/handle", { handle }, "PUT");
          // A full load: the header and every library link follow the new handle.
          location.assign("/account");
        }),
    });
  }
  const endSession = (id: string) =>
    action.run(async () => {
      await api(`/api/v1/account/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
      loaded.reload();
    });
  function remove(e: SubmitEvent & { currentTarget: HTMLFormElement }) {
    e.preventDefault();
    const confirm = field(e.currentTarget, "confirm");
    void action.run(async () => {
      await post("/api/v1/account/delete", { confirm });
      deleted = true;
    });
  }
;
async () => {



if(deleted){
   { svelteHTML.createElement("h1", {});  }
   { svelteHTML.createElement("p", {});
     { svelteHTML.createElement("a", { "href":LEGAL,});  }
   }
}else{
   { svelteHTML.createElement("h1", {});  }
   { const $$_golaiDmrifnoC0C = __sveltets_2_ensureComponent(ConfirmDialog); new $$_golaiDmrifnoC0C({ target: __sveltets_2_any(), props: {  "asking":c,}});}
  if(notice){ { svelteHTML.createElement("div", { "class":`notice ok`,});notice; }}
  if(devLink){
     { svelteHTML.createElement("p", {});
            { svelteHTML.createElement("a", {   "id":`dev-link`,"href":devLink,});    }
     }
  }
  if(action.error){ { svelteHTML.createElement("div", { "class":`notice`,});action.error; }}
   { const $$_sutatS0C = __sveltets_2_ensureComponent(Status); const $$_sutatS0 = new $$_sutatS0C({ target: __sveltets_2_any(), props: { "loaded":loaded.current,children:(a) => { async ()/*Ωignore_positionΩ*/ => {
       { svelteHTML.createElement("form", { "onsubmit":changeEmail,});
         { svelteHTML.createElement("p", {});
           { svelteHTML.createElement("label", {});
            
              { svelteHTML.createElement("input", {        "type":`email`,"name":`email`,"autocomplete":`email`,"defaultvalue":a.email,"required":true,});}
           }
           { svelteHTML.createElement("button", {   "type":`submit`,"disabled":action.busy,});  }
         }
       }
       { svelteHTML.createElement("form", { "onsubmit":(e) => changeHandle(e, a.handle),});
         { svelteHTML.createElement("p", {});
           { svelteHTML.createElement("label", {});
               { svelteHTML.createElement("input", {      "type":`text`,"name":`handle`,"defaultvalue":a.handle,"required":true,});}
           }
           { svelteHTML.createElement("button", {   "type":`submit`,"disabled":action.busy,});  }
         }
       }
       { svelteHTML.createElement("p", { "class":`small muted`,});       }
       { svelteHTML.createElement("h2", {});  }
       { svelteHTML.createElement("p", {});
         a.usage.libraries;  a.limits.libraries;  
        a.usage.tokens;  a.limits.tokens;
       }
       { svelteHTML.createElement("h2", {});  }
       { svelteHTML.createElement("p", { "class":`field-row`,});
         { svelteHTML.createElement("span", {});  } { const $$_eciohCemehT1C = __sveltets_2_ensureComponent(ThemeChoice); new $$_eciohCemehT1C({ target: __sveltets_2_any(), props: {    "value":theme.current,"onChange":theme.choose,}});}
       }
       { svelteHTML.createElement("h2", {});  }
       { svelteHTML.createElement("div", { "class":`table-wrap`,});
         { svelteHTML.createElement("table", { "class":`list`,});
           { svelteHTML.createElement("thead", {});
             { svelteHTML.createElement("tr", {});
               { svelteHTML.createElement("th", {});  }
               { svelteHTML.createElement("th", {});  }
               { svelteHTML.createElement("th", {});  }
               { svelteHTML.createElement("th", {});
                 { svelteHTML.createElement("span", { "class":`visually-hidden`,});  }
               }
             }
           }
           { svelteHTML.createElement("tbody", {});
               for(let s of __sveltets_2_ensureArray(a.sessions)){s.id;
               { svelteHTML.createElement("tr", {});
                 { svelteHTML.createElement("td", { "class":`when`,});localTime(s.created); }
                 { svelteHTML.createElement("td", { "class":`when`,});
                   { const $$_tnemoM5C = __sveltets_2_ensureComponent(Moment); new $$_tnemoM5C({ target: __sveltets_2_any(), props: {  "ts":s.last_seen,}});}
                 }
                 { svelteHTML.createElement("td", { "class":`small muted`,});s.user_agent ?? ""; }
                 { svelteHTML.createElement("td", {});
                  if(s.current){ }else{ { svelteHTML.createElement("button", {      "type":`button`,"disabled":action.busy,"onclick":() => void endSession(s.id),});  }}
                 }
               }
            }
           }
         }
       }
      
       { svelteHTML.createElement("div", { "class":`actions`,});
         { svelteHTML.createElement("form", {   "method":`post`,"action":`/sign-out`,});
           { svelteHTML.createElement("button", { "type":`submit`,});  }
         }
         { svelteHTML.createElement("form", {   "method":`post`,"action":`/sign-out/everywhere`,});
           { svelteHTML.createElement("button", { "type":`submit`,});   }
         }
       }
       { svelteHTML.createElement("h2", {});  }
       { svelteHTML.createElement("p", {});        }
       { svelteHTML.createElement("form", { "onsubmit":remove,});
         { svelteHTML.createElement("p", {});
           { svelteHTML.createElement("label", {});
             a.handle;  
              { svelteHTML.createElement("input", {      "type":`text`,"name":`confirm`,"autocomplete":`off`,"required":true,});}
           }
         }
         { svelteHTML.createElement("p", {});
           { svelteHTML.createElement("button", {   "type":`submit`,"disabled":action.busy,});  }
         }
       }
       { svelteHTML.createElement("p", {});
         { svelteHTML.createElement("a", { "href":`${LEGAL}/terms`,});  }   { svelteHTML.createElement("a", { "href":`${LEGAL}/privacy`,});  }
       }
    };return __sveltets_2_any(0)},}});/*Ωignore_startΩ*/const {children} = $$_sutatS0.$$prop_def;/*Ωignore_endΩ*/
    
   Status}
}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const Account__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type Account__SvelteComponent_ = ReturnType<typeof Account__SvelteComponent_>;
/*Ωignore_endΩ*/export default Account__SvelteComponent_;