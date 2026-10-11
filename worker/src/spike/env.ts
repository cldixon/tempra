import Anthropic from "@anthropic-ai/sdk";
import { makeAgentClient } from "./agent-client";
import type { LibraryAgent } from "./agent-do";
import { GATEWAY_ID } from "./models";
import type { RunParams, SpikeDeps } from "./runner";

/**
 * The spike's platform pieces (TEMPRA-67), present only on a preview Worker that binds them
 * (cloudflare.config.ts, preview mode): the agent objects, the run Workflow, Workers AI and the
 * Anthropic key. Anywhere else this is null and the spike's routes answer 404.
 */
export function spikeFor(env: Env): SpikeDeps | null {
  if (env.AGENT_SPIKE !== "on" || !env.LIBRARY_AGENT || !env.AGENT_RUN) return null;
  const ns = env.LIBRARY_AGENT as DurableObjectNamespace<LibraryAgent>;
  const workflow = env.AGENT_RUN as Workflow<RunParams>;
  const key = env.ANTHROPIC_API_KEY || null;
  const ai = env.AI ?? null;
  return {
    agent(name) {
      const stub = ns.get(ns.idFromName(name));
      return makeAgentClient((method, args) => stub.call(method, args));
    },
    // Claude through the AI Gateway (its logs, and its spend limit when one is set). The
    // spike counts retries itself, so the SDK does not retry.
    async anthropic() {
      if (!key) return null;
      const baseURL = ai ? await ai.gateway(GATEWAY_ID).getUrl("anthropic") : undefined;
      return new Anthropic({ apiKey: key, maxRetries: 0, ...(baseURL ? { baseURL } : {}) });
    },
    // Managed Agents' model calls run at Anthropic; its control API goes straight there.
    managedAgents: () => (key ? new Anthropic({ apiKey: key }) : null),
    ai: ai
      ? {
          run: (model, inputs, options) =>
            (
              ai as unknown as { run: (m: string, i: unknown, o?: unknown) => Promise<unknown> }
            ).run(model, inputs, options),
        }
      : null,
    async start(params) {
      const instance = await workflow.create({
        id: `run-${params.base.id}-${params.run}`,
        params,
      });
      return instance.id;
    },
    origin: env.APP_ORIGIN,
  };
}
