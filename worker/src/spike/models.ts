/**
 * The managed-agent runtime spike (TEMPRA-67, tempra-dev agents/managed-agent.md "The spike"):
 * which runtimes and models it compares, at what list prices, under which caps. Preview only:
 * nothing here runs unless the preview binds the spike (cloudflare.config.ts).
 */

export type Arm = "a" | "b";

export interface ModelSpec {
  /** The id each API takes. */
  id: string;
  /** A short label for tables and actors; never shown on the blind grading sheet. */
  label: string;
  provider: "anthropic" | "workers-ai";
  /** List prices in USD per million tokens. */
  price: { input: number; output: number; cacheRead: number; cacheWrite: number };
  /** The arms that can run it: Workers AI models run in our own loop only. */
  arms: Arm[];
}

/**
 * Anthropic list prices (claude-api skill, 2026-10-06): cache writes are 1.25x input (5-minute
 * TTL), reads 0.05x on Opus 5.5 and 0.1x elsewhere. Workers AI prices from the catalog
 * (`GET /ai/models/search`, 2026-10-11).
 */
export const MODELS: ModelSpec[] = [
  {
    id: "claude-opus-5-5",
    label: "opus-5.5",
    provider: "anthropic",
    price: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
    arms: ["a", "b"],
  },
  {
    id: "claude-sonnet-5-5",
    label: "sonnet-5.5",
    provider: "anthropic",
    price: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
    arms: ["a", "b"],
  },
  {
    id: "claude-haiku-5-5",
    label: "haiku-5.5",
    provider: "anthropic",
    price: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
    arms: ["a", "b"],
  },
  // Z.ai's flagship agentic model (Aug 2026): 1M context, function calling, reasoning. The
  // strongest tool-calling model in the catalog by its own billing and the newest flagship.
  {
    id: "@cf/zai-org/glm-5.3",
    label: "glm-5.3",
    provider: "workers-ai",
    price: { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 1.4 },
    arms: ["a"],
  },
  // The runner-up, selectable for a second open-model data point.
  {
    id: "@cf/deepseek-ai/deepseek-v4-pro-0813",
    label: "deepseek-v4-pro",
    provider: "workers-ai",
    price: { input: 1.32, output: 3.96, cacheRead: 0.044, cacheWrite: 1.32 },
    arms: ["a"],
  },
];

export function modelSpec(id: string): ModelSpec | null {
  return MODELS.find((m) => m.id === id || m.label === id) ?? null;
}

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export const NO_USAGE: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
  };
}

/** What usage costs at list price, in USD. */
export function costOf(model: ModelSpec, u: Usage): number {
  const p = model.price;
  return (
    (u.input * p.input +
      u.output * p.output +
      u.cacheRead * p.cacheRead +
      u.cacheWrite * p.cacheWrite) /
    1e6
  );
}

/** The whole spike's model spend stops here unless the parent session raises it. */
export const SPEND_CAP_USD = 20;

/** New threads one run may open (the design's "loudness", default 5). */
export const MAX_NEW_THREADS = 5;

/** Work items per batch: a run is one batch, so it never needs more than the thread cap. */
export const BATCH_SIZE = 5;

/** Model turns one item may take in our own loop before it stops. */
export const MAX_TURNS = 12;

/** Input tokens one item may consume (uncached, cached and written) before it stops. */
export const MAX_ITEM_INPUT_TOKENS = 400_000;

/** Output tokens per model turn. */
export const MAX_OUTPUT_TOKENS = 8000;

/** One item's hard cap at list price, Arm B's session budget too. */
export const MAX_ITEM_USD = 1.5;

/** Every model runs at this effort where it takes one, so the models are compared alike. */
export const EFFORT = "medium" as const;

/** The AI Gateway every model call goes through (approved by the operator for the preview). */
export const GATEWAY_ID = "tempra-spike";

/** The MCP tools a commenting agent gets, in both arms. */
export const AGENT_TOOLS = [
  "start",
  "read",
  "browse",
  "work",
  "comments",
  "comment",
  "search",
  "links",
] as const;

/** The agent's name in mentions, and the actor its token carries. */
export const AGENT_NAME = "librarian";
export const AGENT_ACTOR = "tempra-agent/librarian";
