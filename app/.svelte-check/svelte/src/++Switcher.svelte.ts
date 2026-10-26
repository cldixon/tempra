///<reference types="svelte" />
;
import { api } from "./api";
import { prefetchFile } from "./prefetch";
import QuickSearch from "./QuickSearch.svelte";
import { readRecent } from "./recent";
import { fileOptions, type Hit, type Option, prefixQuery } from "./switcher";
import type { OutlineFile } from "./tree";
import type { Urls } from "./urls";

;type $$ComponentProps =  {
    urls: Urls;
    /** The library's title (else its slug), as search names itself. */
    name: string;
    index: OutlineFile[];
    open: boolean;
    onClose(): void;
  };function $$render() {

  
  
  
  
  
  
  

  /**
   * The quick switcher in a library (tempra-dev: app/workspace): Ctrl or Cmd+K, type a title or
   * path, Enter. Recent files first, then titles and paths from the library's index (instant), then
   * the library's search inside files.
   */
  let props:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
  let q = $state("");
  let found = $state.raw<Hit[]>([]);
  // Search inside pages (F-12): "Searching…" until the answer, "No results" only after it, and
  // a line when it failed (titles and paths still match from the index).
  let search = $state<"idle" | "searching" | "done" | "failed">("idle");

  $effect(() => {
    if (props.open) {
      q = "";
      found = [];
      search = "idle";
    }
  });

  // Search inside files as the person types: every word a prefix, as an editor's quick open does.
  $effect(() => {
    const words = q.trim().split(/\s+/).filter(Boolean);
    const urls = props.urls;
    if (words.length === 0) {
      found = [];
      search = "idle";
      return;
    }
    let live = true;
    search = "searching";
    const t = setTimeout(() => {
      api<{ results: Hit[] }>(urls.api("search", { q: prefixQuery(words), limit: 10 }))
        .then((r) => {
          if (!live) return;
          found = r.results;
          search = "done";
        })
        .catch(() => {
          if (!live) return;
          found = [];
          search = "failed";
        });
    }, 150);
    return () => {
      live = false;
      clearTimeout(t);
    };
  });

  const needle = $derived(q.trim().toLowerCase());
  const options = $derived(
    fileOptions(props.urls, needle, readRecent(props.urls), props.index, found),
  );

  // The selected file starts loading, so Enter opens a page that is already here.
  const select = (o: Option) => prefetchFile(props.urls, o.key);
  const empty = $derived(
    !needle
      ? "Type a title or path."
      : search === "failed"
        ? "Search didn't answer. Try again in a moment."
        : search === "done"
          ? "No results"
          : "Searching…",
  );
;
async () => {

 { const $$_hcraeSkciuQ0C = __sveltets_2_ensureComponent(QuickSearch); new $$_hcraeSkciuQ0C({ target: __sveltets_2_any(), props: {                "open":props.open,"onClose":props.onClose,"label":`Search ${props.name}`,q,"onQuery":(v) => (q = v),options,"onSelect":select,empty,"note":search === "failed" ? "Search inside pages didn't answer; titles only." : null,}});}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const Switcher__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type Switcher__SvelteComponent_ = ReturnType<typeof Switcher__SvelteComponent_>;
/*Ωignore_endΩ*/export default Switcher__SvelteComponent_;