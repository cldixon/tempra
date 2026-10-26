///<reference types="svelte" />
;
import { api } from "../api";
import {
    INBOX_EVENT,
    type InboxItem,
    type InboxPage,
    inboxChanged,
    itemLibrary,
    markRead,
    withNames,
  } from "../inbox";
import { useAgentLabels, usePageTitles } from "../inbox.svelte.ts";
import { useAction, useLoad } from "../load.svelte.ts";
import { librariesChanged, libraryLabel } from "../role";
import { useLibraries } from "../role.svelte.ts";
import { navigate } from "../router";
import Status from "../Status.svelte";
import { useMe, useNow, useTitle } from "../ui.svelte.ts";
import { inboxUrl, Urls } from "../urls";
import InboxRow from "./InboxRow.svelte";

;type $$ComponentProps =  { done: boolean; library: string | null };function $$render() {

  
  
  
  
  
  
  
  
  
  
  

  /**
   * The Inbox (take 4, boards 02, 13; TEMPRA-116; tempra-dev: v2/notifications): the one place for
   * what the person should do or answer across their libraries, newest first, kept until done:
   * invitations, mentions and replies on their threads, and nothing else (TEMPRA-173). Open and
   * Done tabs, one
   * library or all; read and done are kept on the server, so they follow the person. "Older" pages
   * back past the first hundred.
   */
  let { done, library }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();

  /** How many items a page of the Inbox loads. */
  const PAGE = 100;

  useTitle(() => "Inbox");
  const q = $derived.by(() => {
    const q = new URLSearchParams({ limit: String(PAGE) });
    if (done) q.set("done", "1");
    if (library) q.set("library", library);
    return q;
  });
  const loaded = useLoad(
    () => `inbox ${q}`,
    () => api<InboxPage>(`/api/v1/inbox?${q}`),
  );
  $effect(() => {
    const reload = () => loaded.reload();
    window.addEventListener(INBOX_EVENT, reload);
    return () => window.removeEventListener(INBOX_EVENT, reload);
  });
  const first = $derived(loaded.data ?? null);
  // Older pages, after the first ("Older", as Activity has); kept for the first page they follow,
  // so a new first page (a change) starts again from the top.
  let older = $state.raw<{ after: InboxPage; items: InboxItem[]; next: string | null } | null>(
    null,
  );
  const more = $derived(older !== null && older.after === first ? older : null);
  let paging = $state(false);
  const raw = $derived(first ? [...first.items, ...(more?.items ?? [])] : null);
  const labels = useAgentLabels(() => raw);
  const items = $derived(raw && withNames(raw, labels.current));
  const next = $derived(more ? more.next : (first?.next ?? null));
  function loadOlder() {
    const after = first;
    if (next === null || after === null) return;
    paging = true;
    const page = new URLSearchParams(q);
    page.set("before", next);
    api<InboxPage>(`/api/v1/inbox?${page}`)
      .then((p) => {
        const kept = older?.after === after ? older.items : [];
        older = { after, items: [...kept, ...p.items], next: p.next };
      })
      .catch(() => {})
      .finally(() => {
        paging = false;
      });
  }
  const titles = usePageTitles(() => items);
  const action = useAction();
  const now = useNow(60_000);
  const me = useMe();
  const libs = useLibraries();
  const reachable = $derived(libs.data?.libraries ?? []);
  // Accepting an invitation: the library joins the switcher and the sidebar, and opens from here.
  let joined = $state<{ name: string; href: string } | null>(null);
  const run = (fn: () => Promise<unknown>) =>
    action.run(async () => {
      await fn();
      inboxChanged();
    });
  const post = (path: string, body: unknown = {}) =>
    api(path, { method: "POST", body: JSON.stringify(body) });
  const accept = (i: InboxItem) =>
    void run(async () => {
      await post(`/api/v1/invitations/${encodeURIComponent(i.invitation ?? "")}/accept`);
      librariesChanged();
      const [owner = "", slug = ""] = i.library.split("/");
      joined = {
        name: itemLibrary(i, me.current?.handle ?? null),
        href: new Urls(owner, slug).tree(""),
      };
    });
  const open = $derived(first?.open ?? null);
  // Mark all read clears what the list shows: one library's items when it is filtered.
  const unread = $derived(
    library
      ? (items ?? []).some((i) => i.read_at === null && i.done_at === null)
      : (first?.unread ?? 0) > 0,
  );
;
async () => {

 { svelteHTML.createElement("header", { "class":`view-head`,});
   { svelteHTML.createElement("div", { "class":`view-head-main`,});
     { svelteHTML.createElement("h1", { "class":`view-title`,});  }
   }
 }
 { svelteHTML.createElement("div", { "class":`view-filters inbox-filters`,});
   { svelteHTML.createElement("fieldset", { "class":`segmented`,});
     { svelteHTML.createElement("legend", { "class":`visually-hidden`,});  }
     { svelteHTML.createElement("button", {       "type":`button`,"aria-pressed":!done,"onclick":() => done && navigate(inboxUrl({ library })),}); open !== null && open > 0 ? ` ${open}` : ""; }
     { svelteHTML.createElement("button", {      "type":`button`,"aria-pressed":done,"onclick":() => !done && navigate(inboxUrl({ done: true, library })),});  }
   }
  
  if(library || reachable.length > 1){
     { svelteHTML.createElement("select", {         "class":`pill-select`,"aria-label":`Library`,"value":library ?? "","onchange":(e) => navigate(inboxUrl({ done, library: e.currentTarget.value || null })),});
       { svelteHTML.createElement("option", {"value":"",});  }
         for(let l of __sveltets_2_ensureArray(reachable)){`${l.owner}/${l.slug}`;
         { svelteHTML.createElement("option", { "value":`${l.owner}/${l.slug}`,});libraryLabel(l); }
      }
      if(library && !reachable.some((l) => `${l.owner}/${l.slug}` === library)){
         { svelteHTML.createElement("option", { "value":library,});itemLibrary({ library, library_title: null }, me.current?.handle ?? null); }
      }
     }
  }
  if(unread){
     { svelteHTML.createElement("button", {        "type":`button`,"class":`ghost inbox-mark`,"disabled":action.busy,"onclick":() => void run(() => markRead(undefined, library)),});   }
  }
 }
if(action.error){
   { svelteHTML.createElement("div", { "class":`notice`,});action.error; }
}
if(joined){
   { svelteHTML.createElement("div", {   "class":`notice`,"role":`status`,});  joined.name;  { svelteHTML.createElement("a", { "href":joined.href,});  } }
}
 { const $$_sutatS0C = __sveltets_2_ensureComponent(Status); const $$_sutatS0 = new $$_sutatS0C({ target: __sveltets_2_any(), props: { "loaded":loaded.current,children:() => { async ()/*Ωignore_positionΩ*/ => {
    if(items === null || items.length === 0){
       { svelteHTML.createElement("p", { "class":`view-empty`,});done ? "Nothing done yet" : "Nothing for you"; }
    }else{
       { svelteHTML.createElement("ul", { "class":`inbox-list`,});
           for(let i of __sveltets_2_ensureArray(items)){i.id;
           { const $$_woRxobnI1C = __sveltets_2_ensureComponent(InboxRow); new $$_woRxobnI1C({ target: __sveltets_2_any(), props: {                 "item":i,"titles":titles.current,"now":now.current,"me":me.current?.handle ?? null,"reachable":reachable.some((l) => `${l.owner}/${l.slug}` === i.library),"busy":action.busy,run,post,"onAccept":accept,}});}
        }
       }
      if(next !== null){
         { svelteHTML.createElement("p", { "class":`view-more`,});
           { svelteHTML.createElement("button", {     "type":`button`,"onclick":loadOlder,"disabled":paging,});paging ? "Loading…" : "Older"; }
         }
      }
    }
  };return __sveltets_2_any(0)},}});/*Ωignore_startΩ*/const {children} = $$_sutatS0.$$prop_def;/*Ωignore_endΩ*/
  
 Status}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const Inbox__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type Inbox__SvelteComponent_ = ReturnType<typeof Inbox__SvelteComponent_>;
/*Ωignore_endΩ*/export default Inbox__SvelteComponent_;