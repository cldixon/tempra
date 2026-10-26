///<reference types="svelte" />
;
import Icon from "../Icon.svelte";
import Menu from "../Menu.svelte";
import { day, plural } from "../ui";
import type { Urls } from "../urls";
import type { Namer } from "./byline";
import { checker, markChecked } from "./checked";
import type { Standing } from "./data";

;type $$ComponentProps =  {
    urls: Urls;
    path: string;
    standing: Standing;
    name: Namer;
    /** Open threads on the page. */
    openCount: number;
    /** The latest version is on screen (checking is of the latest only). */
    current: boolean;
    /** Review mode is on: its bar holds Mark as checked and Done. */
    reviewing: boolean;
    /** A write member, who may mark the page as checked. */
    mayVerify: boolean;
    /** A panel is open: the button steps aside. */
    hidden: boolean;
    onComment(): void;
    /** The page was marked as checked: its history is read again. */
    onVerified(): void;
  };function $$render() {

  
  
  
  
  
  
  

  /*
   * A page's actions (TEMPRA-172; tempra-dev: decisions/a-pages-actions-float): one round + button
   * at the page's bottom right, the one raised thing on a flat page, opening a small menu upward:
   * Comment (with the open count), then Check by the page's state (Mark as checked, Review changes,
   * or a quiet line saying who checked it). More actions join it later. It steps aside while a
   * panel is open (the panel has its own ×), and comes back, focusable, when the panel closes.
   */
  let props:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();

  let failed = $state(false);
  const s = $derived(props.standing);
  const changed = $derived(props.current && s.verified !== null && s.since > 0);
  const who = $derived(checker(s, props.name));
  // Something waits here: open comments, or changes since the page was checked.
  const waiting = $derived(props.openCount > 0 || changed);
  const name = $derived(
    props.openCount > 0 ? `Actions, ${plural(props.openCount, "open comment")}` : "Actions",
  );
  async function check() {
    failed = false;
    try {
      await markChecked(props.urls, props.path);
      props.onVerified();
    } catch {
      failed = true;
    }
  }
;
async () => {

 { svelteHTML.createElement("div", {   "class":`page-actions`,"hidden":props.hidden,});
   { const $$_uneM1C = __sveltets_2_ensureComponent(Menu); const $$_uneM1 = new $$_uneM1C({ target: __sveltets_2_any(), props: {        children:() => { return __sveltets_2_any(0); },name,"title":`Actions`,"buttonClass":`page-fab`,"align":`end`,"up":true,"listClass":`page-actions-list`,label:() => { async ()/*Ωignore_positionΩ*/ => { { const $$_nocI0C = __sveltets_2_ensureComponent(Icon); new $$_nocI0C({ target: __sveltets_2_any(), props: {    "name":`add`,"size":22,}});}if(waiting){ { svelteHTML.createElement("span", {   "class":`page-fab-dot`,"aria-hidden":`true`,}); }}};return __sveltets_2_any(0)},}});/*Ωignore_startΩ*/const {label} = $$_uneM1.$$prop_def;/*Ωignore_endΩ*/
     { svelteHTML.createElement("button", {      "type":`button`,"class":`menu-item`,"onclick":() => props.onComment(),}); { const $$_nocI3C = __sveltets_2_ensureComponent(Icon); new $$_nocI3C({ target: __sveltets_2_any(), props: {  "name":`comments`,}});} if(props.openCount > 0){ { svelteHTML.createElement("span", { "class":`menu-count`,});props.openCount;  }} }if(props.current && !props.reviewing && changed){ { svelteHTML.createElement("a", {    "class":`menu-item`,"href":props.urls.review(props.path),}); { const $$_nocI3C = __sveltets_2_ensureComponent(Icon); new $$_nocI3C({ target: __sveltets_2_any(), props: {  "name":`review`,}});}   { svelteHTML.createElement("span", { "class":`menu-count`,});plural(s.since, "change"); } }}if(props.current && !s.verified && props.mayVerify){ { svelteHTML.createElement("button", {        "type":`button`,"class":`menu-item`,...__sveltets_2_empty({"data-stay":failed || undefined}),"onclick":check,}); { const $$_nocI3C = __sveltets_2_ensureComponent(Icon); new $$_nocI3C({ target: __sveltets_2_any(), props: {  "name":`check`,}});} failed ? "Could not mark as checked" : "Mark as checked"; }}if(props.current && s.verified && s.since === 0 && who){ { svelteHTML.createElement("p", { "class":`menu-line`,});  who; day(s.verified.event.ts); }}
   Menu}
 }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const PageActions__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type PageActions__SvelteComponent_ = ReturnType<typeof PageActions__SvelteComponent_>;
/*Ωignore_endΩ*/export default PageActions__SvelteComponent_;