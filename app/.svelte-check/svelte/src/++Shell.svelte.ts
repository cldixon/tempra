///<reference types="svelte" />
;
  import type { Urls } from "./urls";

  /** The library a frame is about: its name, its address, whether it is shared, on its home. */
  export interface BrandLibrary {
    urls: Urls;
    name: string;
    shared: boolean;
    home: boolean;
  }

  /** Where the page was scrolled on each URL, for back and forward. */
  const scrolls = new Map<string, number>();
;;

import { type Snippet, untrack } from "svelte";
import AccountMenu from "./AccountMenu.svelte";
import Bell from "./Bell.svelte";
import Brand from "./Brand.svelte";
import { NARROW } from "./frame";
import { provideFrame, useMedia } from "./frame.svelte.ts";
import Icon from "./Icon.svelte";
import { here } from "./location.svelte.ts";
import { lastNavigation } from "./router";
import type { OutlineFile } from "./tree";
import type { Me } from "./ui";

;type $$ComponentProps =  {
    /** The library the pages are in (the bar names it, with its switcher); none on account pages. */
    library?: BrandLibrary;
    /** The sidebar's content (the drawer's on a phone). */
    sidebar: Snippet;
    /** Opens search (Ctrl or Cmd+K too): the library's quick switcher, or the libraries'. */
    onSearch?: () => void;
    /** The sidebar can be hidden (a library's own pages): its state and the way to change it. */
    hidden?: boolean;
    onHide?: (hidden: boolean) => void;
    /** A quiet word on the top bar when live updates have stopped (a library's feed, F-19). */
    status?: Snippet;
    me: Me | null;
    /** The library's index, for the pages (null off a library, or until it arrives). */
    index: OutlineFile[] | null;
    children: Snippet;
  };function $$render() {

  
  
  
  
  
  
  
  
  
  
  

  /*
   * The app's frame (take 4, TEMPRA-113; tempra-dev: app/workspace): a top bar across the window,
   * split at the sidebar's edge (the Tempra mark, the library's name with its switcher, and search
   * over the sidebar; the page's path, its tools, the bell and the avatar over the page), a
   * navigation sidebar (the tree, and a fixed foot of the library's tools), and the page as a flat
   * column: Linear's docs, translated (TEMPRA-145). A library's pages, its settings and the
   * account's pages all use it, each with its own sidebar. Under 900px the sidebar is a drawer
   * behind the top bar.
   *
   * The frame itself: the top bar, the sidebar (a drawer on a phone), and the page as the frame's
   * scroller. The page scrolls on its own: a new page starts at the top (or its #fragment), and
   * back or forward returns to where the person was on that page.
   */
  let props:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();

  let drawer = $state(false);
  const narrow = useMedia(() => NARROW);
  let sidebar: HTMLElement | undefined = $state();
  let menuButton: HTMLButtonElement | undefined = $state();
  let toolsSlot: HTMLElement | undefined = $state();
  let pathSlot: HTMLElement | undefined = $state();
  let ownTools = $state(false);
  let main: HTMLElement | undefined = $state();
  let topbar: HTMLElement | undefined = $state();

  // Modality (C-26, P-1; TEMPRA-133): what the open drawer dims (the top bar and the page), and
  // what a page's overlay dims (the top bar and the sidebar), is inert, so Tab and a screen reader
  // stay in the drawer or the overlay. Set on the elements at once, not on the next render, so
  // the focus can go back to a control in the bar as soon as either closes.
  let modal = false;
  let drawerOpen = false;
  function applyInert() {
    if (topbar) topbar.inert = drawerOpen || modal;
    if (main) main.inert = drawerOpen;
    if (sidebar) sidebar.inert = modal;
  }
  $effect(() => {
    drawerOpen = drawer;
    applyInert();
  });

  const href = $derived(here.url.pathname + here.url.search);
  let shownHref = untrack(() => href);
  $effect(() => {
    const h = href;
    if (shownHref === h) return;
    shownHref = h;
    const el = main;
    if (!el) return;
    const target = lastNavigation() === "pop" ? (scrolls.get(h) ?? 0) : 0;
    el.scrollTop = target;
    if (target === 0) return;
    // The page's body may still be drawing (the reader mounts after this): keep the position
    // until the page is tall enough to hold it, for up to a second, or until the person scrolls.
    const until = performance.now() + 1000;
    let frame = requestAnimationFrame(function again() {
      if (el.scrollTop !== target) el.scrollTop = target;
      if (el.scrollTop !== target && performance.now() < until) {
        frame = requestAnimationFrame(again);
      }
    });
    const stop = () => cancelAnimationFrame(frame);
    const inputs = ["wheel", "touchstart", "keydown", "pointerdown"] as const;
    for (const i of inputs) el.addEventListener(i, stop, { passive: true });
    return () => {
      stop();
      for (const i of inputs) el.removeEventListener(i, stop);
    };
  });

  // The drawer closes when the person moves to another page, and when the screen widens.
  $effect(() => {
    void href;
    drawer = false;
  });
  $effect(() => {
    if (!narrow.current) drawer = false;
  });
  // An opened drawer takes the focus, unless something in it already has; a tap anywhere else
  // (the dimmed page beside it) closes it, as a tap outside a menu does. Once it closes, the
  // focus it held goes back to the menu button.
  let wasOpen = false;
  $effect(() => {
    const open = drawer;
    const phone = narrow.current;
    if (!open) {
      const focused = document.activeElement;
      const lost = !focused || focused === document.body || sidebar?.contains(focused);
      if (wasOpen && phone && lost) menuButton?.focus();
      wasOpen = false;
      return;
    }
    wasOpen = true;
    if (!sidebar?.contains(document.activeElement)) sidebar?.focus();
    const away = (e: PointerEvent) => {
      const t = e.target instanceof Element ? e.target : null;
      if (!sidebar?.contains(t) && !t?.closest(".ws-menu, dialog")) drawer = false;
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  });

  // Keys: Escape closes the drawer (not from inside a dialog, which handles its own; an open menu
  // takes its Escape first and stops it, and once closed, with the focus on its button in the
  // drawer, the next Escape closes the drawer: TEMPRA-141);
  // Ctrl or Cmd+\ hides the sidebar where it can be hidden (a library's own, not a settings
  // page's or the account's, which are their navigation).
  $effect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target instanceof Element ? e.target : null;
      if (e.key === "Escape" && !e.defaultPrevented && drawer && !t?.closest("dialog")) {
        // Handled: a panel's bottom sheet under the drawer stays open for the next Escape.
        e.preventDefault();
        drawer = false;
      } else if ((e.ctrlKey || e.metaKey) && e.key === "\\" && !narrow.current && props.onHide) {
        e.preventDefault();
        props.onHide(!props.hidden);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const showSidebar = $derived(!props.hidden || narrow.current);
  const beside = $derived(showSidebar && !narrow.current);
  const slots = $derived({ tools: toolsSlot ?? null, path: pathSlot ?? null });
  provideFrame({
    get sidebar() {
      return beside;
    },
    get narrow() {
      return narrow.current;
    },
    get index() {
      return props.index;
    },
    get slots() {
      return slots;
    },
    setOwnTools(own: boolean) {
      ownTools = own;
    },
    setModal(on: boolean) {
      modal = on;
      applyInert();
    },
    search() {
      props.onSearch?.();
    },
  });
  const classes = $derived(
    [
      "workspace",
      showSidebar ? "" : "sidebar-hidden",
      ownTools ? "has-tools" : "",
      drawer ? "drawer-open" : "",
    ]
      .filter(Boolean)
      .join(" "),
  );
;
async () => {



 { svelteHTML.createElement("div", { "class":classes,});
   { const $$_header1 = svelteHTML.createElement("header", {  "class":`ws-topbar`,});topbar = $$_header1;
    
     { svelteHTML.createElement("div", { "class":`topbar-brand`,}); { const $$_dnarB3C = __sveltets_2_ensureComponent(Brand); new $$_dnarB3C({ target: __sveltets_2_any(), props: {    "library":props.library,"onSearch":props.onSearch,}});} }
     { svelteHTML.createElement("div", {  "class":`topbar-page`,}); { const $$_button3 = svelteHTML.createElement("button", {           "type":`button`,"class":`icon-button touch ws-menu`,"aria-label":`Menu`,"aria-expanded":drawer,"onclick":() => (drawer = !drawer),});menuButton = $$_button3; { const $$_nocI4C = __sveltets_2_ensureComponent(Icon); new $$_nocI4C({ target: __sveltets_2_any(), props: {  "name":`menu`,}});} } { svelteHTML.createElement("div", {  "class":`ws-topbar-place`,});  { const $$_dnarB4C = __sveltets_2_ensureComponent(Brand); new $$_dnarB4C({ target: __sveltets_2_any(), props: {  "library":props.library,"short":true,}});} }if(!showSidebar && props.onHide){ { svelteHTML.createElement("button", {          "type":`button`,"class":`icon-button show-sidebar`,"aria-label":`Show sidebar`,"title":`Show sidebar`,"onclick":() => props.onHide?.(false),}); { const $$_nocI4C = __sveltets_2_ensureComponent(Icon); new $$_nocI4C({ target: __sveltets_2_any(), props: {  "name":`sidebar`,}});} }} { const $$_div3 = svelteHTML.createElement("div", {    "class":`topbar-path`,});pathSlot = $$_div3; } { const $$_div3 = svelteHTML.createElement("div", {  "class":`topbar-tools`,});toolsSlot = $$_div3; } { svelteHTML.createElement("div", {  "class":`topbar-end`,});;__sveltets_2_ensureSnippet(props.status?.()); { const $$_lleB4C = __sveltets_2_ensureComponent(Bell); new $$_lleB4C({ target: __sveltets_2_any(), props: {}});} { const $$_uneMtnuoccA4C = __sveltets_2_ensureComponent(AccountMenu); new $$_uneMtnuoccA4C({ target: __sveltets_2_any(), props: {  "me":props.me,}});} } }
   }
  
  if(drawer){ { svelteHTML.createElement("div", {   "class":`ws-scrim`,"aria-hidden":`true`,}); }}
   { const $$_section1 = svelteHTML.createElement("section", {          "tabindex":-1,"class":drawer ? "ws-sidebar open" : "ws-sidebar","aria-label":`Navigation`,"hidden":!showSidebar,});sidebar = $$_section1;
    
     { svelteHTML.createElement("div", {  "class":`drawer-head`,}); { const $$_dnarB3C = __sveltets_2_ensureComponent(Brand); new $$_dnarB3C({ target: __sveltets_2_any(), props: {    "library":props.library,"onSearch":props.onSearch,}});} { svelteHTML.createElement("button", {          "type":`button`,"class":`icon-button touch drawer-close`,"aria-label":`Close menu`,"title":`Close`,"onclick":() => (drawer = false),}); { const $$_nocI4C = __sveltets_2_ensureComponent(Icon); new $$_nocI4C({ target: __sveltets_2_any(), props: {  "name":`close`,}});} } }
    ;__sveltets_2_ensureSnippet(props.sidebar());
   }
   { const $$_main1 = svelteHTML.createElement("main", {    "class":`ws-main`,"onscroll":(e) => scrolls.set(href, e.currentTarget.scrollTop),});main = $$_main1;
    ;__sveltets_2_ensureSnippet(props.children());
   }
 }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const Shell__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type Shell__SvelteComponent_ = ReturnType<typeof Shell__SvelteComponent_>;
/*Ωignore_endΩ*/export default Shell__SvelteComponent_;