///<reference types="svelte" />
;
  import type { AccountPage } from "./frame";

  /** The account's pages under its own sidebar; Welcome and Invitations are not settings (S-14). */
  const ACCOUNT_OWN: ReadonlySet<AccountPage> = new Set([
    "libraries",
    "inbox",
    "welcome",
    "invitations",
  ]);
;;

import type { Snippet } from "svelte";
import AccountSettingsSidebar from "./AccountSettingsSidebar.svelte";
import AccountSidebar from "./AccountSidebar.svelte";
import LibrarySearch from "./LibrarySearch.svelte";
import Shell from "./Shell.svelte";
import type { Me } from "./ui";

;type $$ComponentProps =  { page: AccountPage; me: Me | null; children: Snippet };function $$render() {

  
  
  
  
  
  

  /**
   * The account's frame (take 4, boards 01 to 05): Tempra over the sidebar; the library list, the
   * Inbox (an invitation is answered from it), and first run under the account's sidebar
   * (Search, Libraries, Inbox, the person's libraries), the rest under the settings' (Back to
   * libraries, then each page).
   */
  let { page, me, children }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
  const settings = $derived(!ACCOUNT_OWN.has(page));
  // Off a library, search finds a library (TEMPRA-127); Ctrl or Cmd+K opens it, and again closes it.
  let searching = $state(false);
  $effect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searching = !searching;
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });
;
async () => {



 { const $$_llehS0C = __sveltets_2_ensureComponent(Shell); const $$_llehS0 = new $$_llehS0C({ target: __sveltets_2_any(), props: {    children:() => { return __sveltets_2_any(0); },"onSearch":() => (searching = true),me,"index":null,sidebar:() => { async ()/*Ωignore_positionΩ*/ => {
    if(settings){
       { const $$_rabediSsgnitteStnuoccA0C = __sveltets_2_ensureComponent(AccountSettingsSidebar); new $$_rabediSsgnitteStnuoccA0C({ target: __sveltets_2_any(), props: { page,}});}
    }else{
       { const $$_rabediStnuoccA0C = __sveltets_2_ensureComponent(AccountSidebar); new $$_rabediStnuoccA0C({ target: __sveltets_2_any(), props: { page,}});}
    }
  };return __sveltets_2_any(0)},}});/*Ωignore_startΩ*/const {sidebar} = $$_llehS0.$$prop_def;/*Ωignore_endΩ*/
  
  ;__sveltets_2_ensureSnippet(children());
 Shell}
 { const $$_hcraeSyrarbiL0C = __sveltets_2_ensureComponent(LibrarySearch); new $$_hcraeSyrarbiL0C({ target: __sveltets_2_any(), props: {    "open":searching,"onClose":() => (searching = false),}});}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const AccountFrame__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type AccountFrame__SvelteComponent_ = ReturnType<typeof AccountFrame__SvelteComponent_>;
/*Ωignore_endΩ*/export default AccountFrame__SvelteComponent_;