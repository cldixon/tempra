///<reference types="svelte" />
;
import Icon from "./Icon.svelte";
import { useUnread } from "./inbox.svelte.ts";
function $$render() {

  
  

  /**
   * The bell: the way to the Inbox, with its unread count as a badge (TEMPRA-173: no popover;
   * the Inbox is the one list). The count follows the feed and every action on an item.
   */
  const unread = useUnread();
  const n = $derived(unread.current);
;
async () => {

 { svelteHTML.createElement("a", {       "class":`icon-button bell`,"href":`/inbox`,"aria-label":n > 0 ? `Inbox, ${n} unread` : "Inbox","title":`Inbox`,});
   { const $$_nocI1C = __sveltets_2_ensureComponent(Icon); new $$_nocI1C({ target: __sveltets_2_any(), props: {  "name":`bell`,}});}
  if(n > 0){ { svelteHTML.createElement("span", {   "class":`badge`,"aria-hidden":`true`,});n > 99 ? "99+" : n; }}
 }
};
return { props: {} as Record<string, never>, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const Bell__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type Bell__SvelteComponent_ = ReturnType<typeof Bell__SvelteComponent_>;
/*Ωignore_endΩ*/export default Bell__SvelteComponent_;