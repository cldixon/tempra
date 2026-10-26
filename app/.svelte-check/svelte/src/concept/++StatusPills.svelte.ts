///<reference types="svelte" />
;
;type $$ComponentProps =  { status: string | null; stale: boolean };function $$render() {

  /** What is exceptional about the page, as pills: a status that is not stable, and stale. */
  let { status, stale }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
  const shown = $derived.by(() => {
    const s = status?.trim();
    return s && s.toLowerCase() !== "stable" ? s : null;
  });
;
async () => {

if(shown || stale){ { svelteHTML.createElement("span", { "class":`byline-pills`,});if(shown){ { svelteHTML.createElement("span", { "class":`chip`,});shown.charAt(0).toUpperCase() + shown.slice(1); }}if(stale){ { svelteHTML.createElement("span", { "class":`chip`,});  }} }}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const StatusPills__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type StatusPills__SvelteComponent_ = ReturnType<typeof StatusPills__SvelteComponent_>;
/*Ωignore_endΩ*/export default StatusPills__SvelteComponent_;