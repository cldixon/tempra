///<reference types="svelte" />
;
import { untrack } from "svelte";
import { api } from "./api";
import Icon from "./Icon.svelte";
import { useFeed } from "./live.svelte.ts";
import { prefetchFile } from "./prefetch";
import {
    ancestors,
    buildDirs,
    countConcepts,
    fileLabel,
    HOVER_MS,
    insideDirs,
    loadClosed,
    type OutlineFile,
    REFRESH_MS,
    rollUp,
    saveClosed,
  } from "./tree";
import { plural } from "./ui";
import { folderName, type Urls } from "./urls";

;type $$ComponentProps =  {
    urls: Urls;
    file: string | null;
    dir: string | null;
    /** The index and its sequence, for the quick switcher and the feed's start. */
    onIndex?(files: OutlineFile[], seq: number): void;
  };function $$render() {
 const mark/*Ωignore_positionΩ*/ = (comments: number | undefined, stale: OutlineFile["stale"])/*Ωignore_startΩ*/: ReturnType<import('svelte').Snippet>/*Ωignore_endΩ*/ => { async ()/*Ωignore_positionΩ*/ => {if(comments){ { svelteHTML.createElement("span", {     "class":`tree-mark`,"title":`${comments} open comment${s(comments)}`,}); { svelteHTML.createElement("span", { "aria-hidden":`true`,});comments; } { svelteHTML.createElement("span", {  "class":`visually-hidden`,});comments;  s(comments); } }}if(stale){ { svelteHTML.createElement("span", {    "class":`tree-mark`,"title":stale === "stale" ? "Stale" : "Stale soon",}); { svelteHTML.createElement("span", { "aria-hidden":`true`,}); { const $$_nocI2C = __sveltets_2_ensureComponent(Icon); new $$_nocI2C({ target: __sveltets_2_any(), props: {    "name":stale === "stale" ? "stale" : "soon","size":12,}});} } { svelteHTML.createElement("span", { "class":`visually-hidden`,});stale === "stale" ? "stale" : "stale soon"; } }}};return __sveltets_2_any(0)}; const rolledUp/*Ωignore_positionΩ*/ = (dir: string)/*Ωignore_startΩ*/: ReturnType<import('svelte').Snippet>/*Ωignore_endΩ*/ => { async ()/*Ωignore_positionΩ*/ => {const r = rollUp(inside.get(dir) ?? []);;__sveltets_2_ensureSnippet(mark(
    r.comments,
    r.stale,
  ));};return __sveltets_2_any(0)}; const rows/*Ωignore_positionΩ*/ = (dir: string)/*Ωignore_startΩ*/: ReturnType<import('svelte').Snippet>/*Ωignore_endΩ*/ => { async ()/*Ωignore_positionΩ*/ => {
  if(dirs === null && failed){
     { svelteHTML.createElement("li", { "class":`tree-note`,});    " "; { svelteHTML.createElement("button", {   "type":`button`,"onclick":() => void load(),});  } }
  } else if (dirs === null){
     { svelteHTML.createElement("li", { "class":`tree-note`,});  }
  } else if ((dirs[dir] ?? []).length === 0 && dir === ""){
     { svelteHTML.createElement("li", { "class":`tree-note`,});   }
  }else{
       for(let e of __sveltets_2_ensureArray(dirs[dir] ?? [])){e.path;
      if(e.kind === "dir"){
        const n = counts.get(e.path) ?? 0;
         { svelteHTML.createElement("li", {});
          
           { svelteHTML.createElement("div", {  "class":isOpen(e.path) ? "tree-row dir open" : "tree-row dir",}); { svelteHTML.createElement("span", {   "class":`tree-chevron`,"aria-hidden":`true`,}); { const $$_nocI3C = __sveltets_2_ensureComponent(Icon); new $$_nocI3C({ target: __sveltets_2_any(), props: {  "name":`chevron`,}});} } { svelteHTML.createElement("button", {            "type":`button`,"class":`tree-name`,"aria-expanded":isOpen(e.path),"title":folderName(e.path),[Symbol("@attach")]:reveal(e.path),"onclick":() => toggle(e.path),});folderName(e.path);if(n > 0){ { svelteHTML.createElement("span", { "class":`visually-hidden`,}); plural(n, "page"); }} }if(n > 0){ { svelteHTML.createElement("span", {   "class":`tree-count`,"aria-hidden":`true`,});n; }}if(!isOpen(e.path)){;__sveltets_2_ensureSnippet(rolledUp(
                e.path,
              ));} }if(isOpen(e.path)){ { svelteHTML.createElement("ul", {});;__sveltets_2_ensureSnippet(rows(e.path)); }} }
      }else{
         { svelteHTML.createElement("li", {});
           { svelteHTML.createElement("div", {  "class":e.kind === "attachment" ? "tree-row file" : "tree-row",}); { svelteHTML.createElement("span", {  "class":`tree-leaf`,});if(e.kind === "attachment"){ { const $$_nocI3C = __sveltets_2_ensureComponent(Icon); new $$_nocI3C({ target: __sveltets_2_any(), props: {    "name":`file`,"size":14,}});}} } { svelteHTML.createElement("a", {               "href":props.urls.file(e.path),"title":fileLabel(e),...__sveltets_2_empty({"data-path":e.path}),"onmouseenter":() => enter(e.path),"onmouseleave":() => clearTimeout(hoverTimer),"onfocus":(ev) => {
                if (ev.currentTarget.matches(":focus-visible")) prefetchFile(props.urls, e.path);
              },"aria-current":props.file === e.path ? "page" : undefined,[Symbol("@attach")]:props.file === e.path ? markCurrent : undefined,});fileLabel(e); };__sveltets_2_ensureSnippet(mark(e.comments, e.stale)); }
         }
      }
    }
  }
};return __sveltets_2_any(0)};
  
  
  
  
  
  
  
  

  /**
   * The library's file tree (tempra-dev: app/workspace). The whole index (paths, titles,
   * sequences; no bodies) arrives in one small request when the workspace opens, so opening a
   * folder never waits. A folder (named for people, with its count of concepts) is a group, not a
   * page: its row opens and closes it (TEMPRA-138), and a folder's address reveals it here. Every
   * folder starts open; the ones the person closed are remembered on this browser, the open file
   * is revealed and marked, and the change feed refreshes the index once per burst of writes. A
   * closed folder rolls up the marks of what is inside it. Change is not marked here
   * (TEMPRA-173): Activity is where a person looks for it.
   */
  let props:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();

  let files = $state.raw<OutlineFile[] | null>(null);
  let closed = $state.raw(loadClosed(untrack(() => props.urls)));
  const isOpen = (dir: string) => !closed.has(dir);
  let seq = $state<number | null>(null);
  const dirs = $derived(files ? buildDirs(files) : null);
  const counts = $derived(files ? countConcepts(files) : new Map<string, number>());
  const inside = $derived(files ? insideDirs(files) : new Map<string, OutlineFile[]>());

  // Only the latest request's answer is kept (two loads may cross).
  let asked = 0;
  let loadedAt = 0;
  let failed = $state(false);
  async function load() {
    const mine = ++asked;
    loadedAt = Date.now();
    try {
      const r = await api<{ seq: number; files: OutlineFile[] }>(props.urls.api("outline"));
      if (mine !== asked) return;
      files = r.files;
      failed = false;
      // The feed is synced once, from the first index; it stays live after that.
      seq = seq ?? r.seq;
    } catch {
      if (mine === asked) failed = true;
    }
  }
  $effect(() => {
    void props.urls;
    untrack(() => void load());
  });
  $effect(() => {
    const f = files;
    const s = seq;
    if (f && s !== null) untrack(() => props.onIndex?.(f, s));
  });

  // The open file's folders are revealed when it opens (and may be collapsed after); so is a
  // folder whose address was opened (`dir`, on its way to the home).
  const current = $derived(props.file ?? props.dir);
  /** A folder being revealed: its row is scrolled into view when it first draws. */
  let revealing = $state<string | null>(null);
  $effect(() => {
    const file = props.file;
    const cur = current;
    const urls = props.urls;
    if (cur === null) return;
    if (file === null) revealing = cur;
    const up = file !== null ? ancestors(file) : [...ancestors(cur), cur];
    const want = up.filter((d) => d !== "");
    untrack(() => {
      const c = closed;
      if (!want.some((d) => c.has(d))) return;
      const next = new Set([...c].filter((d) => !want.includes(d)));
      saveClosed(urls, next);
      closed = next;
    });
  });

  // Live: the index is refreshed shortly after a write, and at most every few seconds while
  // agents keep writing (each refresh reads the whole index).
  let timer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => () => clearTimeout(timer));
  useFeed(
    () => props.urls,
    () => seq,
    () => {
      if (timer === undefined) {
        const wait = Math.max(300, loadedAt + REFRESH_MS - Date.now());
        timer = setTimeout(() => {
          timer = undefined;
          void load();
        }, wait);
      }
    },
    () => {
      // The ledger went back (a restore): start again from the new index.
      seq = null;
      void load();
    },
  );
  function toggle(dir: string) {
    const next = new Set(closed);
    if (next.has(dir)) next.delete(dir);
    else next.add(dir);
    saveClosed(props.urls, next);
    closed = next;
  }

  // The open file's (or revealed folder's) row is scrolled into view once, when it opens (not
  // after every refresh, which would pull the person back while agents write).
  let currentRow = $state.raw<HTMLElement | null>(null);
  const markCurrent = (el: HTMLElement) => {
    currentRow = el;
    return () => {
      if (currentRow === el) currentRow = null;
    };
  };
  let scrolledTo: string | null = null;
  $effect(() => {
    const cur = current;
    const row = currentRow;
    void dirs;
    // The row may first appear when the index arrives; it must be this file's, not the last.
    if (scrolledTo === cur || !row || row.dataset.path !== cur) return;
    scrolledTo = cur;
    row.scrollIntoView({ block: "nearest" });
  });
  /** A revealed folder's row scrolls into view when it draws. */
  const reveal = (path: string) => (el: HTMLElement) => {
    if (revealing === path) {
      revealing = null;
      el.scrollIntoView({ block: "nearest" });
    }
  };

  // A file's page is loaded ahead when the pointer rests on it, or the keyboard reaches it; not
  // the file already open (a click rests the pointer on the row it opened, whose page has just
  // loaded it).
  let hoverTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => () => clearTimeout(hoverTimer));
  function enter(path: string) {
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
      if (path !== props.file) prefetchFile(props.urls, path);
    }, HOVER_MS);
  }
  const s = (n: number) => (n === 1 ? "" : "s");
;
async () => {







 { svelteHTML.createElement("nav", { "aria-label":`Files`,});
   { svelteHTML.createElement("ul", { "class":`tree`,});;__sveltets_2_ensureSnippet(rows("")); }
 }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const Tree__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type Tree__SvelteComponent_ = ReturnType<typeof Tree__SvelteComponent_>;
/*Ωignore_endΩ*/export default Tree__SvelteComponent_;