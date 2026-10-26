///<reference types="svelte" />
;
import { docText } from "@tempra/editor";
import Note from "../reader/Note.svelte";
import type { Footnote, Prepared } from "../reader/prepare";
import { anchorId } from "../ui";
import type { Urls } from "../urls";
import type { JsonObject, Sources as SourcesData } from "./data";

;type $$ComponentProps =  {
    urls: Urls;
    data: SourcesData;
    prepared: Prepared;
    /** Each footnote label's number, as the body's markers show it. */
    numbers: Map<string, number>;
  };function $$render() {
 const footnoteNote/*Ωignore_positionΩ*/ = (f: Footnote)/*Ωignore_startΩ*/: ReturnType<import('svelte').Snippet>/*Ωignore_endΩ*/ => { async ()/*Ωignore_positionΩ*/ => { { svelteHTML.createElement("div", { "class":`small note`,}); { const $$_etoN1C = __sveltets_2_ensureComponent(Note); new $$_etoN1C({ target: __sveltets_2_any(), props: {    "prepared":props.prepared,"nodes":f.node.children,}});} }};return __sveltets_2_any(0)};
  
  
  
  
  
  

  /**
   * The concept's sources as a section at the end of the body (take 3; tempra-dev: app/reader,
   * Sources), numbered as the footnote markers and their cards number them, then any footnotes that
   * cite no source. Not part of the document's text: it sits after the reader, outside it.
   */
  let props:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();

  /** A footnote definition's text, for comparing with a source's title. */
  function plain(f: Footnote): string {
    return docText({ type: "root", children: f.node.children }).text.trim();
  }

  const footnotes = $derived(props.prepared.footnotes);
  const items = $derived.by(() => {
    const used = new Set<string>();
    const list = props.data.sources.map((s, i) => {
      const id = typeof s.id === "string" ? s.id : null;
      if (id) used.add(id);
      const name = typeof s.title === "string" ? s.title : (id ?? "Source");
      const resource = typeof s.resource === "string" ? s.resource : null;
      const internal = (s.internal ?? null) as JsonObject | null;
      // People's words only (TEMPRA-131): no paths, trust tiers or citation counts.
      const meta: string[] = [];
      let href: string | null = null;
      let external = false;
      if (internal?.broken) {
        meta.push("missing");
      } else if (internal && typeof internal.path === "string") {
        href = props.urls.file(internal.path);
        meta.push("in this library");
        if (internal.stale) meta.push("stale");
        if (internal.status && internal.status !== "stable") meta.push(String(internal.status));
      } else if (resource && /^https?:\/\//i.test(resource)) {
        href = resource;
        external = true;
        meta.push("external");
      } else if (resource) meta.push(resource);
      // The footnote's own text, unless it only repeats the source's title.
      const note = id ? footnotes.find((f) => f.label === id) : undefined;
      const def = note && plain(note) !== name.trim() ? note : undefined;
      return { key: id ?? String(i), n: i + 1, id, name, href, external, meta, def };
    });
    return { list, used };
  });
  const others = $derived(footnotes.filter((f) => !items.used.has(f.label)));
  const shown = $derived(
    items.list.length > 0 || others.length > 0 || props.data.unmatched_footnotes.length > 0,
  );
;
async () => {



if(shown){
   { svelteHTML.createElement("section", {      "id":`doc-sources`,"class":`doc-sources`,"aria-labelledby":`doc-sources-title`,}); { svelteHTML.createElement("h2", { "id":`doc-sources-title`,});  }if(items.list.length > 0){ { svelteHTML.createElement("ol", { "class":`sources`,});
           for(let item of __sveltets_2_ensureArray(items.list)){item.key; { svelteHTML.createElement("li", {  "id":item.id ? anchorId("src", item.id) : undefined,}); { svelteHTML.createElement("span", { "class":`num`,});item.n; } { svelteHTML.createElement("span", { });if(item.href === null){ { svelteHTML.createElement("span", {});item.name; }} else if (item.external){ { svelteHTML.createElement("a", {   "href":item.href,"rel":`noopener noreferrer nofollow`,});item.name; }}else{ { svelteHTML.createElement("a", { "href":item.href,});item.name; }} { svelteHTML.createElement("span", { "class":`meta`,});item.meta.join(" · "); }if(item.def){ { svelteHTML.createElement("span", { "class":`meta`,});;__sveltets_2_ensureSnippet(footnoteNote(item.def)); }} } }}
       }}if(others.length > 0){ { svelteHTML.createElement("h3", {});  } { svelteHTML.createElement("ul", { "class":`sources`,});
           for(let f of __sveltets_2_ensureArray(others)){f.label; { svelteHTML.createElement("li", { "id":anchorId("fn", f.label),}); { svelteHTML.createElement("span", { "class":`num`,});props.numbers.get(f.label) ?? f.label; };__sveltets_2_ensureSnippet(footnoteNote(f)); }}
       }}if(props.data.unmatched_footnotes.length > 0){ { svelteHTML.createElement("p", { "class":`small warn`,});   props.data.unmatched_footnotes.map((l) => `[^${l}]`).join(", "); }} }
}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const SourcesSection__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type SourcesSection__SvelteComponent_ = ReturnType<typeof SourcesSection__SvelteComponent_>;
/*Ωignore_endΩ*/export default SourcesSection__SvelteComponent_;