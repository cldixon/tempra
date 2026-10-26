///<reference types="svelte" />
;
import type { ApiError } from "./api";
import { useTitle } from "./ui.svelte.ts";

;type $$ComponentProps =  { error: ApiError };function $$render() {

  
  

  let { error }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
  const title = $derived(error.status === 404 ? "Not found" : "Something went wrong");
  useTitle(() => title);
;
async () => {

 { svelteHTML.createElement("h1", {});title; }
 { svelteHTML.createElement("p", {});error.message; }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const ErrorView__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type ErrorView__SvelteComponent_ = ReturnType<typeof ErrorView__SvelteComponent_>;
/*Ωignore_endΩ*/export default ErrorView__SvelteComponent_;