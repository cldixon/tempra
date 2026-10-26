///<reference types="svelte" />
;
import { navigate } from "./router";

;type $$ComponentProps =  { to: string };function $$render() {

  

  /** A page that moved (`-/needs` into the Inbox, `-/work` to the home): the URL is replaced, as the server's 308 does. */
  let { to }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
  $effect(() => navigate(to, { replace: true }));
;
async () => {
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const Redirect__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type Redirect__SvelteComponent_ = ReturnType<typeof Redirect__SvelteComponent_>;
/*Ωignore_endΩ*/export default Redirect__SvelteComponent_;