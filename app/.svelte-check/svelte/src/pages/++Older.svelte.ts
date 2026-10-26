///<reference types="svelte" />
;
import type { Snippet } from "svelte";
import { type LedgerRequest, REQUESTS_PAGE, type RequestPage } from "../activity";
import { api } from "../api";
import type { Urls } from "../urls";

;type $$ComponentProps =  {
    urls: Urls;
    prefix: string;
    actor: string;
    first: RequestPage;
    /** The requests loaded so far, and whether there are older ones to page to. */
    children: Snippet<[LedgerRequest[], boolean]>;
  };function $$render() {

  
  
  
  

  /**
   * The first page and the older ones "Older" pages back to, as one list of requests (both views
   * draw from it). Keyed by the server's filters (`{#key}` in Activity), so changing them starts
   * afresh.
   */
  let {
    urls,
    prefix,
    actor,
    first,
    children,
  }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();

  let older = $state.raw<RequestPage>({ requests: [], next: null });
  let paging = $state(false);
  const next = $derived(older.requests.length > 0 ? older.next : first.next);
  const requests = $derived([...first.requests, ...older.requests]);

  function loadOlder() {
    if (next === null) return;
    paging = true;
    api<RequestPage>(
      urls.api("requests", {
        prefix: prefix || undefined,
        actor: actor || undefined,
        before: next,
        limit: REQUESTS_PAGE,
      }),
    )
      .then((p) => {
        older = { requests: [...older.requests, ...p.requests], next: p.next };
      })
      .catch(() => {})
      .finally(() => {
        paging = false;
      });
  }
;
async () => {

;__sveltets_2_ensureSnippet(children(requests, next !== null));
if(next !== null){
   { svelteHTML.createElement("p", { "class":`view-more`,});
     { svelteHTML.createElement("button", {     "type":`button`,"onclick":loadOlder,"disabled":paging,});paging ? "Loading…" : "Older"; }
   }
}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const Older__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type Older__SvelteComponent_ = ReturnType<typeof Older__SvelteComponent_>;
/*Ωignore_endΩ*/export default Older__SvelteComponent_;