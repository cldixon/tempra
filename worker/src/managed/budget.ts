/**
 * What the managed agent spends (TEMPRA-222; tempra-dev: agents/managed-agent, Guard rails): each
 * model response's usage at list price, kept per account and UTC day in D1 (`agent_usage`), and
 * checked against the account's daily cap (limits.ts `agent_daily_usd`) before every model call.
 */

/** List prices, US dollars per million tokens: input, output, cache reads, cache writes (1.25x). */
export const PRICES = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 } as const;

/** A response's usage, as the Messages API reports it. */
export interface Usage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

/** What one response cost at list price, in millionths of a dollar (rounded up). */
export function costMicros(u: Usage): number {
  const n = (v: number | null | undefined) => (typeof v === "number" && v > 0 ? v : 0);
  // Tokens times dollars per million is millionths of a dollar.
  const micro =
    n(u.input_tokens) * PRICES.input +
    n(u.output_tokens) * PRICES.output +
    n(u.cache_read_input_tokens) * PRICES.cacheRead +
    n(u.cache_creation_input_tokens) * PRICES.cacheWrite;
  return Math.ceil(micro);
}

/** The UTC day a spend counts on. */
export const usageDay = (at: Date) => at.toISOString().slice(0, 10);

export interface AgentBudget {
  /** What the account's agent turns have cost on `day`, in millionths of a dollar. */
  spent(user: string, day: string): Promise<number>;
  /** Adds one model call's cost; `turn` counts a turn begun. */
  charge(user: string, day: string, micro: number, turn?: boolean): Promise<void>;
}

export function d1AgentBudget(db: D1Database): AgentBudget {
  return {
    async spent(user, day) {
      const row = await db
        .prepare("SELECT micro_usd FROM agent_usage WHERE user = ? AND day = ?")
        .bind(user, day)
        .first<{ micro_usd: number }>();
      return row?.micro_usd ?? 0;
    },
    async charge(user, day, micro, turn = false) {
      await db
        .prepare(
          `INSERT INTO agent_usage (user, day, micro_usd, calls, turns) VALUES (?1, ?2, ?3, ?4, ?5)
           ON CONFLICT (user, day) DO UPDATE SET micro_usd = micro_usd + ?3,
             calls = calls + ?4, turns = turns + ?5`,
        )
        .bind(user, day, Math.max(0, Math.round(micro)), micro > 0 ? 1 : 0, turn ? 1 : 0)
        .run();
    },
  };
}
