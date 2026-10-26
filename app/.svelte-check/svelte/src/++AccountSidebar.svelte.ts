///<reference types="svelte" />
;
import type { AccountPage } from "./frame";
import { useUnread } from "./inbox.svelte.ts";
import NavRow from "./NavRow.svelte";
import { libraryLabel, type ReachableLibrary } from "./role";
import { useLibraries } from "./role.svelte.ts";
import { byKind } from "./sidebar";
import UnreadCount from "./UnreadCount.svelte";
import { Urls } from "./urls";

;type $$ComponentProps =  { page: AccountPage };function $$render() {
  const unreadEnd/*Ωignore_positionΩ*/ = ()/*Ωignore_startΩ*/: ReturnType<import('svelte').Snippet>/*Ωignore_endΩ*/ => { async ()/*Ωignore_positionΩ*/ => { { const $$_tnuoCdaernU0C = __sveltets_2_ensureComponent(UnreadCount); new $$_tnuoCdaernU0C({ target: __sveltets_2_any(), props: {  "unread":unread.current,}});}};return __sveltets_2_any(0)}; const row/*Ωignore_positionΩ*/ = (l: ReachableLibrary)/*Ωignore_startΩ*/: ReturnType<import('svelte').Snippet>/*Ωignore_endΩ*/ => { async ()/*Ωignore_positionΩ*/ => {
   { const $$_woRvaN0C = __sveltets_2_ensureComponent(NavRow); new $$_woRvaN0C({ target: __sveltets_2_any(), props: {       "href":new Urls(l.owner, l.slug).tree(""),"tile":{ name: l.title || l.slug, shared: (l.role ?? "owner") !== "owner" },"label":libraryLabel(l),}});}
};return __sveltets_2_any(0)};
  
  
  
  
  
  
  
  

  /** The account's sidebar: Libraries, the Inbox, then the person's libraries by kind. */
  let { page }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
  const libs = useLibraries();
  const unread = useUnread();
  const kinds = $derived(byKind(libs.data?.libraries ?? []));
;
async () => {



 { svelteHTML.createElement("nav", {   "class":`nav`,"aria-label":`Account`,});
   { const $$_woRvaN1C = __sveltets_2_ensureComponent(NavRow); new $$_woRvaN1C({ target: __sveltets_2_any(), props: {        "href":`/`,"current":page === "libraries","icon":`libraries`,"label":`Libraries`,}});}
   { const $$_woRvaN1C = __sveltets_2_ensureComponent(NavRow); new $$_woRvaN1C({ target: __sveltets_2_any(), props: {           "href":`/inbox`,"current":page === "inbox" || page === "invitations","icon":`inbox`,"label":`Inbox`,"end":unreadEnd,}});}
 }
 { svelteHTML.createElement("div", { "class":`sidebar-scroll`,});
  if(kinds.yours.length > 0){
     { svelteHTML.createElement("div", { "class":`sidebar-label`,});  }
     { svelteHTML.createElement("nav", {   "class":`nav`,"aria-label":`Your libraries`,});
         for(let l of __sveltets_2_ensureArray(kinds.yours)){`${l.owner}/${l.slug}`;;__sveltets_2_ensureSnippet(row(l));}
     }
  }
  if(kinds.shared.length > 0){
     { svelteHTML.createElement("div", { "class":`sidebar-label`,});   }
     { svelteHTML.createElement("nav", {   "class":`nav`,"aria-label":`Shared with you`,});
         for(let l of __sveltets_2_ensureArray(kinds.shared)){`${l.owner}/${l.slug}`;;__sveltets_2_ensureSnippet(row(l));}
     }
  }
 }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const AccountSidebar__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type AccountSidebar__SvelteComponent_ = ReturnType<typeof AccountSidebar__SvelteComponent_>;
/*Ωignore_endΩ*/export default AccountSidebar__SvelteComponent_;