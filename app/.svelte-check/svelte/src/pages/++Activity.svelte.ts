///<reference types="svelte" />
;
import { REQUESTS_PAGE, type RequestPage } from "../activity";
import { useLiveWrites, useTitles } from "../activity.svelte.ts";
import { api } from "../api";
import Icon from "../Icon.svelte";
import { useFeed, useTrailing } from "../live.svelte.ts";
import { useLoad } from "../load.svelte.ts";
import PageColumn from "../PageColumn.svelte";
import { useLibraryLabel } from "../role.svelte.ts";
import { type Done, navigate } from "../router";
import Status from "../Status.svelte";
import { plural } from "../ui";
import { useTitle } from "../ui.svelte.ts";
import type { ActivityFilters, Urls } from "../urls";
import EventFilters from "./EventFilters.svelte";
import EveryEvent from "./EveryEvent.svelte";
import Older from "./Older.svelte";
import Summary from "./Summary.svelte";
import WhoFilter from "./WhoFilter.svelte";

;type $$ComponentProps =  { urls: Urls; actor: string; filters: ActivityFilters; done?: Done };function $$render() {

  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  

  /**
   * Activity (take 4, TEMPRA-115; tempra-dev: app/activity, decisions/three-activity-surfaces):
   * what happened in the library, in two views under one switch. The Summary (the default) tells
   * each request as a sentence, grouped by day, with an agent writing now as a live entry at the
   * top; Every event is the ledger as a table, with Download. `-/ledger` opens Every event. Both
   * follow the change feed. Nothing is marked "new since you looked" (TEMPRA-173): a person comes
   * here to look, and is not kept count of.
   * The view and filters are in the URL, so a view can be linked and back and forward restore it.
   */
  let {
    urls,
    actor,
    filters,
    done = null,
  }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();

  const label = useLibraryLabel(() => urls);
  useTitle(() => `Activity · ${label.current}`);
  const view = $derived(filters.view === "events" ? "events" : "summary");
  const prefix = $derived(filters.prefix ?? "");
  const exact = $derived(filters.actor ?? "");
  // Switching the view is a move of its own (back returns to the other); filters replace.
  const go = (change: ActivityFilters, replace = true) =>
    navigate(
      view === "events" && change.view === undefined && location.pathname.endsWith("/-/ledger")
        ? urls.ledger({ ...filters, ...change })
        : urls.activity({ ...filters, view, ...change }),
      { replace },
    );
  const titles = useTitles(() => urls);
  const key = $derived(`activity ${urls.base} ${prefix} ${exact}`);
  const loaded = useLoad(
    () => key,
    async () => {
      // The head first: the feed then replays anything that lands while the page loads.
      const { seq } = await api<{ seq: number }>(urls.api("stats"));
      const page = await api<RequestPage>(
        urls.api("requests", {
          prefix: prefix || undefined,
          actor: exact || undefined,
          limit: REQUESTS_PAGE,
        }),
      );
      return { ...page, head: seq };
    },
  );

  // Live (tempra-dev: app/live): a write the filters may match reloads the newest page, once per
  // burst; titles follow too. An agent's write is remembered as writing now (the pulsing dot).
  const reload = useTrailing(() => loaded.reload());
  const reloadTitles = useTrailing(() => titles.reload(), 1500);
  // A clock that ticks while something reads as live, so the dot stops when the writes do.
  const live = useLiveWrites();
  useFeed(
    () => urls,
    () => loaded.data?.head ?? null,
    (events) => {
      reloadTitles();
      live.heard(events);
      const under = (p: string | null) =>
        !prefix || p === prefix || !!p?.startsWith(`${prefix.replace(/\/$/, "")}/`);
      const hit = events.some(
        (e) => (!exact || e.actor === exact) && (under(e.path) || under(e.from_path)),
      );
      if (hit) reload();
    },
    () => {
      live.reset();
      reload();
    },
  );
;
async () => {

 { const $$_nmuloCegaP0C = __sveltets_2_ensureComponent(PageColumn); new $$_nmuloCegaP0C({ target: __sveltets_2_any(), props: {children:() => { return __sveltets_2_any(0); },}});
   { svelteHTML.createElement("header", { "class":`view-head`,});
     { svelteHTML.createElement("div", { "class":`view-head-main`,});
       { svelteHTML.createElement("h1", { "class":`view-title`,});  }
     }
   }
  if(done?.kind === "revert"){
     { svelteHTML.createElement("div", { "class":`notice ok`,}); plural(done.n ?? 0, "change");        }
  }
   { svelteHTML.createElement("div", { "class":`view-filters activity-filters`,});
     { svelteHTML.createElement("fieldset", { "class":`segmented`,});
       { svelteHTML.createElement("legend", { "class":`visually-hidden`,});  }
       { svelteHTML.createElement("button", {      "type":`button`,"aria-pressed":view === "summary","onclick":() => view !== "summary" && go({ view: "summary" }, false),});  }
       { svelteHTML.createElement("button", {      "type":`button`,"aria-pressed":view === "events","onclick":() => view !== "events" && go({ view: "events" }, false),});  }
     }
     { const $$_retliFohW2C = __sveltets_2_ensureComponent(WhoFilter); new $$_retliFohW2C({ target: __sveltets_2_any(), props: {           urls,"me":actor,view,"who":filters.who ?? "everyone","actor":exact,"onChange":(who, a) => go({ who, actor: a || undefined }),}});}
    if(view === "events"){
       { const $$_sretliFtnevE2C = __sveltets_2_ensureComponent(EventFilters); new $$_sretliFtnevE2C({ target: __sveltets_2_any(), props: {      "kind":filters.kind ?? "","q":filters.q ?? "","onChange":(change) => go(change),}});}
       { svelteHTML.createElement("a", {    "class":`button activity-download`,"href":urls.ledgerJsonl(),"download":true,}); { const $$_nocI3C = __sveltets_2_ensureComponent(Icon); new $$_nocI3C({ target: __sveltets_2_any(), props: {  "name":`download`,}});}  }
    }
   }
   { const $$_sutatS1C = __sveltets_2_ensureComponent(Status); const $$_sutatS1 = new $$_sutatS1C({ target: __sveltets_2_any(), props: { "loaded":loaded.current,children:(page) => { async ()/*Ωignore_positionΩ*/ => {
      key; {
         { const $$_redlO0C = __sveltets_2_ensureComponent(Older); const $$_redlO0 = new $$_redlO0C({ target: __sveltets_2_any(), props: {     urls,prefix,"actor":exact,"first":page,children:(requests, more) => { async ()/*Ωignore_positionΩ*/ => {
            if(view === "summary"){
               { const $$_yrammuS0C = __sveltets_2_ensureComponent(Summary); new $$_yrammuS0C({ target: __sveltets_2_any(), props: {               urls,"me":actor,requests,"empty":page.requests.length === 0,"titles":titles.data?.titles ?? {},"who":filters.who ?? "everyone","writing":live.writing,"now":live.now,}});}
            }else{
               { const $$_tnevEyrevE0C = __sveltets_2_ensureComponent(EveryEvent); new $$_tnevEyrevE0C({ target: __sveltets_2_any(), props: {              urls,"me":actor,requests,"empty":page.requests.length === 0,"filter":{ who: filters.who, kind: filters.kind, q: filters.q },more,"pulses":live.pulses,"now":live.now,}});}
            }
          };return __sveltets_2_any(0)},}});/*Ωignore_startΩ*/const {children} = $$_redlO0.$$prop_def;/*Ωignore_endΩ*/
          
         Older}
      }
    };return __sveltets_2_any(0)},}});/*Ωignore_startΩ*/const {children} = $$_sutatS1.$$prop_def;/*Ωignore_endΩ*/
    
   Status}
 PageColumn}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const Activity__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type Activity__SvelteComponent_ = ReturnType<typeof Activity__SvelteComponent_>;
/*Ωignore_endΩ*/export default Activity__SvelteComponent_;