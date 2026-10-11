import type { CallResult } from "../client";
import { OkfError } from "../store/errors";
import type { SpikeState } from "./state";

/** SpikeState methods the Worker and the run Workflow may call on a library agent's object. */
export const AGENT_METHODS = [
  "taskSet",
  "salt",
  "saveTaskSet",
  "cma",
  "setCma",
  "copy",
  "copies",
  "saveCopy",
  "createRun",
  "run",
  "runs",
  "active",
  "setWorkflow",
  "startRun",
  "finishRun",
  "doneBatches",
  "beginItem",
  "addUsage",
  "endItem",
  "result",
  "results",
  "admitComment",
  "releaseThread",
  "recordComment",
  "comments",
  "grade",
  "grades",
  "spent",
  "cap",
  "setCap",
  "remaining",
  "charge",
  "spendByModel",
  "linkCopy",
  "baseOf",
] as const;

export type AgentMethod = (typeof AGENT_METHODS)[number];

// biome-ignore lint/suspicious/noExplicitAny: mapping arbitrary method signatures
type Fn = (...args: any[]) => any;

/** The async view of SpikeState, over DO RPC or in process. */
export type AgentClient = {
  [K in AgentMethod]: SpikeState[K] extends Fn
    ? (...args: Parameters<SpikeState[K]>) => Promise<ReturnType<SpikeState[K]>>
    : never;
};

/** Runs a state method, its OkfError returned as data (RPC does not keep an Error's fields). */
export function callAgent(state: SpikeState, method: AgentMethod, args: unknown[]): CallResult {
  try {
    if (!AGENT_METHODS.includes(method)) {
      throw new OkfError(400, "bad_method", `Unknown agent method ${method}.`);
    }
    const fn = state[method] as unknown as (...a: unknown[]) => unknown;
    return { ok: true, value: fn.apply(state, args) };
  } catch (e) {
    if (e instanceof OkfError) {
      return { ok: false, status: e.status, code: e.code, message: e.message, extra: e.extra };
    }
    throw e;
  }
}

export function makeAgentClient(
  call: (method: AgentMethod, args: unknown[]) => Promise<CallResult>,
): AgentClient {
  const client: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  for (const m of AGENT_METHODS) {
    client[m] = async (...args: unknown[]) => {
      const r = await call(m, args);
      if (r.ok) return r.value;
      throw new OkfError(r.status, r.code, r.message, r.extra);
    };
  }
  return client as unknown as AgentClient;
}

/** The instance that keeps the spend ledger and which copy belongs to which base library. */
export const SPIKE_INSTANCE = "_spike";
