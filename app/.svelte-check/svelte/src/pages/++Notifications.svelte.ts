///<reference types="svelte" />
;
import { api } from "../api";
import { useAction, useLoad } from "../load.svelte.ts";
import Status from "../Status.svelte";
import { useScrollToHash, useTitle } from "../ui.svelte.ts";
import { choice, fromChoice, type MailPrefs, post } from "./account";
function $$render() {

  
  
  
  
  

  /**
   * The Notifications page (take 4, board 04's sidebar): what the person is mailed.
   *
   * What the person is mailed (TEMPRA-74): what is addressed to them, batched, and an opt-in daily
   * digest; each library can follow the account or differ. Every change saves at once.
   */
  useTitle(() => "Notifications");
  const loaded = useLoad(
    () => "mail-prefs",
    () => api<MailPrefs>("/api/v1/account/notifications"),
  );
  // Mail's "Mail settings" link lands here (#notifications).
  useScrollToHash(() => loaded.state === "ready");
  const action = useAction();
  const save = (body: Record<string, unknown>) =>
    action.run(async () => {
      await post("/api/v1/account/notifications", body, "PUT");
      loaded.reload();
    });
  const KINDS = ["immediate", "digest"] as const;
;
async () => {

 { svelteHTML.createElement("h1", {});  }
if(action.error){ { svelteHTML.createElement("div", { "class":`notice`,});action.error; }}
 { const $$_sutatS0C = __sveltets_2_ensureComponent(Status); const $$_sutatS0 = new $$_sutatS0C({ target: __sveltets_2_any(), props: { "loaded":loaded.current,children:(p) => { async ()/*Ωignore_positionΩ*/ => {
    
     { svelteHTML.createElement("p", {});
       { svelteHTML.createElement("label", {});
         { svelteHTML.createElement("input", {         "type":`checkbox`,"checked":p.immediate,"disabled":action.busy,"onchange":(e) => {
            const checked = e.currentTarget.checked;
            e.currentTarget.checked = p.immediate;
            void save({ immediate: checked });
          },});}           
       }
     }
     { svelteHTML.createElement("p", {});
       { svelteHTML.createElement("label", {});
         { svelteHTML.createElement("input", {         "type":`checkbox`,"checked":p.digest,"disabled":action.busy,"onchange":(e) => {
            const checked = e.currentTarget.checked;
            e.currentTarget.checked = p.digest;
            void save({ digest: checked });
          },});}        
       }
     }
    if(p.libraries.length > 0){
       { svelteHTML.createElement("div", { "class":`table-wrap`,});
         { svelteHTML.createElement("table", { "class":`list`,});
           { svelteHTML.createElement("thead", {});
             { svelteHTML.createElement("tr", {});
               { svelteHTML.createElement("th", {});  }
               { svelteHTML.createElement("th", {});  }
               { svelteHTML.createElement("th", {});  }
             }
           }
           { svelteHTML.createElement("tbody", {});
               for(let l of __sveltets_2_ensureArray(p.libraries)){l.library;
               { svelteHTML.createElement("tr", {});
                 { svelteHTML.createElement("td", { "class":`name`,});l.library; }
                   for(let k of __sveltets_2_ensureArray(KINDS)){k;
                   { svelteHTML.createElement("td", {});
                     { svelteHTML.createElement("select", {         "aria-label":`${k === "immediate" ? "Mail" : "Digest"} for ${l.library}`,"value":choice(l[k]),"disabled":action.busy,"onchange":(e) => {
                        const value = e.currentTarget.value;
                        e.currentTarget.value = choice(l[k]);
                        void save({ library: l.library, [k]: fromChoice(value) });
                      },});
                       { svelteHTML.createElement("option", {"value":"",});  p[k] ? "on" : "off";  }
                       { svelteHTML.createElement("option", { "value":`on`,});  }
                       { svelteHTML.createElement("option", { "value":`off`,});  }
                     }
                   }
                }
               }
            }
           }
         }
       }
    }
  };return __sveltets_2_any(0)},}});/*Ωignore_startΩ*/const {children} = $$_sutatS0.$$prop_def;/*Ωignore_endΩ*/
  
 Status}
};
return { props: {} as Record<string, never>, exports: {}, bindings: "", slots: {}, events: {} }}
const Notifications__SvelteComponent_ = __sveltets_2_isomorphic_component(__sveltets_2_with_any_event($$render()));
/*Ωignore_startΩ*/type Notifications__SvelteComponent_ = InstanceType<typeof Notifications__SvelteComponent_>;
/*Ωignore_endΩ*/export default Notifications__SvelteComponent_;