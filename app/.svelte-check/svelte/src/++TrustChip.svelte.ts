///<reference types="svelte" />
;
import Chip from "./Chip.svelte";

;type $$ComponentProps =  { tier: string | undefined };function $$render() {

  

  let { tier }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
;
async () => {

if(tier === "human-reviewed"){
   { const $$_pihC0C = __sveltets_2_ensureComponent(Chip); new $$_pihC0C({ target: __sveltets_2_any(), props: {      "text":`human-reviewed`,"tone":`ok`,"title":`A human verified this version`,}});}
} else if (tier === "machine-confirmed"){
   { const $$_pihC0C = __sveltets_2_ensureComponent(Chip); new $$_pihC0C({ target: __sveltets_2_any(), props: {    "text":`machine-confirmed`,"title":`A process re-checked this version`,}});}
}else{
   { const $$_pihC0C = __sveltets_2_ensureComponent(Chip); new $$_pihC0C({ target: __sveltets_2_any(), props: {      "text":`unverified`,"tone":`warn`,"title":`Nobody has verified this version`,}});}
}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const TrustChip__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type TrustChip__SvelteComponent_ = ReturnType<typeof TrustChip__SvelteComponent_>;
/*Ωignore_endΩ*/export default TrustChip__SvelteComponent_;