import { type FeedEvent, type FeedStatus, feedOf } from "./live";
import type { Urls } from "./urls";

/**
 * Whether the library's feed is live or reconnecting, said only once it has been reconnecting
 * for a few seconds (a socket the server asks to reopen, or a blip, says nothing).
 */
export function useFeedStatus(urls: () => Urls, quietMs = 4000) {
  let shown = $state<FeedStatus>("live");
  $effect(() => {
    const feed = feedOf(urls());
    let timer: ReturnType<typeof setTimeout> | undefined;
    const on = (s: FeedStatus) => {
      clearTimeout(timer);
      if (s === "live") shown = "live";
      else
        timer = setTimeout(() => {
          shown = feed.status;
        }, quietMs);
    };
    on(feed.status);
    const stop = feed.watch(on);
    return () => {
      stop();
      clearTimeout(timer);
    };
  });
  return {
    get current() {
      return shown;
    },
  };
}

/**
 * Calls `onEvents` with each batch of new events in the library, for as long as the component
 * is mounted, and `onReset` when the ledger is rolled back. `from()` is the sequence the page's
 * data reflects (null while loading): the page then also hears the events that arrived, or
 * committed, while it loaded. The callbacks are read when called, so they see the latest state.
 */
export function useFeed(
  urls: () => Urls,
  from: () => number | null,
  onEvents: (events: FeedEvent[]) => void,
  onReset: () => void,
) {
  const key = $derived(`${urls().owner}/${urls().slug}`);
  let sub: ReturnType<ReturnType<typeof feedOf>["subscribe"]> | null = null;
  // One subscription per library, made before the sync below runs (effects run in order).
  $effect.pre(() => {
    void key;
    const s = feedOf(urls()).subscribe({ events: (e) => onEvents(e), reset: () => onReset() });
    sub = s;
    return () => {
      s.close();
      sub = null;
    };
  });
  $effect(() => {
    const f = from();
    void key;
    if (f !== null && sub) feedOf(urls()).sync(sub, f);
  });
}

/**
 * A function that runs `fn` once, `ms` after the last of a burst of calls: a page reloading on
 * feed events reloads once per burst of agents' writes, not once per write.
 */
export function useTrailing(fn: () => void, ms = 400): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => () => clearTimeout(timer));
  return () => {
    clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
}
