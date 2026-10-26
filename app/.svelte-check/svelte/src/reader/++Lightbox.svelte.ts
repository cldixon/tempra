///<reference types="svelte" />
;
/**
   * The full-screen view of a concept's figures (tempra-dev: app/reader, Figures): over the app on
   * the ground colour, the image (or the diagram, drawn again at the view's size) as large as
   * fits, previous and next through the concept's figures ("fig. n of m"), Escape to close. For an
   * image, Download and Open file (its attachment page; "Open original" for an external image) as
   * pills, and beneath the caption a quiet line: its path, size, the host it was fetched from, who
   * added it and what it shows (TEMPRA-170), asked of the page when the view opens
   * (`FigureView.describe`); an external image shows its URL. A video plays here and audio too; a
   * PDF is its card, Open going to its page (TEMPRA-164).
   *
   * A modal <dialog> (showModal: the top layer, focus kept inside, Escape), its look in reader.css.
   */
import { untrack } from "svelte";
import Icon from "../Icon.svelte";
import DiagramStage from "./DiagramStage.svelte";
import ImageStage from "./ImageStage.svelte";
import { type FigureView, factsLine, type ImageFacts } from "./lightbox";
import type { Figure } from "./prepare";

;type $$ComponentProps =  {
    figures: readonly Figure[];
    /** The figure shown (its number, from 1). */
    at: number;
    view?: FigureView;
    onMove(n: number): void;
    onClose(): void;
  };function $$render() {

  
  
  
  
  
  
  

  let {
    figures,
    at,
    view,
    onMove,
    onClose,
  }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
  const figure = $derived(figures[at - 1]);
  let dialog: HTMLDialogElement | undefined = $state();
  let close: HTMLButtonElement | undefined = $state();
  const label = `${$props.id()}-label`;
  const caption = `${label}-caption`;

  // Opened modally once, closed (and the focus given back) when it goes.
  $effect(() => {
    const el = dialog;
    if (!el) return;
    return untrack(() => {
      const before = el.ownerDocument.activeElement as HTMLElement | null;
      if (!el.open) {
        if (typeof el.showModal === "function") el.showModal();
        else el.setAttribute("open", "");
      }
      close?.focus();
      return () => {
        if (el.open && typeof el.close === "function") el.close();
        before?.focus?.();
      };
    });
  });

  // The facts under an image in the library, asked once per path.
  const cache = new Map<string, ImageFacts | null>();
  let facts = $state.raw<{ path: string; facts: ImageFacts | null } | null>(null);
  const path = $derived(figure?.kind === "image" ? figure.path : null);
  $effect(() => {
    const p = path;
    const describe = view?.describe;
    if (p === null || !describe) return;
    if (cache.has(p)) {
      facts = { path: p, facts: cache.get(p) ?? null };
      return;
    }
    let live = true;
    describe(p).then(
      (f) => {
        cache.set(p, f);
        if (live) facts = { path: p, facts: f };
      },
      () => {
        if (live) facts = { path: p, facts: null };
      },
    );
    return () => {
      live = false;
    };
  });

  const total = $derived(figures.length);
  const prev = $derived(at > 1 ? at - 1 : null);
  const next = $derived(at < total ? at + 1 : null);
  const image = $derived(figure?.kind === "image" ? figure : null);
  const line = $derived(
    image ? factsLine(image, facts?.path === image.path ? facts.facts : null) : null,
  );

  const keys = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      // The view's own: no page-wide Escape (a drawer, a menu) acts on it too.
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === "ArrowLeft" && prev !== null) {
      e.preventDefault();
      onMove(prev);
    } else if (e.key === "ArrowRight" && next !== null) {
      e.preventDefault();
      onMove(next);
    }
  };
;
async () => {

if(figure){
   { const $$_dialog0 = svelteHTML.createElement("dialog", {            "class":`lightbox`,"aria-labelledby":label,"aria-describedby":figure.caption ? caption : undefined,"onkeydown":keys,"oncancel":(e) => {
      e.preventDefault();
      onClose();
    },});dialog = $$_dialog0;
     { svelteHTML.createElement("header", {  "class":`lightbox-head`,});if(view?.title){ { svelteHTML.createElement("span", { "class":`lightbox-where`,});view.title; }} { svelteHTML.createElement("span", {  "id":label,}); figure.n;  total; } { svelteHTML.createElement("span", {  "class":`lightbox-actions`,});if(image?.src){ { svelteHTML.createElement("a", {   "href":image.path && view?.downloadHref ? view.downloadHref(image.path) : image.src,"download":"",}); { const $$_nocI4C = __sveltets_2_ensureComponent(Icon); new $$_nocI4C({ target: __sveltets_2_any(), props: {  "name":`download`,}});}  }}if(image?.path && view?.fileHref){ { svelteHTML.createElement("a", {    "href":view.fileHref(image.path),"onclick":onClose,});  }} else if (image?.src){ { svelteHTML.createElement("a", {      "href":image.src,"target":`_blank`,"rel":`noopener noreferrer`,});  }} { const $$_button3 = svelteHTML.createElement("button", {         "type":`button`,"class":`lightbox-round`,"aria-label":`Close`,"onclick":onClose,});close = $$_button3; { const $$_nocI4C = __sveltets_2_ensureComponent(Icon); new $$_nocI4C({ target: __sveltets_2_any(), props: {  "name":`close`,}});} } } } { svelteHTML.createElement("div", {  "class":`lightbox-stage`,});if(total > 1){ { svelteHTML.createElement("button", {          "type":`button`,"class":`lightbox-round lightbox-prev`,"aria-label":`Previous figure`,"disabled":prev === null,"onclick":() => prev !== null && onMove(prev),}); { const $$_nocI3C = __sveltets_2_ensureComponent(Icon); new $$_nocI3C({ target: __sveltets_2_any(), props: {    "name":`previous`,"size":18,}});} }}figure.n; { { svelteHTML.createElement("div", {  "class":`lightbox-figure`,});if(figure.kind === "image"){ { const $$_egatSegamI3C = __sveltets_2_ensureComponent(ImageStage); new $$_egatSegamI3C({ target: __sveltets_2_any(), props: { figure,}});}}else{ { const $$_egatSmargaiD3C = __sveltets_2_ensureComponent(DiagramStage); new $$_egatSmargaiD3C({ target: __sveltets_2_any(), props: {  figure,}});}} }}if(total > 1){ { svelteHTML.createElement("button", {          "type":`button`,"class":`lightbox-round lightbox-next`,"aria-label":`Next figure`,"disabled":next === null,"onclick":() => next !== null && onMove(next),}); { const $$_nocI3C = __sveltets_2_ensureComponent(Icon); new $$_nocI3C({ target: __sveltets_2_any(), props: {    "name":`next`,"size":18,}});} }} } { svelteHTML.createElement("footer", {  "class":`lightbox-foot`,});if(figure.caption){ { svelteHTML.createElement("p", {   "class":`lightbox-caption`,"id":caption,});figure.caption; }} { svelteHTML.createElement("p", {  "class":`lightbox-facts`,});if(line){ { svelteHTML.createElement("span", {});line; }} { svelteHTML.createElement("span", {  "class":`lightbox-hint`,});  total > 1 ? ", ← → between figures" : ""; } } }
   }
}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const Lightbox__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type Lightbox__SvelteComponent_ = ReturnType<typeof Lightbox__SvelteComponent_>;
/*Ωignore_endΩ*/export default Lightbox__SvelteComponent_;