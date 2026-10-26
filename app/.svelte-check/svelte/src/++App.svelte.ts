///<reference types="svelte" />
;
  import { Urls } from "./urls";

  /** The pages that lay out their column themselves (a concept's columns, the person's views). */
  const OWN_COLUMN = new Set(["file", "directory", "activity"]);

  /**
   * One Urls per library and pinned sequence, so pages and what they derive see the same object
   * across navigations (a fragment change must not remount the reader).
   */
  const urlsCache = new Map<string, Urls>();
  function urlsFor(owner: string, slug: string, at: number | undefined): Urls {
    const key = `${owner}/${slug}@${at ?? ""}`;
    let urls = urlsCache.get(key);
    if (!urls) {
      urls = new Urls(owner, slug, at);
      urlsCache.set(key, urls);
    }
    return urls;
  }
;;

import AccountFrame from "./AccountFrame.svelte";
import type { AccountPage, Place } from "./frame";
import { here } from "./location.svelte.ts";
import PageColumn from "./PageColumn.svelte";
import Account from "./pages/Account.svelte";
import Activity from "./pages/Activity.svelte";
import Agents from "./pages/Agents.svelte";
import ConnectLibrary from "./pages/ConnectLibrary.svelte";
import DeleteLibrary from "./pages/DeleteLibrary.svelte";
import File from "./pages/File.svelte";
import General from "./pages/General.svelte";
import Home from "./pages/Home.svelte";
import Inbox from "./pages/Inbox.svelte";
import Invitations from "./pages/Invitations.svelte";
import Libraries from "./pages/Libraries.svelte";
import Members from "./pages/Members.svelte";
import Notifications from "./pages/Notifications.svelte";
import Recovery from "./pages/Recovery.svelte";
import Restore from "./pages/Restore.svelte";
import Revert from "./pages/Revert.svelte";
import Transfer from "./pages/Transfer.svelte";
import Welcome from "./pages/Welcome.svelte";
import Redirect from "./Redirect.svelte";
import { match, pageKey } from "./router";
import { useMe } from "./ui.svelte.ts";
import Workspace from "./Workspace.svelte";
function $$render() {
  const page/*Ωignore_positionΩ*/ = ()/*Ωignore_startΩ*/: ReturnType<import('svelte').Snippet>/*Ωignore_endΩ*/ => { async ()/*Ωignore_positionΩ*/ => {
  
  key; {
     { svelteHTML.createElement("svelte:boundary", {  "onerror":(e) => console.error(e),failed:(error) => { async ()/*Ωignore_positionΩ*/ => {
         { svelteHTML.createElement("h1", {});   }
         { svelteHTML.createElement("p", { "class":`muted`,});error instanceof Error ? error.message : String(error); }
         { svelteHTML.createElement("p", {}); { svelteHTML.createElement("a", { "href":location.href,});   } }
      };return __sveltets_2_any(0)},});;__sveltets_2_ensureSnippet(body());
      
     }
  }
};return __sveltets_2_any(0)};  const body/*Ωignore_positionΩ*/ = ()/*Ωignore_startΩ*/: ReturnType<import('svelte').Snippet>/*Ωignore_endΩ*/ => { async ()/*Ωignore_positionΩ*/ => {
  if(!route){
    
     { svelteHTML.createElement("h1", {});  }
  } else if (route.page === "libraries"){
     { const $$_seirarbiL0C = __sveltets_2_ensureComponent(Libraries); new $$_seirarbiL0C({ target: __sveltets_2_any(), props: {  "create":route.create,}});}
  } else if (route.page === "welcome"){
     { const $$_emocleW0C = __sveltets_2_ensureComponent(Welcome); new $$_emocleW0C({ target: __sveltets_2_any(), props: {  "me":me.current,}});}
  } else if (route.page === "agents"){
     { const $$_stnegA0C = __sveltets_2_ensureComponent(Agents); new $$_stnegA0C({ target: __sveltets_2_any(), props: {      "me":me.current,"newToken":route.newToken,"library":route.library,}});}
  } else if (route.page === "account"){
     { const $$_tnuoccA0C = __sveltets_2_ensureComponent(Account); new $$_tnuoccA0C({ target: __sveltets_2_any(), props: {  "done":route.done,}});}
  } else if (route.page === "notifications"){
     { const $$_snoitacifitoN0C = __sveltets_2_ensureComponent(Notifications); new $$_snoitacifitoN0C({ target: __sveltets_2_any(), props: {}});}
  } else if (route.page === "invitations"){
     { const $$_snoitativnI0C = __sveltets_2_ensureComponent(Invitations); new $$_snoitativnI0C({ target: __sveltets_2_any(), props: {}});}
  } else if (route.page === "inbox"){
     { const $$_xobnI0C = __sveltets_2_ensureComponent(Inbox); new $$_xobnI0C({ target: __sveltets_2_any(), props: {    "done":route.done,"library":route.library,}});}
  } else if (route.page === "redirect"){
     { const $$_tcerideR0C = __sveltets_2_ensureComponent(Redirect); new $$_tcerideR0C({ target: __sveltets_2_any(), props: {  "to":route.to,}});}
  } else if (library){
    const urls = library.pinned;
    if(route.page === "directory"){
      if(route.dir === ""){
         { const $$_emoH0C = __sveltets_2_ensureComponent(Home); new $$_emoH0C({ target: __sveltets_2_any(), props: { urls,}});}
      }else{
        
         { const $$_tcerideR0C = __sveltets_2_ensureComponent(Redirect); new $$_tcerideR0C({ target: __sveltets_2_any(), props: {  "to":urls.pinned(undefined).tree(""),}});}
      }
    } else if (route.page === "activity"){
       { const $$_ytivitcA0C = __sveltets_2_ensureComponent(Activity); new $$_ytivitcA0C({ target: __sveltets_2_any(), props: {      urls,actor,"filters":route.filters,"done":route.done,}});}
    } else if (route.page === "file"){
       { const $$_eliF0C = __sveltets_2_ensureComponent(File); new $$_eliF0C({ target: __sveltets_2_any(), props: {        urls,"path":route.path,"done":url.searchParams.get("done"),actor,"compare":route.compare ?? null,}});}
    } else if (route.page === "diff"){
      
       { const $$_tcerideR0C = __sveltets_2_ensureComponent(Redirect); new $$_tcerideR0C({ target: __sveltets_2_any(), props: {  "to":urls.diff(route.path, route.from, route.to),}});}
    } else if (route.page === "settings"){
       { const $$_lareneG0C = __sveltets_2_ensureComponent(General); new $$_lareneG0C({ target: __sveltets_2_any(), props: { urls,}});}
    } else if (route.page === "transfer"){
       { const $$_refsnarT0C = __sveltets_2_ensureComponent(Transfer); new $$_refsnarT0C({ target: __sveltets_2_any(), props: { urls,}});}
    } else if (route.page === "recovery"){
       { const $$_yrevoceR0C = __sveltets_2_ensureComponent(Recovery); new $$_yrevoceR0C({ target: __sveltets_2_any(), props: { urls,}});}
    } else if (route.page === "library-connect"){
       { const $$_yrarbiLtcennoC0C = __sveltets_2_ensureComponent(ConnectLibrary); new $$_yrarbiLtcennoC0C({ target: __sveltets_2_any(), props: { urls,}});}
    } else if (route.page === "delete"){
       { const $$_yrarbiLeteleD0C = __sveltets_2_ensureComponent(DeleteLibrary); new $$_yrarbiLeteleD0C({ target: __sveltets_2_any(), props: { urls,}});}
    } else if (route.page === "members"){
       { const $$_srebmeM0C = __sveltets_2_ensureComponent(Members); new $$_srebmeM0C({ target: __sveltets_2_any(), props: {   urls,"me":me.current?.handle ?? null,}});}
    } else if (route.page === "revert"){
       { const $$_treveR0C = __sveltets_2_ensureComponent(Revert); new $$_treveR0C({ target: __sveltets_2_any(), props: {    urls,"request":route.request,actor,}});}
    } else if (route.page === "restore"){
       { const $$_erotseR0C = __sveltets_2_ensureComponent(Restore); new $$_erotseR0C({ target: __sveltets_2_any(), props: {      urls,"path":route.path,"to":route.to,actor,}});}
    }
  }
};return __sveltets_2_any(0)};
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  

  const me = useMe();
  const url = $derived(here.url);
  const route = $derived(match(url));
  const actor = $derived(me.current?.actor ?? "");
  const key = $derived(pageKey(url, route));

  /** For the account's pages: which one, for its frame. */
  const account = $derived.by((): AccountPage | null => {
    switch (route?.page) {
      case "libraries":
      case "welcome":
      case "agents":
      case "account":
      case "notifications":
      case "invitations":
      case "inbox":
        return route.page;
      case "redirect":
        return "inbox";
      default:
        return null;
    }
  });

  /** For a library's pages: the library and where in it the page is (the workspace frame). */
  const library = $derived.by((): { urls: Urls; place: Place; pinned: Urls } | null => {
    const r = route;
    if (!r || !("owner" in r)) return null;
    const place: Place = { file: null, dir: null, view: null };
    switch (r.page) {
      case "directory":
        if (r.dir === "") place.view = "home";
        else place.dir = r.dir;
        break;
      case "file":
      case "diff":
      case "restore":
        place.file = r.path;
        break;
      case "revert":
        place.view = "activity";
        break;
      case "library-connect":
        place.view = "connect";
        break;
      default:
        place.view = r.page;
    }
    return {
      urls: urlsFor(r.owner, r.slug, undefined),
      place,
      pinned: urlsFor(r.owner, r.slug, "at" in r ? r.at : undefined),
    };
  });
  const libraryKey = $derived(library ? `${library.urls.owner}/${library.urls.slug}` : "");
;
async () => {







if(library){
  
  libraryKey; {
     { const $$_ecapskroW0C = __sveltets_2_ensureComponent(Workspace); new $$_ecapskroW0C({ target: __sveltets_2_any(), props: {     children:() => { return __sveltets_2_any(0); },"urls":library.urls,"place":library.place,"me":me.current,}});
      if(route && OWN_COLUMN.has(route.page)){
        ;__sveltets_2_ensureSnippet(page());
      }else{
         { const $$_nmuloCegaP1C = __sveltets_2_ensureComponent(PageColumn); new $$_nmuloCegaP1C({ target: __sveltets_2_any(), props: {children:() => { return __sveltets_2_any(0); },}});;__sveltets_2_ensureSnippet(page()); PageColumn}
      }
     Workspace}
  }
}else{
  
   { const $$_emarFtnuoccA0C = __sveltets_2_ensureComponent(AccountFrame); new $$_emarFtnuoccA0C({ target: __sveltets_2_any(), props: {   children:() => { return __sveltets_2_any(0); },"page":account ?? "libraries","me":me.current,}});
     { const $$_nmuloCegaP1C = __sveltets_2_ensureComponent(PageColumn); new $$_nmuloCegaP1C({ target: __sveltets_2_any(), props: {children:() => { return __sveltets_2_any(0); },}});;__sveltets_2_ensureSnippet(page()); PageColumn}
   AccountFrame}
}
};
return { props: {} as Record<string, never>, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const App__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type App__SvelteComponent_ = ReturnType<typeof App__SvelteComponent_>;
/*Ωignore_endΩ*/export default App__SvelteComponent_;