import { isLive, LIVE_MS, type LiveWrite, loadTitles } from "./activity";
import { isAgentChange } from "./changes";
import type { FeedEvent } from "./live";
import { useLoad } from "./load.svelte.ts";
import type { Urls } from "./urls";

/** One load of a library's titles, shared by home and Activity. */
export function useTitles(urls: () => Urls) {
  return useLoad(
    () => `titles ${urls().base}`,
    () => loadTitles(urls()),
  );
}

/**
 * A clock whose tick follows `ms()`: quick while something reads as live, slow otherwise. The
 * interval is a $derived, so the timer is set again only when the interval itself changes, not
 * on every write that keeps it the same.
 */
export function useClock(ms: () => number) {
  let now = $state(Date.now());
  const interval = $derived(ms());
  $effect(() => {
    const t = setInterval(() => {
      now = Date.now();
    }, interval);
    return () => clearInterval(t);
  });
  return {
    get current() {
      return now;
    },
  };
}

/**
 * Agents' writes as they arrive on the feed (tempra-dev: app/live): the last one, read as
 * writing now (the Summary's live entry) for LIVE_MS, and each event's arrival by seq (Every
 * event's pulsing rows). `heard` takes a batch from useFeed, `reset` a rollback. The clock ticks
 * every 5 s while anything has been heard, so the dot stops when the writes do.
 */
export function useLiveWrites() {
  let last = $state.raw<LiveWrite | null>(null);
  let seqs = $state.raw(new Map<number, number>());
  const clock = useClock(() => (last || seqs.size > 0 ? 5000 : 30_000));
  return {
    /** The clock relative times are read against. */
    get now() {
      return clock.current;
    },
    /** An agent writing now, or null once its last write is LIVE_MS old. */
    get writing() {
      return isLive(last, clock.current) ? last : null;
    },
    /** When each event an agent made arrived, by seq. */
    get seqs() {
      return seqs;
    },
    /** Whether the event with this seq arrived recently enough to pulse. */
    pulses(seq: number) {
      return (seqs.get(seq) ?? 0) > clock.current - LIVE_MS;
    },
    heard(events: FeedEvent[]) {
      const at = Date.now();
      const agent = events.filter(isAgentChange).at(-1);
      if (agent) {
        last = { actor: agent.actor, by: agent.by ?? null, path: agent.path, seq: agent.seq, at };
      }
      const fromAgents = events.filter((e) => !e.actor.startsWith("human:") || e.by?.agent);
      if (fromAgents.length > 0) {
        const next = new Map(seqs);
        for (const e of fromAgents) next.set(e.seq, at);
        seqs = next;
      }
    },
    reset() {
      last = null;
      seqs = new Map();
    },
  };
}
