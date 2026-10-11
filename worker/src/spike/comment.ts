import type { TokenInfo } from "../auth";
import type { LibraryClient } from "../client";
import { type NotifyDeps, postComment } from "../notify";
import type { CommentAction, CommentResult } from "../store/comments";
import type { RequestContext } from "../store/store";
import { type AgentClient, SPIKE_INSTANCE } from "./agent-client";
import { AGENT_ACTOR, AGENT_NAME } from "./models";

/** What posting a comment needs to reach the spike's agent state. */
export interface CommentDeps extends NotifyDeps {
  library(token: TokenInfo): LibraryClient;
  spike?: { agent(name: string): AgentClient } | null;
}

/**
 * Posts a comment action, and when the spike's agent is the one commenting in one of its run
 * copies, holds it to the run (TEMPRA-67): only during a run, never resolving, at most
 * MAX_NEW_THREADS new threads, and recorded against the item being worked. Both arms reach this
 * through the MCP `comment` tool, so the cap is enforced in one place. Anyone else's comment
 * goes straight through.
 */
export async function agentComment(
  d: CommentDeps,
  token: TokenInfo,
  ctx: RequestContext,
  action: CommentAction,
): Promise<CommentResult> {
  const lib = d.library(token);
  if (!d.spike || token.actor !== AGENT_ACTOR) return postComment(d, token, lib, ctx, action);
  const base = await d.spike.agent(SPIKE_INSTANCE).baseOf(token.library.id);
  if (!base) return postComment(d, token, lib, ctx, action);
  const agent = d.spike.agent(base);
  const { run, item } = await agent.admitComment(action.kind);
  let res: CommentResult;
  try {
    res = await postComment(d, token, lib, ctx, action);
  } catch (e) {
    if (action.kind === "open") await agent.releaseThread(run);
    throw e;
  }
  await agent.recordComment({
    run,
    item,
    kind: action.kind,
    thread: res.thread.id,
    path: res.thread.path,
    body: typeof action.body === "string" ? action.body : "",
    seq: res.seq,
  });
  return res;
}

/** The agent `@librarian` resolves to in a spike preview: one per library. */
export function spikeAgents(ref: { id: string }): { id: string; name: string }[] {
  return [{ id: `agent:${ref.id}/${AGENT_NAME}`, name: AGENT_NAME }];
}
