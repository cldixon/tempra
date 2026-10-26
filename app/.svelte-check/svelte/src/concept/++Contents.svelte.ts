///<reference types="svelte" />
;
import type { Entry } from "./contents";

;type $$ComponentProps =  { headings: Entry[]; onPick?(): void };function $$render() {

  

  /**
   * The concept's contents (take 4; tempra-dev: app/reader, Contents): its top two heading levels,
   * nested, on the right of the page while no panel is open and there is room, otherwise under the
   * byline ("On this page"). The section in view is marked with a rule.
   */
  let { headings, onPick }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();

  // The heading the page is scrolled to: the last one above the top of the view.
  let current = $state<string | null>(null);
  const ids = $derived(headings.map((h) => h.id).join(" "));
  $effect(() => {
    const scroller = document.querySelector(".ws-main");
    if (!scroller || !ids) return;
    const list = ids.split(" ");
    const update = () => {
      const top = scroller.getBoundingClientRect().top + 120;
      let at: string | null = list[0] ?? null;
      for (const id of list) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= top) at = id;
      }
      current = at;
    };
    update();
    scroller.addEventListener("scroll", update, { passive: true });
    return () => scroller.removeEventListener("scroll", update);
  });
;
async () => {

 { svelteHTML.createElement("ul", { "class":`toc`,});
     for(let h of __sveltets_2_ensureArray(headings)){h.id; { svelteHTML.createElement("li", { "class":h.sub ? "sub" : undefined,}); { svelteHTML.createElement("a", {     "href":`#${h.id}`,"aria-current":h.id === current ? "location" : undefined,"onclick":() => onPick?.(),});h.text; } }}
 }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const Contents__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type Contents__SvelteComponent_ = ReturnType<typeof Contents__SvelteComponent_>;
/*Ωignore_endΩ*/export default Contents__SvelteComponent_;