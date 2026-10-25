import type { FeedEvent } from "./live";

/**
 * Whether an event is an agent's change to a file (not a person's, not a comment): what
 * Activity's live entry follows. The tree and the sidebar no longer mark change (TEMPRA-173).
 */
export const isAgentChange = (e: FeedEvent) =>
  !e.actor.startsWith("human:") && e.op !== "comment" && e.op !== "delete";
