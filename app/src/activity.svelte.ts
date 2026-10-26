import { isLive, LIVE_MS, type LiveWrite } from "./activity";
import { isAgentChange } from "./changes";
import type { FeedEvent } from "./live";
import { useNow } from "./ui.svelte.ts";

/**
 * Agents' writes as they arrive on the feed (tempra-dev: app/live): the last one, read as
 * writing now (the Summary's live entry) for LIVE_MS, and each event's arrival by seq (Every
 * event's pulsing rows). `heard` takes a batch from useFeed, `reset` a rollback. Its clock (useNow)
 * ticks every 5 s once anything has been heard, else every 30 s, so the dot stops when the writes
 * do.
 */
export function useLiveWrites() {
  let last = $state.raw<LiveWrite | null>(null);
  let seqs = $state.raw(new Map<number, number>());
  const clock = useNow(() => (last || seqs.size > 0 ? 5000 : 30_000));
  return {
    /** The clock relative times are read against. */
    get now() {
      return clock.current;
    },
    /** An agent writing now, or null once its last write is LIVE_MS old. */
    get writing() {
      return isLive(last, clock.current) ? last : null;
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
