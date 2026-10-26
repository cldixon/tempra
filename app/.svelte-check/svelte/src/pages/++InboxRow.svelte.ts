///<reference types="svelte" />
;
import {
    type InboxItem,
    itemDetail,
    itemHref,
    itemLibrary,
    itemQuote,
    itemTitle,
    kindLabel,
    markRead,
    type PageTitles,
  } from "../inbox";
import LibraryTile from "../LibraryTile.svelte";
import Moment from "../Moment.svelte";
import { Urls } from "../urls";
;

  /** An action of the row: a link it follows, or a button that acts on the item. */
  type Action =
    | { label: string; primary: boolean; href: string }
    | { label: string; primary: boolean; onclick: () => void };;
;type $$ComponentProps =  {
    item: InboxItem;
    titles: PageTitles;
    now: number;
    me: string | null;
    /** Whether the person reaches the item's library (an accepted invitation opens it). */
    reachable: boolean;
    busy: boolean;
    run: (fn: () => Promise<unknown>) => Promise<void>;
    post: (path: string, body?: unknown) => Promise<unknown>;
    onAccept(i: InboxItem): void;
  };function $$render() {

  
  
  
  

  /** One item: its library, kind and time; the title; the detail line, a quote; its actions. */
  let {
    item: i,
    titles,
    now,
    me,
    reachable,
    busy,
    run,
    post,
    onAccept,
  }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();


  const unread = $derived(i.read_at === null && i.done_at === null);
  const owner = $derived(i.library.split("/")[0] ?? "");
  const slug = $derived(i.library.split("/")[1] ?? "");
  const urls = $derived(new Urls(owner, slug));
  const href = $derived(itemHref(i));
  const quote = $derived(itemQuote(i));
  // Following an item, or acting on it, reads it.
  const read = () => {
    if (i.read_at === null) void markRead([i.id]);
  };
  const ownLibrary = $derived(me !== null && owner === me);
  const name = $derived(itemLibrary(i, me));
  const done = (path: string) => () => void run(() => post(path));
  const actions = $derived.by(() => {
    const out: Action[] = [];
    const link = (label: string, to: string, primary = false) =>
      out.push({ label, primary, href: to });
    const button = (label: string, onclick: () => void, primary = false) =>
      out.push({ label, primary, onclick });
    for (const a of i.actions) {
      if (a === "reply") link("Reply", href);
      else if (a === "resolve" && i.thread)
        button("Resolve", done(`${urls.api(`comments/${encodeURIComponent(i.thread)}`)}/resolve`));
      else if (a === "open") link("Open", href);
      else if (a === "accept" && i.invitation) button("Accept", () => onAccept(i), true);
      else if (a === "decline" && i.invitation)
        button("Decline", done(`/api/v1/invitations/${encodeURIComponent(i.invitation)}/decline`));
    }
    // An invitation answered and accepted: the library opens from its row.
    if (i.kind === "invitation" && i.done_at !== null && reachable) link("Open", urls.tree(""));
    return out;
  });
;
async () => {

 { svelteHTML.createElement("li", { "class":unread ? "inbox-row unread" : "inbox-row",});
   { svelteHTML.createElement("span", {   "class":`inbox-dot`,"aria-hidden":`true`,}); }
  if(unread){ { svelteHTML.createElement("span", { "class":`visually-hidden`,});"Unread: "; }}
   { svelteHTML.createElement("div", { "class":`inbox-main`,});
     { svelteHTML.createElement("p", { "class":`inbox-meta`,}); { const $$_eliTyrarbiL3C = __sveltets_2_ensureComponent(LibraryTile); new $$_eliTyrarbiL3C({ target: __sveltets_2_any(), props: {    "name":i.library_title || slug,"shared":!ownLibrary,}});} { svelteHTML.createElement("span", {});name; } { svelteHTML.createElement("span", { "aria-hidden":`true`,});  } { svelteHTML.createElement("span", {});kindLabel(i); } { svelteHTML.createElement("span", { "aria-hidden":`true`,});  } { const $$_tnemoM3C = __sveltets_2_ensureComponent(Moment); new $$_tnemoM3C({ target: __sveltets_2_any(), props: {   "ts":i.created,now,}});} }
     { svelteHTML.createElement("p", { "class":`inbox-title`,}); { svelteHTML.createElement("a", {  href,"onclick":read,});itemTitle(i, titles); } }
     { svelteHTML.createElement("p", { "class":`inbox-detail`,});itemDetail(i); }
    if(quote){
       { svelteHTML.createElement("blockquote", { "class":`inbox-quote`,});quote; }
    }
   }
  if(actions.length > 0){
    
    
     { svelteHTML.createElement("div", {   "class":`inbox-actions`,"onclick":read,});  for(let a of __sveltets_2_ensureArray(actions)){if("href" in a){ { svelteHTML.createElement("a", {     "class":a.primary ? "button primary" : "button","href":a.href,"onclick":read,});a.label; }}else{ { svelteHTML.createElement("button", {       "type":`button`,"class":a.primary ? "primary" : undefined,"disabled":busy,"onclick":a.onclick,});a.label; }}} }
  }
 }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const InboxRow__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type InboxRow__SvelteComponent_ = ReturnType<typeof InboxRow__SvelteComponent_>;
/*Ωignore_endΩ*/export default InboxRow__SvelteComponent_;