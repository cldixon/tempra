import { untrack } from "svelte";
import { feedOf } from "./live";
import type { Presence } from "./presence";
import type { Urls } from "./urls";

const libraryKey = (urls: Urls) => `${urls.owner}/${urls.slug}`;

/**
 * What agents are doing in the library now (TEMPRA-219): `active` maps each marked file to its
 * most recent presence, redrawn as marks come and fade. It keeps the library's feed open while
 * mounted (the one socket every page of the library shares). It follows the library's key, not
 * the Urls object, so a page redrawn in the same library keeps its subscription.
 */
export function usePresence(urls: () => Urls) {
  let active = $state.raw<ReadonlyMap<string, Presence>>(new Map());
  const key = $derived(libraryKey(urls()));
  $effect(() => {
    void key;
    const feed = untrack(() => feedOf(urls()));
    const sub = feed.subscribe({ events: () => {}, reset: () => {} });
    const read = () => {
      active = feed.presence.active();
    };
    read();
    const stop = feed.presence.watch(read);
    return () => {
      stop();
      sub.close();
    };
  });
  return {
    get active() {
      return active;
    },
  };
}
