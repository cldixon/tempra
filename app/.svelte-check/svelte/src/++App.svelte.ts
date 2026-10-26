///<reference types="svelte" />
;
import AccountMenu from "./AccountMenu.svelte";
import Bell from "./Bell.svelte";
import { here } from "./location.svelte.ts";
import { useMe } from "./ui.svelte.ts";
function $$render() {

  
  
  
  
  const me = useMe();
;
async () => {

 { svelteHTML.createElement("p", {});here.url.pathname; }
 { const $$_lleB0C = __sveltets_2_ensureComponent(Bell); new $$_lleB0C({ target: __sveltets_2_any(), props: {}});}
 { const $$_uneMtnuoccA0C = __sveltets_2_ensureComponent(AccountMenu); new $$_uneMtnuoccA0C({ target: __sveltets_2_any(), props: {  "me":me.current,}});}
};
return { props: {} as Record<string, never>, exports: {}, bindings: "", slots: {}, events: {} }}
const App__SvelteComponent_ = __sveltets_2_isomorphic_component(__sveltets_2_with_any_event($$render()));
/*Ωignore_startΩ*/type App__SvelteComponent_ = InstanceType<typeof App__SvelteComponent_>;
/*Ωignore_endΩ*/export default App__SvelteComponent_;