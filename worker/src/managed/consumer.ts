import Anthropic from "@anthropic-ai/sdk";
import { type AgentJob, isAgentJob } from "./agent";
import { failTurn, type ModelClient, runTurn, type TurnDeps } from "./turn";

/**
 * AGENT_QUEUE's consumer (TEMPRA-222): one turn per message. A turn that fails before it wrote
 * anything is retried once (the queue's maxRetries), and on its last attempt says in the thread
 * that it could not answer.
 */

/** Claude through the Anthropic SDK, with the deployment's key. */
export function anthropicModel(apiKey: string): ModelClient {
  const client = new Anthropic({ apiKey, maxRetries: 2, timeout: 90_000 });
  return { create: (params) => client.beta.messages.create(params) };
}

/** Attempts a message gets: the first and the queue's one retry. */
export const AGENT_ATTEMPTS = 2;

export async function handleAgentMessage(
  d: TurnDeps,
  body: unknown,
  attempts: number,
): Promise<"ack" | "retry"> {
  if (!isAgentJob(body)) {
    console.error(JSON.stringify({ agent_message_unknown: body }));
    return "ack";
  }
  const job: AgentJob = body;
  const lastAttempt = attempts >= AGENT_ATTEMPTS;
  try {
    const outcome = await runTurn(d, job, { lastAttempt });
    console.log(JSON.stringify({ agent_turn: job.thread, library: job.library, ...outcome }));
    return "ack";
  } catch (e) {
    console.error(JSON.stringify({ agent_turn_error: job.thread, attempts, error: String(e) }));
    if (!lastAttempt) return "retry";
    await failTurn(d, job).catch(() => {});
    return "ack";
  }
}
