///<reference types="svelte" />
;
import type { Snippet } from "svelte";
import type { Loaded } from "./api";
import ErrorView from "./ErrorView.svelte";
function $$render<T>() {

  
  
  ;type $$ComponentProps =  { loaded: Loaded<T>; children: Snippet<[T]> };

  /** What a page shows while its data loads or when it failed. */
  let { loaded, children }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
;
async () => {

if(loaded.state === "loading"){
   { svelteHTML.createElement("p", { "class":`muted`,});  }
} else if (loaded.state === "error"){
   { const $$_weiVrorrE0C = __sveltets_2_ensureComponent(ErrorView); new $$_weiVrorrE0C({ target: __sveltets_2_any(), props: {  "error":loaded.error,}});}
}else{
  ;__sveltets_2_ensureSnippet(children(loaded.data));
}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
class __sveltets_Render<T> {
    props(): ReturnType<typeof $$render<T>>['props'] { return null as any; }
    events(): ReturnType<typeof $$render<T>>['events'] { return null as any; }
    slots(): ReturnType<typeof $$render<T>>['slots'] { return null as any; }
    bindings() { return __sveltets_$$bindings(''); }
    exports() { return {}; }
}

interface $$IsomorphicComponent {
    new <T>(options: import('svelte').ComponentConstructorOptions<ReturnType<__sveltets_Render<T>['props']>>): import('svelte').SvelteComponent<ReturnType<__sveltets_Render<T>['props']>, ReturnType<__sveltets_Render<T>['events']>, ReturnType<__sveltets_Render<T>['slots']>> & { $$bindings?: ReturnType<__sveltets_Render<T>['bindings']> } & ReturnType<__sveltets_Render<T>['exports']>;
    <T>(internal: unknown, props: ReturnType<__sveltets_Render<T>['props']> & {}): ReturnType<__sveltets_Render<T>['exports']>;
    z_$$bindings?: ReturnType<__sveltets_Render<any>['bindings']>;
}
const Status__SvelteComponent_: $$IsomorphicComponent = null as any;
/*Ωignore_startΩ*/type Status__SvelteComponent_<T> = InstanceType<typeof Status__SvelteComponent_<T>>;
/*Ωignore_endΩ*/export default Status__SvelteComponent_;