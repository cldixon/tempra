import { OkfError } from "./store/errors";

/**
 * Per-account limits (v2 spec: Limits, abuse and metering). Defaults here; an account's overrides
 * live in users.limits as JSON (`bun run admin limits`).
 */
export interface Limits {
  /** Libraries an account may own. */
  libraries: number;
  /** Active (unrevoked, unexpired) bearer tokens across the account's libraries. */
  tokens: number;
  /**
   * The library's managed agent, @tempra (TEMPRA-222): what it may spend a day, in whole US
   * dollars at list price, answering in the libraries this account owns. 0, the default, is off;
   * the operator turns it on with `bun run admin limits --email … --set agent_daily_usd=5`.
   */
  agent_daily_usd: number;
  /**
   * Monthly quotas (TEMPRA-232, tempra-dev: v2/limits, Monthly quotas), per UTC calendar month:
   * the writes and the requests (MCP tool calls and the REST API) an account's agents make, and
   * storage across the libraries it owns, in MB. Generous until plans exist (TEMPRA-229): far above
   * what any account makes today, and 1 GB, the ten libraries of 100 MB the other defaults allow.
   */
  writes_month: number;
  requests_month: number;
  storage_mb: number;
}

export const DEFAULT_LIMITS: Limits = {
  libraries: 10,
  tokens: 50,
  agent_daily_usd: 0,
  writes_month: 100_000,
  requests_month: 1_000_000,
  storage_mb: 1024,
};

/**
 * Per-minute rate limits are per deployment, in the Rate Limiting bindings (cloudflare.config.ts):
 * 60 writes per account and 600 requests per token or connected app. The monthly quotas above
 * are counted and checked in quota.ts.
 */

/** Storage per library, SQLite plus its attachments; set per deployment (LIBRARY_STORAGE_MB). */
export const DEFAULT_STORAGE_MB = 100;

/** An account's limits: the defaults with its overrides (unknown keys and bad values ignored). */
export function limitsFrom(json: string | null | undefined): Limits {
  const limits = { ...DEFAULT_LIMITS };
  if (!json) return limits;
  try {
    const o = JSON.parse(json) as Record<string, unknown>;
    for (const k of Object.keys(limits) as (keyof Limits)[]) {
      const v = o[k];
      if (typeof v === "number" && Number.isInteger(v) && v >= 0) limits[k] = v;
    }
  } catch {}
  return limits;
}

export function overLimit(what: string, limit: number, code = "limit_reached"): OkfError {
  return new OkfError(
    403,
    code,
    `You have reached the limit of ${limit} ${what}. Delete some, or ask for more.`,
  );
}
