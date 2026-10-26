import { NAVIGATED, poppedBack } from "./router";

/**
 * The current URL, as a rune: `here.url` is reassigned on every navigation and on back and
 * forward, so whatever reads it follows.
 */
class Here {
  url = $state(new URL(typeof location === "undefined" ? "http://localhost/" : location.href));
}

export const here = new Here();

if (typeof window !== "undefined") {
  const update = () => {
    if (here.url.href !== location.href) here.url = new URL(location.href);
  };
  window.addEventListener(NAVIGATED, update);
  window.addEventListener("popstate", () => {
    poppedBack();
    update();
  });
}
