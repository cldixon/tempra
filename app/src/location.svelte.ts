import { untrack } from "svelte";
import { HOLD_MS, holdFor, startLoad, within } from "./hold";
import { NAVIGATED, poppedBack } from "./router";

const initial = () =>
  new URL(typeof location === "undefined" ? "http://localhost/" : location.href);

/**
 * The current URL, as runes, in two parts (TEMPRA-194). `here.address` is where the browser is:
 * it follows every navigation, and back and forward, at once (the frame's current row, the
 * drawer). `here.url` is the URL of the page on screen, what pages read: it follows the address
 * at once within a page and to a page seen before, and otherwise waits for the next page's data
 * for up to HOLD_MS (hold.ts), so the page on screen stays until the next one can draw.
 */
class Here {
  url = $state(initial());
  address = $state(initial());
  /** While a move waits for the next page's data, before it replaces the page on screen. */
  held = $state(false);
  /** After a held move gave up waiting, until the next page's data arrives (the frame says so). */
  loading = $state(false);
}

export const here = new Here();

/** Each move, so a slower one that settles later does not undo it. */
let moves = 0;

/**
 * Follows the browser's address; the page on screen follows when the next page can draw. Called
 * from effects too (a redirect navigates as it mounts), so what it reads is untracked: an effect
 * that navigates must not come to depend on the URL it changes.
 */
export function follow(next: URL) {
  untrack(() => {
    // Already there, or already on the way (a redirect asking again while its move is held).
    if (here.address.href === next.href) return;
    here.address = next;
    const move = ++moves;
    here.loading = false;
    const load = holdFor(here.url, next);
    if (!load) {
      here.held = false;
      here.url = next;
      return;
    }
    here.held = true;
    const { ready, settled } = startLoad(load);
    within(ready, HOLD_MS).then(() => {
      if (move !== moves) return;
      here.held = false;
      here.url = next;
      if (settled()) return;
      here.loading = true;
      ready.then(() => {
        if (move === moves) here.loading = false;
      });
    });
  });
}

if (typeof window !== "undefined") {
  const update = () => follow(new URL(location.href));
  window.addEventListener(NAVIGATED, update);
  window.addEventListener("popstate", () => {
    poppedBack();
    update();
  });
}
