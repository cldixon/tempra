///<reference types="svelte" />
;
;type $$ComponentProps =  { unread: number };function $$render() {

  /**
   * The Inbox's unread count at a row's end, read as "Inbox 2 unread": the name is the row's own
   * words, so it starts with what it shows (WCAG 2.5.3).
   */
  let { unread }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
;
async () => {

if(unread > 0){" "; { svelteHTML.createElement("span", { "class":`nav-count`,});unread; { svelteHTML.createElement("span", { "class":`visually-hidden`,});" unread"; } }}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const UnreadCount__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type UnreadCount__SvelteComponent_ = ReturnType<typeof UnreadCount__SvelteComponent_>;
/*Ωignore_endΩ*/export default UnreadCount__SvelteComponent_;