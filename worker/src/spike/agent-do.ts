import { DurableObject } from "cloudflare:workers";
import type { CallResult } from "../client";
import { doSqlHandle } from "../store/sql";
import { type AgentMethod, callAgent } from "./agent-client";
import { SpikeState } from "./state";

/**
 * A library's agent (TEMPRA-67): its task set, runs, results and grades in its own SQLite, one
 * object per base library, named by the library's id. A plain SQLite Durable Object: the Agents
 * SDK was tried and dropped (its Agent class alone added ~300 KiB gzip for what this already
 * does). The instance named SPIKE_INSTANCE keeps the spike's spend ledger.
 */
export class LibraryAgent extends DurableObject<Env> {
  private opened: SpikeState | null = null;

  private get state(): SpikeState {
    this.opened ??= new SpikeState(doSqlHandle(this.ctx.storage));
    return this.opened;
  }

  /** The single RPC entry point, errors as data like the Library object's. */
  async call(method: AgentMethod, args: unknown[]): Promise<CallResult> {
    return callAgent(this.state, method, args);
  }
}
