///<reference types="svelte" />
;
import { actorText } from "../agents";
import { useActors } from "../agents.svelte.ts";
import { ApiError, api } from "../api";
import type { HistoryEvent } from "../concept/data";
import { useFrame } from "../frame.svelte.ts";
import Icon from "../Icon.svelte";
import { useLoad } from "../load.svelte.ts";
import Moment from "../Moment.svelte";
import PageColumn from "../PageColumn.svelte";
import { fileLabel } from "../tree";
import { useMe, useTitle } from "../ui.svelte.ts";
import { baseName, dirOf, enc, folderName, type Urls } from "../urls";
import { fateOf } from "./file";

;type $$ComponentProps =  { urls: Urls; path: string };function $$render() {

  
  
  
  
  
  
  
  
  
  
  
  
  

  /**
   * Not found (board 32): "This page isn't here", where the ledger says it went (moved, with Open;
   * or deleted), then Home and Search.
   */
  let { urls, path }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
  useTitle(() => "Not found");
  const me = useMe();
  const actors = useActors(
    () => urls,
    () => me.current?.actor ?? null,
  );
  const frame = useFrame();
  const fate = useLoad(
    () => `fate ${urls.base} ${path}`,
    async () => {
      if (path === "") return null;
      try {
        const h = await api<{ path: string; events: HistoryEvent[] }>(
          urls.api(`history/${enc(path)}`),
        );
        return fateOf(path, h);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
  );
  const f = $derived(fate.data ?? null);
  const who = $derived(f ? actorText(actors.view(f.actor, f.by)) : "");
  // Where it went, by its title and folder (H-13), as the tree names it.
  const where = $derived.by(() => {
    if (f?.kind !== "moved") return "";
    const moved = frame.index?.find((x) => x.path === f.to);
    return `${moved ? fileLabel(moved) : baseName(f.to).replace(/\.md$/, "")}${dirOf(f.to) ? ` (${folderName(dirOf(f.to))})` : ""}`;
  });
;
async () => {

  { const $$_nmuloCegaP0C = __sveltets_2_ensureComponent(PageColumn); new $$_nmuloCegaP0C({ target: __sveltets_2_any(), props: {children:() => { return __sveltets_2_any(0); },}}); { svelteHTML.createElement("div", {  "class":`not-found`,}); { svelteHTML.createElement("h1", { "class":`view-title`,});    }if(f?.kind === "moved"){ { svelteHTML.createElement("p", {  "class":`not-found-fate`,}); { svelteHTML.createElement("span", {});  where;  who;  { const $$_tnemoM4C = __sveltets_2_ensureComponent(Moment); new $$_tnemoM4C({ target: __sveltets_2_any(), props: {  "ts":f.ts,}});} } { svelteHTML.createElement("a", { "href":urls.file(f.to),});  } }}if(f?.kind === "deleted"){ { svelteHTML.createElement("p", {  "class":`not-found-fate`,}); { svelteHTML.createElement("span", {});  who;  { const $$_tnemoM4C = __sveltets_2_ensureComponent(Moment); new $$_tnemoM4C({ target: __sveltets_2_any(), props: {  "ts":f.ts,}});} } { svelteHTML.createElement("a", { "href":urls.activity({ view: "events", q: path }),});  } }} { svelteHTML.createElement("p", {  "class":`not-found-ways`,}); { svelteHTML.createElement("a", {   "class":`button`,"href":urls.tree(""),});  } { svelteHTML.createElement("button", {   "type":`button`,"onclick":() => frame.search(),}); { const $$_nocI4C = __sveltets_2_ensureComponent(Icon); new $$_nocI4C({ target: __sveltets_2_any(), props: {  "name":`search`,}});}  } } } PageColumn}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const NotFound__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type NotFound__SvelteComponent_ = ReturnType<typeof NotFound__SvelteComponent_>;
/*Ωignore_endΩ*/export default NotFound__SvelteComponent_;