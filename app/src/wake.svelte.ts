import { api, holding } from "./api";
import type { Urls } from "./urls";
import { due, libraryOf, touched } from "./wake";

/** What shows the person is back at a library: pointing, a key, or the tab shown again. */
const INTENT = ["pointermove", "pointerdown", "keydown", "touchstart"] as const;

/**
 * Wakes a library's object when the person shows intent after a quiet spell (TEMPRA-195): one
 * `GET …/stats`, at most once a minute per library (wake.ts), never while the tab is hidden or the
 * session is holding back after a 429. It counts against the session's limit like any request.
 */
export function useWake(urls: () => Urls) {
  $effect(() => {
    const wake = () => {
      if (document.hidden || holding()) return;
      const url = urls().api("stats");
      const lib = libraryOf(url);
      if (!lib || !due(lib)) return;
      // Counted at once, so a burst of pointer moves sends one call.
      touched(url);
      api(url).catch(() => {});
    };
    const shown = () => {
      if (!document.hidden) wake();
    };
    for (const e of INTENT) document.addEventListener(e, wake, { passive: true });
    document.addEventListener("visibilitychange", shown);
    return () => {
      for (const e of INTENT) document.removeEventListener(e, wake);
      document.removeEventListener("visibilitychange", shown);
    };
  });
}
