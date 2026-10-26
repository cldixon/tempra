///<reference types="svelte" />
;
/**
   * The frame of a figure drawn from its markup (`:::figure`, tempra-dev: app/media): its
   * placement, frame and group as classes (prose.css), and its width as `--figure-width`, set
   * through the CSSOM, as the reader's popovers set `--float-x`, so no style attribute is written
   * (CSP).
   */
import type { FigureSpec } from "@tempra/editor";
import type { Snippet } from "svelte";

;type $$ComponentProps =  { spec: FigureSpec; count: number; block: string | undefined; children: Snippet };function $$render() {

  
  
  

  let {
    spec,
    count,
    block,
    children,
  }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
  let el: HTMLElement | undefined = $state();
  const width = $derived(spec.width ? `${spec.width.value}${spec.width.unit}` : null);
  $effect(() => {
    if (!el) return;
    if (width) el.style.setProperty("--figure-width", width);
    else el.style.removeProperty("--figure-width");
  });
  const cls = $derived(
    [
      "figure",
      spec.layout !== "column" ? `figure-${spec.layout}` : "",
      spec.frame ? "figure-framed" : "",
      width ? "figure-sized" : "",
      count > 1 ? `figure-group figure-n-${count}` : "",
    ]
      .filter(Boolean)
      .join(" "),
  );
;
async () => {

 { const $$_figure0 = svelteHTML.createElement("figure", {     "class":cls,...__sveltets_2_empty({"data-block":block}),});el = $$_figure0;;__sveltets_2_ensureSnippet(children()); }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const FigureBox__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type FigureBox__SvelteComponent_ = ReturnType<typeof FigureBox__SvelteComponent_>;
/*Ωignore_endΩ*/export default FigureBox__SvelteComponent_;