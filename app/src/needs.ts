import { useEffect } from "react";
import type { ActedBy } from "./agents";
import { api, useLoad } from "./api";
import { useFeed, useTrailing } from "./live";
import type { Urls } from "./urls";

/**
 * What only a person can do in a library: `GET …/needs`, read by the library's home (For you
 * here and the housekeeping line, TEMPRA-117); the Inbox is where the person acts on it
 * (TEMPRA-116). Concepts never verified and the agents' housekeeping are counts.
 */
export interface Needs {
  seq: number;
  /** Open threads the person took part in (or was mentioned in) where someone else spoke last. */
  replies: {
    thread: string;
    path: string;
    title: string | null;
    quote: string | null;
    last: { actor: string; by: ActedBy | null; body: string; ts: string; seq: number };
  }[];
  /** Concepts a person verified that changed since. */
  verify: {
    total: number;
    items: {
      path: string;
      title: string | null;
      seq: number;
      ts: string;
      actor: string;
      by: ActedBy | null;
      verified: { actor: string; seq: number; ts: string };
      changes: number;
    }[];
    next_offset: number | null;
  };
  /** Concepts no person has verified (TEMPRA-111): their standing, counted, never in `count`. */
  unverified: { total: number };
  /** The agents' share of the work queue, staleness among it (TEMPRA-142); counted only. */
  housekeeping: {
    stale: number;
    lint: number;
    structure: number;
    broken_link: number;
    total: number;
  };
  /** Replies and concepts to verify. */
  count: number;
}

/** The cache key of a library's needs (one load, shared by the pages that show it). */
const needsKey = (urls: Urls) => `needs ${urls.owner}/${urls.slug}`;

/** The library's needs, reloaded once per burst of writes or comments. */
export function useNeeds(urls: Urls) {
  const loaded = useLoad(needsKey(urls), () => api<Needs>(urls.api("needs")));
  const reload = useTrailing(loaded.reload, 1500);
  const head = loaded.state === "ready" ? loaded.data.seq : null;
  useFeed(urls, head, reload, reload);
  // Coming back to the tab: someone may have answered meanwhile.
  useEffect(() => {
    window.addEventListener("focus", reload);
    return () => window.removeEventListener("focus", reload);
  }, [reload]);
  return loaded;
}
