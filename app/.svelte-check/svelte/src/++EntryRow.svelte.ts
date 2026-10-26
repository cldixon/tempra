///<reference types="svelte" />
;
import { type Entry, type Part, type Touched, entryTime, wordsText } from "./activity";
import AgentName from "./AgentName.svelte";
import type { ActorView } from "./agents";
import Avatar from "./Avatar.svelte";
import { localTime } from "./ui";
import { folderName, type Urls } from "./urls";

;type $$ComponentProps =  { entry: Entry; urls: Urls; actor: ActorView; now: number };function $$render() {
 const part/*Ωignore_positionΩ*/ = (p: Part)/*Ωignore_startΩ*/: ReturnType<import('svelte').Snippet>/*Ωignore_endΩ*/ => { async ()/*Ωignore_positionΩ*/ => {if(typeof p === "string"){p;} else if ("folder" in p){folderName(p.folder);}else{const words = wordsText(p.words); { svelteHTML.createElement("a", { "href":href(p.concept, p.seq, p.gone),});p.title; }if(words){ { svelteHTML.createElement("span", { "class":`entry-words`,});` ${words}`; }}}};return __sveltets_2_any(0)}; const touchedList/*Ωignore_positionΩ*/ = (touched: Touched[])/*Ωignore_startΩ*/: ReturnType<import('svelte').Snippet>/*Ωignore_endΩ*/ => { async ()/*Ωignore_positionΩ*/ => {
  const more = touched.length - Math.min(touched.length, LISTED);
   { svelteHTML.createElement("ul", { "class":`entry-touched`,});
       for(let t of __sveltets_2_ensureArray((touched.slice(0, LISTED)))){t.path;
      const words = wordsText(t.words);
       { svelteHTML.createElement("li", {}); { svelteHTML.createElement("span", { "class":`entry-what`,});t.what; } { svelteHTML.createElement("a", { "href":href(t.path, t.seq, t.what === "deleted"),});t.title; }if(words){ { svelteHTML.createElement("span", { "class":`entry-words`,});words; }}if(t.from){ { svelteHTML.createElement("span", { "class":`entry-words`,}); t.from; }} }
    }
    if(more > 0){
       { svelteHTML.createElement("li", { "class":`entry-more`,}); more;  }
    }
   }
};return __sveltets_2_any(0)};
  
  
  
  
  
  

  /**
   * One Activity entry: who (avatar, name, whom an agent acts for), what they did, the note, the
   * concepts touched, and when.
   */
  let { entry: e, urls, actor, now }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ =
    $props();

  /** How many touched concepts an entry lists before "and n more". */
  const LISTED = 8;

  const href = (path: string, seq: number, gone: boolean) =>
    gone ? urls.pinned(seq - 1).file(path) : urls.file(path);
;
async () => {







 { svelteHTML.createElement("article", { "class":`entry`,});
   { const $$_ratavA1C = __sveltets_2_ensureComponent(Avatar); new $$_ratavA1C({ target: __sveltets_2_any(), props: {    "name":actor.mark,"agent":actor.agent,}});}
   { svelteHTML.createElement("div", { "class":`entry-body`,});
     { svelteHTML.createElement("p", { "class":`entry-line`,}); { const $$_emaNtnegA3C = __sveltets_2_ensureComponent(AgentName); new $$_emaNtnegA3C({ target: __sveltets_2_any(), props: {  "who":actor,}});}   for(let p of __sveltets_2_ensureArray(e.parts)){;__sveltets_2_ensureSnippet(part(p));} }
    if(e.quote){
       { svelteHTML.createElement("q", { "class":`entry-note`,});e.quote; }
    }
    if(!e.named){
      ;__sveltets_2_ensureSnippet(touchedList(e.touched));
    }
   }
   { svelteHTML.createElement("span", { "class":`entry-side`,});
     { svelteHTML.createElement("time", {   "datetime":e.ts,"title":localTime(e.ts),});entryTime(e.ts, now); }
   }
 }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const EntryRow__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type EntryRow__SvelteComponent_ = ReturnType<typeof EntryRow__SvelteComponent_>;
/*Ωignore_endΩ*/export default EntryRow__SvelteComponent_;