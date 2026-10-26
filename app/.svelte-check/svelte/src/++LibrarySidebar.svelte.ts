///<reference types="svelte" />
;
import type { Place } from "./frame";
import { useUnread } from "./inbox.svelte.ts";
import NavRow from "./NavRow.svelte";
import Tree from "./Tree.svelte";
import type { OutlineFile } from "./tree";
import UnreadCount from "./UnreadCount.svelte";
import type { Urls } from "./urls";

;type $$ComponentProps =  {
    urls: Urls;
    place: Place;
    onIndex(files: OutlineFile[], seq: number): void;
  };function $$render() {
  const unreadEnd/*Ωignore_positionΩ*/ = ()/*Ωignore_startΩ*/: ReturnType<import('svelte').Snippet>/*Ωignore_endΩ*/ => { async ()/*Ωignore_positionΩ*/ => { { const $$_tnuoCdaernU0C = __sveltets_2_ensureComponent(UnreadCount); new $$_tnuoCdaernU0C({ target: __sveltets_2_any(), props: {  "unread":unread.current,}});}};return __sveltets_2_any(0)};
  
  
  
  
  
  
  

  /**
   * The library's sidebar (TEMPRA-145): the files, then a fixed foot of the library's tools,
   * Activity and Settings (and on a phone the Inbox). Home is the library's name in the bar.
   */
  let props:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
  const unread = useUnread();
;
async () => {


 { svelteHTML.createElement("div", { "class":`sidebar-scroll`,});
   { const $$_eerT1C = __sveltets_2_ensureComponent(Tree); new $$_eerT1C({ target: __sveltets_2_any(), props: {        "urls":props.urls,"file":props.place.file,"dir":props.place.dir,"onIndex":props.onIndex,}});}
 }
 { svelteHTML.createElement("nav", {   "class":`sidebar-foot`,"aria-label":`Library`,});
   { const $$_woRvaN1C = __sveltets_2_ensureComponent(NavRow); new $$_woRvaN1C({ target: __sveltets_2_any(), props: {         "href":props.urls.activity(),"current":props.place.view === "activity","icon":`activity`,"label":`Activity`,}});}
   { const $$_woRvaN1C = __sveltets_2_ensureComponent(NavRow); new $$_woRvaN1C({ target: __sveltets_2_any(), props: {      "href":props.urls.settings(),"icon":`settings`,"label":`Settings`,}});}
   { const $$_woRvaN1C = __sveltets_2_ensureComponent(NavRow); new $$_woRvaN1C({ target: __sveltets_2_any(), props: {          "href":`/inbox`,"icon":`inbox`,"label":`Inbox`,"className":`phone-only`,"end":unreadEnd,}});}
 }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const LibrarySidebar__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type LibrarySidebar__SvelteComponent_ = ReturnType<typeof LibrarySidebar__SvelteComponent_>;
/*Ωignore_endΩ*/export default LibrarySidebar__SvelteComponent_;