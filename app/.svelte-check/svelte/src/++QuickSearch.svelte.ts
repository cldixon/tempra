///<reference types="svelte" />
;
import { untrack } from "svelte";
import { navigate } from "./router";
import type { Option } from "./switcher";

;type $$ComponentProps =  {
    open: boolean;
    onClose(): void;
    /** "Search <library>", or "Search libraries". */
    label: string;
    q: string;
    onQuery(q: string): void;
    options: Option[];
    /** The option under the cursor (a library's file starts loading). */
    onSelect?(o: Option): void;
    /** What shows when there are no options: a hint, "Searching…", "No results" or an error. */
    empty: string;
    /** A quiet line under the options there are (search inside pages failed: titles only). */
    note?: string | null;
  };function $$render() {

  
  
  

  /**
   * The quick search's dialog (tempra-dev: app/workspace): a box, the options under it, the
   * keyboard on the box (Up, Down, Enter, Escape); a click outside closes it. What it searches is
   * its caller's: a library's files (Switcher) or the person's libraries (LibrarySearch).
   */
  let props:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
  let dialog: HTMLDialogElement | undefined = $state();
  const listId = $props.id();
  let index = $state(0);

  $effect(() => {
    const d = dialog;
    const open = props.open;
    if (!d) return;
    if (open && !d.open) {
      index = 0;
      d.showModal();
    } else if (!open && d.open) {
      d.close();
    }
  });

  const selected = $derived(Math.min(index, Math.max(props.options.length - 1, 0)));
  const pick = $derived(props.options[selected]);
  $effect(() => {
    const o = pick;
    if (props.open && o) untrack(() => props.onSelect?.(o));
  });

  function go(o: Option | undefined) {
    if (!o) return;
    props.onClose();
    navigate(o.href);
  }
  function keys(e: KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      index = Math.max(0, Math.min(index + 1, props.options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      index = Math.max(index - 1, 0);
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(props.options[selected]);
    } else if (e.key === "Escape") {
      // A search box would only clear itself on the first Escape; this one closes.
      e.preventDefault();
      props.onClose();
    }
  }
  const optionId = (i: number) => `${listId}-${i}`;
;
async () => {



  { const $$_dialog0 = svelteHTML.createElement("dialog", {         "class":`switcher`,"aria-label":props.label,"onclose":(e) => {
    // The close event comes a moment after the dialog closes; if it opened again meanwhile
    // (the keys pressed twice quickly), the late event must not close it.
    if (!e.currentTarget.open) props.onClose();
  },"onclick":(e) => {
    // A click on the backdrop lands on the dialog itself, outside its box.
    const r = e.currentTarget.getBoundingClientRect();
    const inside =
      e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (e.target === e.currentTarget && !inside) props.onClose();
  },});dialog = $$_dialog0;
   { svelteHTML.createElement("div", { "class":`switcher-head`,});
     { svelteHTML.createElement("input", {                       "type":`search`,"role":`combobox`,"aria-expanded":props.options.length > 0,"aria-controls":listId,"aria-activedescendant":props.options.length > 0 ? optionId(selected) : undefined,"aria-autocomplete":`list`,"placeholder":props.label,"aria-label":props.label,"value":props.q,"oninput":(e) => {
        props.onQuery(e.currentTarget.value);
        index = 0;
      },"onkeydown":keys,});}
   }
   { svelteHTML.createElement("div", {     "id":listId,"role":`listbox`,"aria-label":`Results`,});
        for(let o of __sveltets_2_ensureArray(props.options)){let i = 1;o.key;
      
      
       { svelteHTML.createElement("div", {         "id":optionId(i),"role":`option`,"tabindex":-1,"aria-selected":i === selected,"onclick":() => go(o),});o.title;  { svelteHTML.createElement("span", { "class":`muted small`,});o.detail; } }
    }
   }
   { svelteHTML.createElement("p", {   "class":`muted small switcher-status`,"role":`status`,});props.options.length === 0 ? props.empty : (props.note ?? ""); }
 }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const QuickSearch__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type QuickSearch__SvelteComponent_ = ReturnType<typeof QuickSearch__SvelteComponent_>;
/*Ωignore_endΩ*/export default QuickSearch__SvelteComponent_;