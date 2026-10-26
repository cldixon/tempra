///<reference types="svelte" />
;
import { baseName, type Urls } from "../urls";
import type { Use } from "./attachment";

;type $$ComponentProps =  {
    urls: Urls;
    /** The pages linking it, in order; null while loading. */
    paths: readonly string[] | null;
    uses: readonly Use[] | null;
    titles: ReadonlyMap<string, string>;
  };function $$render() {

  
  

  /** Used in: each page that links the file, and the figures it appears as there. */
  let props:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
;
async () => {

if(props.paths === null){ } else if (props.paths.length === 0){ { svelteHTML.createElement("span", { "class":`muted`,});    }}else{ { svelteHTML.createElement("ul", { "class":`attachment-used`,});
       for(let p of __sveltets_2_ensureArray(props.paths)){p;
      const figures = props.uses?.find((u) => u.path === p)?.figures ?? [];
       { svelteHTML.createElement("li", { }); { svelteHTML.createElement("a", { "href":props.urls.file(p),});props.titles.get(p) ?? baseName(p); }   for(let f of __sveltets_2_ensureArray(figures)){f.n; { svelteHTML.createElement("div", { "class":`attachment-figure`,}); f.n;f.caption ? `. ${f.caption}` : ""; }} }
    }
   }}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const UsedIn__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type UsedIn__SvelteComponent_ = ReturnType<typeof UsedIn__SvelteComponent_>;
/*Ωignore_endΩ*/export default UsedIn__SvelteComponent_;