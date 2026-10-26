///<reference types="svelte" />
;
import { ApiError } from "../api";
import type { Urls } from "../urls";
import { markChecked } from "./checked";

;type $$ComponentProps =  { urls: Urls; path: string; onVerified(): void };function $$render() {

  
  
  

  /** A note and Mark as checked: the person vouches for the version on screen. */
  let { urls, path, onVerified }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
  let error = $state<string | null>(null);
  let busy = $state(false);
  async function submit(e: SubmitEvent & { currentTarget: HTMLFormElement }) {
    e.preventDefault();
    const note = String(new FormData(e.currentTarget).get("note") ?? "").trim();
    busy = true;
    error = null;
    try {
      await markChecked(urls, path, note);
      onVerified();
    } catch (err) {
      error = err instanceof ApiError ? err.message : String(err);
    } finally {
      busy = false;
    }
  }
;
async () => {

 { svelteHTML.createElement("form", {    "class":`verify-form`,"onsubmit":submit,}); { svelteHTML.createElement("input", {        "type":`text`,"name":`note`,"placeholder":`Note (optional)`,"aria-label":`Note`,});} { svelteHTML.createElement("button", {     "class":`primary`,"type":`submit`,"disabled":busy,});   }if(error){ { svelteHTML.createElement("span", { "class":`warn`,});error; }} }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const CheckForm__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type CheckForm__SvelteComponent_ = ReturnType<typeof CheckForm__SvelteComponent_>;
/*Ωignore_endΩ*/export default CheckForm__SvelteComponent_;