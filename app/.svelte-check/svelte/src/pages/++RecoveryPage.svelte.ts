///<reference types="svelte" />
;
import type { LedgerRequest } from "../activity";
import { useAgentNames } from "../agents.svelte.ts";
import { api, field } from "../api";
import ConfirmDialog from "../ConfirmDialog.svelte";
import { useConfirm } from "../confirm.svelte.ts";
import { useAction, useLoad } from "../load.svelte.ts";
import Moment from "../Moment.svelte";
import Status from "../Status.svelte";
import { localTime, plural } from "../ui";
import { useMe } from "../ui.svelte.ts";
import type { Urls } from "../urls";
import { json, type RestoreRow, restoreTime } from "./manage";

;type $$ComponentProps =  { urls: Urls };function $$render() {
  const restoreBody/*Ωignore_positionΩ*/ = ()/*Ωignore_startΩ*/: ReturnType<import('svelte').Snippet>/*Ωignore_endΩ*/ => { async ()/*Ωignore_positionΩ*/ => {
   { svelteHTML.createElement("p", {});
             localTime(restoreTo);       
         
   }
};return __sveltets_2_any(0)};  const undoBody/*Ωignore_positionΩ*/ = ()/*Ωignore_startΩ*/: ReturnType<import('svelte').Snippet>/*Ωignore_endΩ*/ => { async ()/*Ωignore_positionΩ*/ => {
   { svelteHTML.createElement("p", {});            }
};return __sveltets_2_any(0)}; const nightlyLinks/*Ωignore_positionΩ*/ = (date: string)/*Ωignore_startΩ*/: ReturnType<import('svelte').Snippet>/*Ωignore_endΩ*/ => { async ()/*Ωignore_positionΩ*/ => {
   { svelteHTML.createElement("a", { "href":urls.nightly(date, "bundle.tar"),});  } 
   { svelteHTML.createElement("a", { "href":urls.nightly(date, "ledger.jsonl"),});  }
};return __sveltets_2_any(0)};
  
  
  
  
  
  
  
  
  
  
  
  

  let { urls }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
  const loaded = useLoad(
    () => `recovery ${urls.base}`,
    async () => {
      const [recent, restores] = await Promise.all([
        api<{ requests: LedgerRequest[] }>(urls.api("requests", { limit: 10 })),
        api<{ restores: RestoreRow[] }>(urls.api("restores")),
      ]);
      return { recent: recent.requests, restores: restores.restores };
    },
  );
  /** "you" for the signed-in person, an agent by its name, another person by their handle. */
  const me = useMe();
  const names = useAgentNames(() => urls);
  const name = (actor: string, by?: LedgerRequest["by"]) =>
    me.current && actor === me.current.actor && !by?.agent ? "you" : names.label(actor, by);
  const action = useAction();
  const c = useConfirm();
  /** What the last action did: a line, or the moment a restore went back to. */
  let result = $state.raw<string | { restored: string } | null>(null);
  /** The moment a confirmation is about. */
  let restoreTo = $state("");

  function restore(e: SubmitEvent & { currentTarget: HTMLFormElement }) {
    e.preventDefault();
    const raw = field(e.currentTarget, "to");
    // The field is the person's local time; the server takes an ISO moment.
    const at = new Date(raw);
    if (Number.isNaN(at.getTime())) {
      action.setError("Choose a date and time.");
      return;
    }
    const to = at.toISOString();
    restoreTo = to;
    c.confirm({
      title: "Restore this library?",
      body: restoreBody,
      action: "Restore",
      run: () =>
        action.run(async () => {
          result = null;
          const r = await api<RestoreRow>(urls.api("restore"), json({ to }));
          result = { restored: r.to };
          loaded.reload();
        }),
    });
  }
  const undo = (r: RestoreRow) =>
    c.confirm({
      title: "Undo this restore?",
      body: undoBody,
      action: "Undo restore",
      run: () =>
        action.run(async () => {
          result = null;
          await api(urls.api("restore"), json({ undo: r.id }));
          result = "Undone: the library is back to how it was before that restore.";
          loaded.reload();
        }),
    });
;
async () => {







 { svelteHTML.createElement("h1", {});  }
 { const $$_golaiDmrifnoC0C = __sveltets_2_ensureComponent(ConfirmDialog); new $$_golaiDmrifnoC0C({ target: __sveltets_2_any(), props: {  "asking":c,}});}
if(result){
   { svelteHTML.createElement("div", { "class":`notice ok`,});
    if(typeof result === "string"){result;}else{  localTime(result.restored);     
          }
   }
}
if(action.error){ { svelteHTML.createElement("div", { "class":`notice`,});action.error; }}
 { const $$_sutatS0C = __sveltets_2_ensureComponent(Status); const $$_sutatS0 = new $$_sutatS0C({ target: __sveltets_2_any(), props: { "loaded":loaded.current,children:({ recent, restores }) => { async ()/*Ωignore_positionΩ*/ => {
     { svelteHTML.createElement("div", { "class":`panel-box`,});
       { svelteHTML.createElement("h2", {});        }
       { svelteHTML.createElement("p", {});
                          
                        
         { svelteHTML.createElement("a", { "href":urls.activity({ view: "events" }),});   }
       }
       { svelteHTML.createElement("form", { "onsubmit":restore,});
         { svelteHTML.createElement("p", {});
           { svelteHTML.createElement("label", { "class":`small`,});
                
              { svelteHTML.createElement("input", {      "type":`datetime-local`,"name":`to`,"step":1,"required":true,});}
           }
         }
         { svelteHTML.createElement("button", {     "class":`primary`,"type":`submit`,"disabled":action.busy,});  }
       }
      if(recent.length > 0){
         { svelteHTML.createElement("h2", {});  }
         { svelteHTML.createElement("ul", { "class":`small`,});
             for(let r of __sveltets_2_ensureArray(recent)){r.request_id;
             { svelteHTML.createElement("li", {});
               { svelteHTML.createElement("span", {   "class":`muted`,"title":localTime(r.ts),});localTime(r.ts); }
              name(r.actor, r.by);r.note ? `: ${r.note}` : "";
               { svelteHTML.createElement("span", { "class":`muted`,}); plural(r.events.length, "change");  }
             }
          }
         }
      }
     }
     { svelteHTML.createElement("div", { "class":`panel-box`,});
       { svelteHTML.createElement("h2", {});  }
      if(restores.length === 0){
         { svelteHTML.createElement("p", {});  }
      }else{
         { svelteHTML.createElement("div", { "class":`table-wrap`,});
           { svelteHTML.createElement("table", { "class":`list`,});
             { svelteHTML.createElement("thead", { "class":`visually-hidden`,});
               { svelteHTML.createElement("tr", {});
                 { svelteHTML.createElement("th", {});  }
                 { svelteHTML.createElement("th", {});    }
                 { svelteHTML.createElement("th", {});  }
               }
             }
             { svelteHTML.createElement("tbody", {});
                 for(let r of __sveltets_2_ensureArray(restores)){r.id;
                 { svelteHTML.createElement("tr", {});
                   { svelteHTML.createElement("td", { }); { svelteHTML.createElement("strong", { });r.kind === "undo"
                        ? `Undid the restore made ${localTime(r.undoes ? restoreTime(r.undoes) : r.to)}`
                        : `Restored to ${localTime(r.to)}`; } { svelteHTML.createElement("div", { "class":`small muted`,}); { const $$_tnemoM7C = __sveltets_2_ensureComponent(Moment); new $$_tnemoM7C({ target: __sveltets_2_any(), props: {  "ts":r.requested_at,}});}  name(r.actor); } }
                   { svelteHTML.createElement("td", { "class":`small`,});
                      ;__sveltets_2_ensureSnippet(nightlyLinks(r.export.split("/").at(-2) ?? ""));
                   }
                   { svelteHTML.createElement("td", {});
                     { svelteHTML.createElement("button", {     "type":`button`,"disabled":action.busy,"onclick":() => undo(r),});  }
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
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const RecoveryPage__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type RecoveryPage__SvelteComponent_ = ReturnType<typeof RecoveryPage__SvelteComponent_>;
/*Ωignore_endΩ*/export default RecoveryPage__SvelteComponent_;