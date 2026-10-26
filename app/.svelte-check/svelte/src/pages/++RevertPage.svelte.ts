///<reference types="svelte" />
;
import { type LedgerRequest, touchedBy } from "../activity";
import { useTitles } from "../activity.svelte.ts";
import { useAgentNames } from "../agents.svelte.ts";
import { api, field } from "../api";
import { useAction, useLoad } from "../load.svelte.ts";
import Moment from "../Moment.svelte";
import { navigate } from "../router";
import Status from "../Status.svelte";
import { useMe } from "../ui.svelte.ts";
import type { Urls } from "../urls";
import { folderOf, json, WHAT_WORDS } from "./manage";

;type $$ComponentProps =  { urls: Urls; request: string };function $$render() {

  
  
  
  
  
  
  
  
  
  
  

  let { urls, request }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
  const loaded = useLoad(
    () => `revert ${urls.revert(request)}`,
    () => api<LedgerRequest>(urls.api(`requests/${encodeURIComponent(request)}`)),
  );
  const titles = useTitles(() => urls);
  /** "you" for the signed-in person, an agent by its name, another person by their handle. */
  const me = useMe();
  const names = useAgentNames(() => urls);
  const name = (actor: string, by?: LedgerRequest["by"]) =>
    me.current && actor === me.current.actor && !by?.agent ? "you" : names.label(actor, by);
  const action = useAction();

  function submit(e: SubmitEvent & { currentTarget: HTMLFormElement }) {
    e.preventDefault();
    const note = field(e.currentTarget, "note");
    void action.run(async () => {
      const res = await api<{ results: unknown[] }>(
        urls.api("revert"),
        json({ request_id: request, note }),
      );
      navigate(`${urls.ledger()}?done=revert&n=${res.results.length}`);
    });
  }
;
async () => {

 { const $$_sutatS0C = __sveltets_2_ensureComponent(Status); const $$_sutatS0 = new $$_sutatS0C({ target: __sveltets_2_any(), props: { "loaded":loaded.current,children:(r) => { async ()/*Ωignore_positionΩ*/ => {
    const touched = touchedBy(r.events, titles.data?.titles ?? {});
     { svelteHTML.createElement("h1", {});   }
     { svelteHTML.createElement("p", {});
       name(r.actor, r.by);  { const $$_tnemoM1C = __sveltets_2_ensureComponent(Moment); new $$_tnemoM1C({ target: __sveltets_2_any(), props: {  "ts":r.ts,}});}r.note ? `: ${r.note}` : "";
     }
     { svelteHTML.createElement("ul", { "class":`events`,});
         for(let t of __sveltets_2_ensureArray(touched)){t.path;
         { svelteHTML.createElement("li", {});
          WHAT_WORDS[t.what];
           { svelteHTML.createElement("a", {  "href":t.what === "deleted" ? urls.pinned(t.seq - 1).file(t.path) : urls.since(t.path, t.seq),});t.title; }if(t.from){ { svelteHTML.createElement("span", { "class":`muted`,});` from ${folderOf(t.from)}`; }}
         }
      }
     }
     { svelteHTML.createElement("div", { "class":`panel-box`,});
       { svelteHTML.createElement("p", {});              }
      if(action.error){ { svelteHTML.createElement("div", { "class":`notice`,});action.error; }}
       { svelteHTML.createElement("form", { "onsubmit":submit,});
         { svelteHTML.createElement("label", {});
          
           { svelteHTML.createElement("input", {      "type":`text`,"name":`note`,"defaultvalue":`Revert: ${r.note ?? "a change"}`,});}
         }
         { svelteHTML.createElement("p", { "class":`actions`,});
           { svelteHTML.createElement("button", {     "class":`primary`,"type":`submit`,"disabled":action.busy,});  } { svelteHTML.createElement("a", {    "class":`button`,"href":urls.activity({ view: "events" }),});  }
         }
       }
     }
  };return __sveltets_2_any(0)},}});/*Ωignore_startΩ*/const {children} = $$_sutatS0.$$prop_def;/*Ωignore_endΩ*/
  
 Status}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const RevertPage__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type RevertPage__SvelteComponent_ = ReturnType<typeof RevertPage__SvelteComponent_>;
/*Ωignore_endΩ*/export default RevertPage__SvelteComponent_;