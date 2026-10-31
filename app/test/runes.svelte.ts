/**
 * Rune hooks driven outside a component for the tests: each runs inside its own effect root,
 * as it would while a component initialises, with `box` as a piece of reactive state to steer it.
 */

import { usePrefetchLinks } from "../src/links.svelte.ts";
import { useFeed } from "../src/live.svelte.ts";
import { type Freshness, useLoad } from "../src/load.svelte.ts";
import type { Urls } from "../src/urls";
import { useWake } from "../src/wake.svelte.ts";

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
export function rootLoad<T>(key: () => string, load: () => Promise<T>, freshness?: Freshness) {
  let loaded!: ReturnType<typeof useLoad<T>>;
  const stop = $effect.root(() => {
    loaded = useLoad(key, load, [], freshness);
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

/** usePrefetchLinks in an effect root, for a library's frame or (null) the account's. */
export function rootPrefetchLinks(library: { owner: string; slug: string } | null) {
  return $effect.root(() => {
    usePrefetchLinks(() => library);
  });
}

/** useWake in an effect root, for one library's frame. */
export function rootWake(urls: Urls) {
  return $effect.root(() => {
    useWake(() => urls);
  });
}
