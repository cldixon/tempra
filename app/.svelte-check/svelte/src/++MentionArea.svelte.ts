///<reference types="svelte" />
;
import { mentionAt, offered } from "./mentions";

;type $$ComponentProps =  {
    value: string;
    onValue(v: string): void;
    people: string[];
    /** The textarea, for a caller that focuses it. */
    textarea?: HTMLTextAreaElement;
    id?: string;
    placeholder?: string;
    onkeydown?(e: KeyboardEvent & { currentTarget: HTMLTextAreaElement }): void;
    onblur?(e: FocusEvent & { currentTarget: HTMLTextAreaElement }): void;
  };function $$render() {

  

  /** A textarea that offers handles after @; Up and Down choose, Enter or Tab takes one. */
  let {
    value,
    onValue,
    people,
    textarea = $bindable(),
    id: boxId,
    placeholder,
    onkeydown,
    onblur,
  }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props()/*Ωignore_startΩ*/;textarea;/*Ωignore_endΩ*/;

  let at = $state<{ start: number; query: string } | null>(null);
  let active = $state(0);
  const id = $props.id();
  const options = $derived(at ? offered(people, at.query) : []);
  const open = $derived(options.length > 0);

  function update(el: HTMLTextAreaElement) {
    const next = mentionAt(el.value, el.selectionStart);
    if (next?.query !== at?.query) active = 0;
    at = next;
  }
  function take(handle: string) {
    const el = textarea;
    if (!el || !at) return;
    const caret = at.start + handle.length + 2;
    const next = `${value.slice(0, at.start)}@${handle} ${value.slice(el.selectionStart)}`;
    onValue(next);
    at = null;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  }
  function keys(e: KeyboardEvent & { currentTarget: HTMLTextAreaElement }) {
    if (open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const step = e.key === "ArrowDown" ? 1 : -1;
        active = (active + step + options.length) % options.length;
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        take(options[active] ?? "");
        return;
      }
      if (e.key === "Escape") {
        // Closes the list only, not the draft around it.
        e.preventDefault();
        e.stopPropagation();
        at = null;
        return;
      }
    }
    onkeydown?.(e);
  }
;
async () => {

 { svelteHTML.createElement("div", {  "class":`mention-box`,}); { const $$_textarea1 = svelteHTML.createElement("textarea", {                        "id":boxId,placeholder,value,"role":`combobox`,"aria-expanded":open,"aria-controls":id,"aria-autocomplete":`list`,"aria-activedescendant":open ? `${id}-${active}` : undefined,"oninput":(e) => {
      onValue(e.currentTarget.value);
      update(e.currentTarget);
    },"onkeydown":keys,"onkeyup":(e) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") update(e.currentTarget);
    },"onblur":(e) => {
      // A click on an option lands first (pointerdown keeps the focus).
      at = null;
      onblur?.(e);
    },});textarea = $$_textarea1; }if(open){ { svelteHTML.createElement("div", {       id,"role":`listbox`,"aria-label":`People`,"class":`menu-list start mention-list`,});    for(let h of __sveltets_2_ensureArray(options)){let i = 1;h; { svelteHTML.createElement("button", {            "id":`${id}-${i}`,"type":`button`,"role":`option`,"aria-selected":i === active,"tabindex":-1,"onpointerdown":(e) => {
            e.preventDefault();
            take(h);
          },}); h; }} }} }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings('textarea'), slots: {}, events: {} }}
const MentionArea__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type MentionArea__SvelteComponent_ = ReturnType<typeof MentionArea__SvelteComponent_>;
/*Ωignore_endΩ*/export default MentionArea__SvelteComponent_;