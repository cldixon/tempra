import type { ActedBy, AgentKey } from "../agents";
import type { Limits } from "../limits";

/**
 * The library's managed agent, @tempra (TEMPRA-222; tempra-dev: agents/managed-agent,
 * decisions/the-agent-answers-in-threads): a model Tempra runs in a library, reached by
 * mentioning it in a comment. It answers in the thread, as the asker's agent ("Tempra for
 * @handle"), with Tempra's own MCP tools called in process. Its identity and its queue's jobs are
 * here; the turn is turn.ts. Free of Worker APIs.
 */

/** The name a comment mentions it by, and its id in a comment's mentions. */
export const AGENT_HANDLE = "tempra";

/** Its ledger actor, the same in every library and for every person it acts for. */
export const AGENT_ACTOR = "tempra/agent";

/** Its platform for agent identity (agents.ts): one agent per person, "Tempra for @handle". */
export const AGENT_KEY: AgentKey = { platform: "tempra", name: "Tempra" };

/** The model it runs on. */
export const MODEL = "claude-opus-5-5";

/** The library's managed agents, by the name a comment mentions them with. */
export interface ManagedAgent {
  id: string;
  name: string;
}

export const TEMPRA: ManagedAgent = { id: AGENT_HANDLE, name: AGENT_HANDLE };

/**
 * Whether the agent is on for an account (the owner of the library it is asked in): off unless
 * the operator gives the account a daily budget (`agent_daily_usd`, limits.ts).
 */
export const agentEnabled = (limits: Pick<Limits, "agent_daily_usd">) => limits.agent_daily_usd > 0;

/**
 * One turn for the agent, as the queue carries it: the library, the thread, the comment that
 * asked, and who asked (a users id). The consumer looks everything up again, so a job sent before
 * a change of access or a deleted thread does nothing it no longer may.
 */
export interface AgentJob {
  type: "agent_turn";
  /** The library, by id and Durable Object name. */
  library: string;
  do_id: string;
  thread: string;
  /** The comment that asked, and the seq it landed at. */
  comment: string | null;
  seq: number;
  /** The person it acts for, by users id. */
  asker: string;
}

export function isAgentJob(v: unknown): v is AgentJob {
  const j = v as Partial<AgentJob> | null;
  return (
    !!j &&
    j.type === "agent_turn" &&
    typeof j.library === "string" &&
    typeof j.do_id === "string" &&
    typeof j.thread === "string" &&
    typeof j.seq === "number" &&
    typeof j.asker === "string"
  );
}

/** What the Worker gives the trigger (notify.ts): the queue, and the feed for "replying". */
export interface ManagedDeps {
  /** Sends one turn to AGENT_QUEUE. */
  enqueue(job: AgentJob): Promise<void>;
  /**
   * Says on the library's feed that the agent is replying on a thread (feed.ts presence, kind
   * `replying`); the Library DO's `announce`.
   */
  announce?(doId: string, message: ReplyingMessage | ReadingMessage): Promise<void>;
}

/**
 * The agent "reading" pages it works from without a `read` call (TEMPRA-224): the thread's page,
 * given it with the question, and the pages its reply cites. The tree shimmers them as it does any
 * agent's reads (feed.ts presence, kind reading).
 */
export interface ReadingMessage {
  type: "presence";
  kind: "reading";
  actor: string;
  by: ActedBy | null;
  paths: string[];
}

export function reading(paths: string[], by: ActedBy | null): ReadingMessage {
  return { type: "presence", kind: "reading", actor: AGENT_ACTOR, by, paths };
}

/** The presence message for "Tempra is replying…" (feed.ts PresenceMessage, kind replying). */
export interface ReplyingMessage {
  type: "presence";
  kind: "replying";
  actor: string;
  by: ActedBy | null;
  paths: string[];
  thread: string;
}

export function replying(thread: string, path: string, by: ActedBy | null): ReplyingMessage {
  return { type: "presence", kind: "replying", actor: AGENT_ACTOR, by, paths: [path], thread };
}
