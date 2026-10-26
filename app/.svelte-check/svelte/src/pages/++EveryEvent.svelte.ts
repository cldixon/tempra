///<reference types="svelte" />
;
import { eventRows, type LedgerRequest } from "../activity";
import { useActors } from "../agents.svelte.ts";
import { useRole } from "../role.svelte.ts";
import { plural } from "../ui";
import type { Urls, Who } from "../urls";
import EventLine from "./EventLine.svelte";

;type $$ComponentProps =  {
    urls: Urls;
    me: string;
    requests: LedgerRequest[];
    empty: boolean;
    filter: { who?: Who; kind?: string; q?: string };
    /** Older requests are still to load ("Older"). */
    more: boolean;
    /** Whether the event with this seq is an agent's fresh write (read against `now`). */
    pulses(seq: number): boolean;
    now: number;
  };function $$render() {

  
  
  
  
  
  

  /**
   * Every event: the ledger as a table, newest first. Who and when are named on a request's first
   * row; a row an agent's fresh write made carries the pulsing dot. A request's first row links its revert for those who may write.
   */
  let {
    urls,
    me,
    requests,
    empty,
    filter,
    more,
    pulses,
    now,
  }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();

  const actors = useActors(
    () => urls,
    () => me || null,
  );
  const role = useRole(() => urls);
  const rows = $derived(eventRows(requests, filter));
  // Who (Agents, People), the kind and the text filter what is loaded, not the whole ledger: say
  // so while older requests remain, and "Older" pages on.
  const partial = $derived(
    more &&
      (Boolean(filter.kind) ||
        Boolean(filter.q) ||
        (filter.who !== undefined && filter.who !== "everyone")),
  );
  const scope = $derived(`in the latest ${plural(requests.length, "request")}`);
;
async () => {

if(rows.length === 0){
   { svelteHTML.createElement("p", { "class":`view-empty`,});
    empty ? "Nothing has happened here yet." : partial ? `No events match ${scope}.` : "No events match.";
   }
}else{
  if(partial){
     { svelteHTML.createElement("p", { "class":`view-meta events-scope`,});  scope; }
  }
   { svelteHTML.createElement("div", { "class":`table-wrap`,});
     { svelteHTML.createElement("table", { "class":`events-table`,});
       { svelteHTML.createElement("thead", {});
         { svelteHTML.createElement("tr", {});
           { svelteHTML.createElement("th", { "scope":`col`,});  }
           { svelteHTML.createElement("th", { "scope":`col`,});  }
           { svelteHTML.createElement("th", { "scope":`col`,});  }
           { svelteHTML.createElement("th", { "scope":`col`,});  }
           { svelteHTML.createElement("th", { "scope":`col`,});   }
         }
       }
       { svelteHTML.createElement("tbody", {});
           for(let row of __sveltets_2_ensureArray(rows)){row.event.seq;
           { const $$_eniLtnevE3C = __sveltets_2_ensureComponent(EventLine); new $$_eniLtnevE3C({ target: __sveltets_2_any(), props: {          row,urls,"actor":actors.view(row.request.actor, row.request.by),"live":pulses(row.event.seq),"revert":row.lead &&
              role.current === "owner" &&
              row.request.events.some((e) => e.op !== "verify" && e.op !== "comment"),now,}});}
        }
       }
     }
   }
}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const EveryEvent__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type EveryEvent__SvelteComponent_ = ReturnType<typeof EveryEvent__SvelteComponent_>;
/*Ωignore_endΩ*/export default EveryEvent__SvelteComponent_;