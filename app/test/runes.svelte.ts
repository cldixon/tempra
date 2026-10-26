/**
 * Rune hooks driven outside a component for the tests: each runs inside its own effect root,
 * as it would while a component initialises, with `box` as a piece of reactive state to steer it.
 */

import { useFeed } from "../src/live.svelte.ts";
import { useLoad } from "../src/load.svelte.ts";
import type { Urls } from "../src/urls";

/** A reactive value the tests set, as a page's props or state would change. */
export function box<T>(value: T) {
  let v = $state.raw(value);
  return {
    get v() {
      return v;
    },
    set v(next: T) {
      v = next;
    },
  };
}

/** useLoad in an effect root; `stop` ends it, as a page going away would. */
export function rootLoad<T>(key: () => string, load: () => Promise<T>) {
  let loaded!: ReturnType<typeof useLoad<T>>;
  const stop = $effect.root(() => {
    loaded = useLoad(key, load);
  });
  return { loaded, stop };
}

/** useFeed in an effect root. */
export function rootFeed(urls: () => Urls, from: () => number | null) {
  const heard: number[] = [];
  const stop = $effect.root(() => {
    useFeed(
      urls,
      from,
      (events) => heard.push(...events.map((e) => e.seq)),
      () => {},
    );
  });
  return { heard, stop };
}
