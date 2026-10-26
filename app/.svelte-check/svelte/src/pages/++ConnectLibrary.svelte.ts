///<reference types="svelte" />
;
import { byPerson, type LedgerRequest } from "../activity";
import { useAgentNames } from "../agents.svelte.ts";
import { api } from "../api";
import { useFeed, useTrailing } from "../live.svelte.ts";
import { useLoad } from "../load.svelte.ts";
import Moment from "../Moment.svelte";
import { useLibraryLabel, useRole } from "../role.svelte.ts";
import Status from "../Status.svelte";
import { useTitle } from "../ui.svelte.ts";
import type { Urls } from "../urls";
import ConnectSteps from "./ConnectSteps.svelte";

;type $$ComponentProps =  { urls: Urls };function $$render() {

  
  
  
  
  
  
  
  
  
  
  

  /** A library's Connect tab: the steps naming it, and (live) whether an agent has written yet. */
  let { urls }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
  const label = useLibraryLabel(() => urls);
  useTitle(() => `Connect · ${label.current}`);
  const loaded = useLoad(
    () => `connect ${urls.base}`,
    async () => {
      const [recent, stats] = await Promise.all([
        api<{ requests: LedgerRequest[] }>(urls.api("requests", { limit: 50 })),
        api<{ seq: number }>(urls.api("stats")),
      ]);
      // The newest change by an agent, not a person (the rule the home uses too): "waiting for
      // your agent" (v2 spec: Onboarding).
      return { latest: recent.requests.find((r) => !byPerson(r)) ?? null, head: stats.seq };
    },
  );
  // Reloads (debounced) whenever the library changes, and once it loaded, after its head.
  const soon = useTrailing(() => loaded.reload());
  useFeed(
    () => urls,
    () => loaded.data?.head ?? null,
    () => soon(),
    soon,
  );
  const role = useRole(() => urls);
  const names = useAgentNames(() => urls);
;
async () => {

 { svelteHTML.createElement("h1", {});   }
if(role.current && role.current !== "owner"){
   { svelteHTML.createElement("p", {});
       urls.owner;    
    role.current === "write" ? "read and write" : "read and comment";      
              
   }
}
 { const $$_spetStcennoC0C = __sveltets_2_ensureComponent(ConnectSteps); new $$_spetStcennoC0C({ target: __sveltets_2_any(), props: {    "slug":urls.slug,"library":`${urls.owner}/${urls.slug}`,}});}
 { svelteHTML.createElement("h2", {});  }
 { const $$_sutatS0C = __sveltets_2_ensureComponent(Status); const $$_sutatS0 = new $$_sutatS0C({ target: __sveltets_2_any(), props: { "loaded":loaded.current,children:({ latest }) => { async ()/*Ωignore_positionΩ*/ => {
     { svelteHTML.createElement("p", { "id":`status`,});
      if(latest){   names.label(latest.actor, latest.by);  { const $$_tnemoM1C = __sveltets_2_ensureComponent(Moment); new $$_tnemoM1C({ target: __sveltets_2_any(), props: {  "ts":latest.ts,}});}latest.note
          ? `, “${latest.note}”`
          : "";  { svelteHTML.createElement("a", { "href":urls.activity(),});  }}else{        
        }
     }
  };return __sveltets_2_any(0)},}});/*Ωignore_startΩ*/const {children} = $$_sutatS0.$$prop_def;/*Ωignore_endΩ*/
  
 Status}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const ConnectLibrary__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type ConnectLibrary__SvelteComponent_ = ReturnType<typeof ConnectLibrary__SvelteComponent_>;
/*Ωignore_endΩ*/export default ConnectLibrary__SvelteComponent_;