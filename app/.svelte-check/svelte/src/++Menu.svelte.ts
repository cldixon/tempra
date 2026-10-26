///<reference types="svelte" />
;
import { tick, type Snippet } from "svelte";

;type $$ComponentProps =  {
    /** The button's content. */
    label: Snippet;
    /** The button's accessible name, when its content is not one (the avatar). */
    name?: string;
    title?: string;
    buttonClass?: string;
    /** A class for the list, for one that has a shape of its own (the libraries, the bell). */
    listClass?: string;
    align?: "start" | "end";
    /** Opens above its button (a menu at the bottom of the sidebar). */
    up?: boolean;
    /** Told when the menu opens or closes. */
    onOpen?(open: boolean): void;
    children: Snippet;
  };function $$render() {

  

  /**
   * A button that opens a list of links under it. It closes on a choice, a click elsewhere,
   * Escape or the focus leaving it, and gives the focus back to its button. Down (or Up) on the
   * button opens it at its first (or last) choice; in the list Up, Down, Home and End move
   * between the choices (F-16, TEMPRA-133).
   */
  let props:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();

  const id = $props.id();
  let open = $state(false);
  let box: HTMLDivElement | undefined = $state();
  let button: HTMLButtonElement | undefined = $state();

  function setOpen(next: boolean) {
    if (next === open) return;
    open = next;
    props.onOpen?.(next);
  }

  /** The choices in the list that take the keys: its links and enabled buttons, as shown. */
  function choices(): HTMLElement[] {
    const list = document.getElementById(id);
    if (!list) return [];
    return Array.from(
      list.querySelectorAll<HTMLElement>("a[href], button:not([disabled])"),
    ).filter((el) => el.getClientRects().length > 0);
  }

  function focusChoice(which: "first" | "last") {
    const items = choices();
    (which === "first" ? items[0] : items[items.length - 1])?.focus();
  }

  const MENU_KEYS: ReadonlySet<string> = new Set(["ArrowDown", "ArrowUp", "Home", "End"]);

  async function onkeydown(e: KeyboardEvent) {
    if (!MENU_KEYS.has(e.key) || e.altKey || e.ctrlKey || e.metaKey) return;
    const t = e.target as Element;
    if (t.closest("input, textarea, select")) return;
    if (t === button) {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const which = e.key === "ArrowDown" ? "first" : "last";
      if (!open) {
        setOpen(true);
        await tick();
      }
      focusChoice(which);
      return;
    }
    const items = choices();
    if (items.length === 0) return;
    e.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? items.length - 1
          : e.key === "ArrowDown"
            ? (at + 1) % items.length
            : (at - 1 + items.length) % items.length;
    items[next]?.focus();
  }

  $effect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
      button?.focus();
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key, true);
    };
  });
;
async () => {


  { const $$_div0 = svelteHTML.createElement("div", {      "class":`menu`,onkeydown,"onfocusout":(e) => {
    // The focus moving to something outside (Tab, a click on a control) closes it; a click on
    // the list's own ground, which leaves the focus nowhere, does not.
    const to = e.relatedTarget;
    if (open && to instanceof Node && !box?.contains(to)) setOpen(false);
  },});box = $$_div0;
   { const $$_button1 = svelteHTML.createElement("button", {                "type":`button`,"class":props.buttonClass ?? "menu-button","aria-expanded":open,"aria-controls":id,"aria-label":props.name,"title":props.title,"onclick":() => setOpen(!open),});button = $$_button1;
    ;__sveltets_2_ensureSnippet(props.label());
   }
  if(open){
    
    
     { svelteHTML.createElement("div", {      id,"class":`menu-list ${props.align ?? "start"}${props.up ? " up" : ""}${props.listClass ? ` ${props.listClass}` : ""}`,"onclick":(e) => {
        const choice = (e.target as Element).closest("a, button");
        if (choice && !choice.hasAttribute("data-stay")) setOpen(false);
      },});
      ;__sveltets_2_ensureSnippet(props.children());
     }
  }
 }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const Menu__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type Menu__SvelteComponent_ = ReturnType<typeof Menu__SvelteComponent_>;
/*Ωignore_endΩ*/export default Menu__SvelteComponent_;