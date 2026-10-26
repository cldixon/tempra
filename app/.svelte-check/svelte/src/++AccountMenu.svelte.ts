///<reference types="svelte" />
;
import Avatar from "./Avatar.svelte";
import { initials } from "./chrome";
import Icon from "./Icon.svelte";
import Menu from "./Menu.svelte";
import ThemeChoice from "./ThemeChoice.svelte";
import { useTheme } from "./theme.svelte.ts";
import type { Me } from "./ui";

;type $$ComponentProps =  { me: Me | null };function $$render() {

  
  
  
  
  
  
  

  /**
   * The avatar and its menu (take 4, board 08): who, then Account, Notifications, Agents; the
   * theme; Sign out.
   */
  let { me }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
  const handle = $derived(me?.handle ?? "");
  const theme = useTheme();
;
async () => {

 { const $$_uneM0C = __sveltets_2_ensureComponent(Menu); const $$_uneM0 = new $$_uneM0C({ target: __sveltets_2_any(), props: {       children:() => { return __sveltets_2_any(0); },"title":me ? `${handle} · ${me.email}` : "Account","buttonClass":`avatar`,"listClass":`account`,"align":`end`,label:() => { async ()/*Ωignore_positionΩ*/ => {
    
     { svelteHTML.createElement("span", { "aria-hidden":`true`,});initials(handle); } { svelteHTML.createElement("span", { "class":`visually-hidden`,});  }
  };return __sveltets_2_any(0)},}});/*Ωignore_startΩ*/const {label} = $$_uneM0.$$prop_def;/*Ωignore_endΩ*/
  
   { svelteHTML.createElement("div", { "class":`menu-person`,});
     { const $$_ratavA2C = __sveltets_2_ensureComponent(Avatar); new $$_ratavA2C({ target: __sveltets_2_any(), props: {  "name":handle,}});}
     { svelteHTML.createElement("span", { "class":`menu-person-names`,});
      
       { svelteHTML.createElement("span", {});me ? `@${handle}` : ""; }
       { svelteHTML.createElement("span", { "class":`email`,});me?.email ?? ""; }
     }
   }
   { svelteHTML.createElement("hr", {});}
   { svelteHTML.createElement("a", {   "class":`menu-item`,"href":`/account`,}); { const $$_nocI2C = __sveltets_2_ensureComponent(Icon); new $$_nocI2C({ target: __sveltets_2_any(), props: {  "name":`user`,}});}  }
   { svelteHTML.createElement("a", {   "class":`menu-item`,"href":`/notifications`,}); { const $$_nocI2C = __sveltets_2_ensureComponent(Icon); new $$_nocI2C({ target: __sveltets_2_any(), props: {  "name":`bell`,}});}  }
   { svelteHTML.createElement("a", {   "class":`menu-item`,"href":`/agents`,}); { const $$_nocI2C = __sveltets_2_ensureComponent(Icon); new $$_nocI2C({ target: __sveltets_2_any(), props: {  "name":`plug`,}});}  }
   { svelteHTML.createElement("hr", {});}
   { svelteHTML.createElement("div", { "class":`menu-theme`,});
     { const $$_nocI2C = __sveltets_2_ensureComponent(Icon); new $$_nocI2C({ target: __sveltets_2_any(), props: {  "name":`theme`,}});}
     { svelteHTML.createElement("span", {});  }
     { const $$_eciohCemehT2C = __sveltets_2_ensureComponent(ThemeChoice); new $$_eciohCemehT2C({ target: __sveltets_2_any(), props: {    "value":theme.current,"onChange":theme.choose,}});}
   }
   { svelteHTML.createElement("hr", {});}
   { svelteHTML.createElement("form", {   "method":`post`,"action":`/sign-out`,});
     { svelteHTML.createElement("button", {   "type":`submit`,"class":`menu-item`,}); { const $$_nocI3C = __sveltets_2_ensureComponent(Icon); new $$_nocI3C({ target: __sveltets_2_any(), props: {  "name":`signout`,}});}  }
   }
 Menu}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const AccountMenu__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type AccountMenu__SvelteComponent_ = ReturnType<typeof AccountMenu__SvelteComponent_>;
/*Ωignore_endΩ*/export default AccountMenu__SvelteComponent_;