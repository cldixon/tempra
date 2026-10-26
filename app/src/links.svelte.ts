import { prefetch } from "./api";
import { LINK_REST_MS, linkLoad, linkOf } from "./links";

/**
 * Loads a page ahead when the pointer rests on a link to it, the keyboard reaches it, or a finger
 * touches it (phones have no hover) (TEMPRA-193): one delegated listener for the frame, so the
 * tree, a page's body, Recently changed, Activity, the bell's panel, the cards and Linked from all do it
 * the same way. `prefetch` keeps its guards: nothing while a load is on its way, a fresh one is
 * here, or the session is holding back after a 429.
 */
export function usePrefetchLinks(library: () => { owner: string; slug: string } | null) {
  $effect(() => {
    let resting: HTMLAnchorElement | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = (a: HTMLAnchorElement) => {
      const l = linkLoad(a, library());
      if (l) prefetch(l.key, l.load);
    };
    const rest = (a: HTMLAnchorElement | null) => {
      if (a === resting) return;
      clearTimeout(timer);
      resting = a;
      if (a) timer = setTimeout(() => load(a), LINK_REST_MS);
    };
    const over = (e: Event) => rest(linkOf(e.target));
    const out = (e: PointerEvent) => {
      if (resting && !resting.contains(e.relatedTarget as Node | null)) rest(null);
    };
    // The keyboard only: a click focuses its link too, and is already on its way.
    const focus = (e: FocusEvent) => {
      const a = linkOf(e.target);
      if (a?.matches(":focus-visible")) rest(a);
    };
    const touch = (e: TouchEvent) => {
      const a = linkOf(e.target);
      if (a) load(a);
    };
    document.addEventListener("pointerover", over);
    document.addEventListener("pointerout", out);
    document.addEventListener("focusin", focus);
    document.addEventListener("touchstart", touch, { passive: true });
    return () => {
      clearTimeout(timer);
      document.removeEventListener("pointerover", over);
      document.removeEventListener("pointerout", out);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("touchstart", touch);
    };
  });
}
