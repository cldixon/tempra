/**
 * A DOM for the app's tests (happy-dom), and Svelte components mounted into it as the app
 * mounts them: `draw` mounts a component and flushes it, `settle` lets effects and promises run.
 */
import { Window } from "happy-dom";
import { type Component, flushSync, mount, unmount } from "svelte";

const GLOBALS = [
  "window",
  "document",
  "navigator",
  "location",
  "history",
  "Node",
  "Element",
  "HTMLElement",
  "HTMLInputElement",
  "HTMLTextAreaElement",
  "HTMLAnchorElement",
  "HTMLButtonElement",
  "HTMLDialogElement",
  "SVGElement",
  "Text",
  "Comment",
  "DocumentFragment",
  "Event",
  "KeyboardEvent",
  "MouseEvent",
  "PointerEvent",
  "FocusEvent",
  "CustomEvent",
  "MutationObserver",
  "ResizeObserver",
  "IntersectionObserver",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "localStorage",
  "sessionStorage",
  "matchMedia",
  "CSS",
  "Range",
  "Selection",
] as const;

/**
 * Installs a happy-dom window's globals, once for the whole run (test/setup.ts, preloaded):
 * Svelte's client runtime keeps the DOM's accessors it first meets, so every test shares one
 * window. A test that wants a clean page empties `document.body`.
 */
export function installDom(url = "http://localhost/") {
  const window = new Window({ url });
  const g = globalThis as Record<string, unknown>;
  const w = window as unknown as Record<string, unknown>;
  for (const name of GLOBALS) {
    const v = w[name];
    g[name] = typeof v === "function" && /^[a-z]/.test(name) ? v.bind(window) : v;
  }
  // Every DOM class the window has (HTMLMediaElement, SVGSVGElement, …), for Svelte's checks.
  for (const name of Object.getOwnPropertyNames(window)) {
    if (/^(HTML|SVG)\w*Element$/.test(name) && !(name in g)) g[name] = w[name];
  }
  g.window = window;
  return window;
}

/** Mounts a component into a new element in the body and flushes it; `destroy` unmounts it. */
export function draw<P extends Record<string, unknown>>(
  // biome-ignore lint/suspicious/noExplicitAny: any component.
  component: Component<P, any, any>,
  props: P,
) {
  const host = document.createElement("div");
  document.body.append(host);
  const instance = mount(component, { target: host, props });
  flushSync();
  return {
    host,
    instance,
    destroy() {
      unmount(instance);
      host.remove();
    },
  };
}

/** Lets effects, timers set to 0 and resolved promises run, then flushes Svelte. */
export async function settle(ms = 0) {
  await new Promise((r) => setTimeout(r, ms));
  flushSync();
}
