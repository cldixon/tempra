/**
 * What a deployment costs at list price (TEMPRA-233; tempra-dev: v2/limits, Metering): the price
 * table, the arithmetic and the month's projection, for `bun run costs` (scripts/costs.ts) and the
 * operator digest's @tempra line. Free of Worker APIs but the D1 type.
 *
 * Included amounts belong to the Cloudflare account, which Tempra shares with unrelated projects,
 * so a line's cost "after included" is what this deployment would pay alone on the plan: a lower
 * bound on its share. `list` is the same usage with nothing included: an upper bound.
 */

/** When the prices below were last checked against Cloudflare's pages. */
export const PRICES_AS_OF = "2026-10-31";

/** The Workers Paid plan's monthly minimum, for the account rather than any one deployment. */
export const PLAN_BASE_USD = 5;
export const PLAN_URL = "https://developers.cloudflare.com/workers/platform/pricing/";

export type CostKey =
  | "workers.requests"
  | "workers.cpu_ms"
  | "do.requests"
  | "do.duration_gbs"
  | "do.rows_read"
  | "do.rows_written"
  | "do.storage_gb_month"
  | "d1.rows_read"
  | "d1.rows_written"
  | "d1.storage_gb_month"
  | "r2.storage_gb_month"
  | "r2.class_a"
  | "r2.class_b"
  | "queues.operations"
  | "kv.reads"
  | "kv.writes"
  | "kv.deletes"
  | "kv.lists"
  | "kv.storage_gb_month"
  | "ae.data_points"
  | "images.transformations"
  | "browser.hours";

export interface Price {
  product: string;
  metric: string;
  /** Included per month on Workers Paid, in `unit`s. */
  included: number;
  /** US dollars per `per` units past the included amount. */
  usd: number;
  per: number;
  unit: string;
  /** Storage is a level, billed as the average of each day's peak; everything else is a count. */
  storage?: true;
  /** Shown but not added up: not billed yet, or not attributable to this deployment. */
  note?: string;
  url: string;
}

const W = "https://developers.cloudflare.com/workers/platform/pricing/";
const DO = "https://developers.cloudflare.com/durable-objects/platform/pricing/";
const D1 = "https://developers.cloudflare.com/d1/platform/pricing/";
const R2 = "https://developers.cloudflare.com/r2/pricing/";
const M = 1_000_000;

/** List prices on Workers Paid, checked on PRICES_AS_OF. */
export const PRICES: Record<CostKey, Price> = {
  "workers.requests": {
    product: "Workers",
    metric: "requests",
    included: 10 * M,
    usd: 0.3,
    per: M,
    unit: "requests",
    url: W,
  },
  "workers.cpu_ms": {
    product: "Workers",
    metric: "CPU time",
    included: 30 * M,
    usd: 0.02,
    per: M,
    unit: "CPU ms",
    url: W,
  },
  // WebSocket messages in count as requests at 20:1; the script adds them.
  "do.requests": {
    product: "Durable Objects",
    metric: "requests",
    included: M,
    usd: 0.15,
    per: M,
    unit: "requests",
    url: DO,
  },
  // 128 MB per active object; Cloudflare's `duration` is already in GB-s.
  "do.duration_gbs": {
    product: "Durable Objects",
    metric: "duration",
    included: 400_000,
    usd: 12.5,
    per: M,
    unit: "GB-s",
    url: DO,
  },
  "do.rows_read": {
    product: "Durable Objects",
    metric: "SQLite rows read",
    included: 25_000 * M,
    usd: 0.001,
    per: M,
    unit: "rows",
    url: DO,
  },
  "do.rows_written": {
    product: "Durable Objects",
    metric: "SQLite rows written",
    included: 50 * M,
    usd: 1,
    per: M,
    unit: "rows",
    url: DO,
  },
  "do.storage_gb_month": {
    product: "Durable Objects",
    metric: "SQLite storage",
    included: 5,
    usd: 0.2,
    per: 1,
    unit: "GB-month",
    storage: true,
    url: DO,
  },
  "d1.rows_read": {
    product: "D1",
    metric: "rows read",
    included: 25_000 * M,
    usd: 0.001,
    per: M,
    unit: "rows",
    url: D1,
  },
  "d1.rows_written": {
    product: "D1",
    metric: "rows written",
    included: 50 * M,
    usd: 1,
    per: M,
    unit: "rows",
    url: D1,
  },
  "d1.storage_gb_month": {
    product: "D1",
    metric: "storage",
    included: 5,
    usd: 0.75,
    per: 1,
    unit: "GB-month",
    storage: true,
    url: D1,
  },
  "r2.storage_gb_month": {
    product: "R2",
    metric: "storage",
    included: 10,
    usd: 0.015,
    per: 1,
    unit: "GB-month",
    storage: true,
    url: R2,
  },
  "r2.class_a": {
    product: "R2",
    metric: "Class A operations",
    included: M,
    usd: 4.5,
    per: M,
    unit: "operations",
    url: R2,
  },
  "r2.class_b": {
    product: "R2",
    metric: "Class B operations",
    included: 10 * M,
    usd: 0.36,
    per: M,
    unit: "operations",
    url: R2,
  },
  "queues.operations": {
    product: "Queues",
    metric: "operations",
    included: M,
    usd: 0.4,
    per: M,
    unit: "operations",
    url: "https://developers.cloudflare.com/queues/platform/pricing/",
  },
  "kv.reads": {
    product: "KV",
    metric: "reads",
    included: 10 * M,
    usd: 0.5,
    per: M,
    unit: "keys",
    url: "https://developers.cloudflare.com/kv/platform/pricing/",
  },
  "kv.writes": {
    product: "KV",
    metric: "writes",
    included: M,
    usd: 5,
    per: M,
    unit: "keys",
    url: "https://developers.cloudflare.com/kv/platform/pricing/",
  },
  "kv.deletes": {
    product: "KV",
    metric: "deletes",
    included: M,
    usd: 5,
    per: M,
    unit: "keys",
    url: "https://developers.cloudflare.com/kv/platform/pricing/",
  },
  "kv.lists": {
    product: "KV",
    metric: "lists",
    included: M,
    usd: 5,
    per: M,
    unit: "requests",
    url: "https://developers.cloudflare.com/kv/platform/pricing/",
  },
  "kv.storage_gb_month": {
    product: "KV",
    metric: "storage",
    included: 1,
    usd: 0.5,
    per: 1,
    unit: "GB-month",
    storage: true,
    url: "https://developers.cloudflare.com/kv/platform/pricing/",
  },
  "ae.data_points": {
    product: "Analytics Engine",
    metric: "data points written",
    included: 10 * M,
    usd: 0.25,
    per: M,
    unit: "data points",
    note: "not billed yet",
    url: "https://developers.cloudflare.com/analytics/analytics-engine/pricing/",
  },
  // The Images binding is billed per unique transformation a calendar month.
  "images.transformations": {
    product: "Images",
    metric: "unique transformations",
    included: 5000,
    usd: 0.5,
    per: 1000,
    unit: "transformations",
    url: "https://developers.cloudflare.com/images/pricing/",
  },
  "browser.hours": {
    product: "Browser Run",
    metric: "browser hours",
    included: 10,
    usd: 0.09,
    per: 1,
    unit: "hours",
    note: "account-wide: sessions carry no Worker name",
    url: "https://developers.cloudflare.com/browser-run/pricing/",
  },
};

/** Which R2 operations are Class A and which Class B (r2/pricing); deletes are free. */
const R2_CLASS_A = new Set([
  "ListBuckets",
  "PutBucket",
  "ListObjects",
  "PutObject",
  "CopyObject",
  "CompleteMultipartUpload",
  "CreateMultipartUpload",
  "LifecycleStorageTierTransition",
  "ListMultipartUploads",
  "UploadPart",
  "UploadPartCopy",
  "ListParts",
  "PutBucketEncryption",
  "PutBucketCors",
  "PutBucketLifecycleConfiguration",
]);
const R2_CLASS_B = new Set([
  "HeadBucket",
  "HeadObject",
  "GetObject",
  "UsageSummary",
  "GetBucketEncryption",
  "GetBucketLocation",
  "GetBucketCors",
  "GetBucketLifecycleConfiguration",
]);

/** An R2 operation's class; an operation the price page does not name counts as Class A. */
export function r2Class(action: string): "a" | "b" | "free" {
  if (R2_CLASS_B.has(action)) return "b";
  if (R2_CLASS_A.has(action)) return "a";
  if (/^(Delete|Abort)/.test(action)) return "free";
  return "a";
}

const DAY_MS = 86_400_000;

/** A calendar month (UTC) and how much of it has gone by at `now`. */
export interface MonthWindow {
  month: string;
  /** First and last day to query, YYYY-MM-DD; `to` stops at today for the current month. */
  from: string;
  to: string;
  days: number;
  /** Days gone by, fractional for the current month; `days` for one that has ended. */
  elapsed: number;
  complete: boolean;
}

export function monthWindow(month: string, now: Date): MonthWindow {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) throw new Error(`Not a month (YYYY-MM): ${month}`);
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  if (mo < 0 || mo > 11) throw new Error(`Not a month (YYYY-MM): ${month}`);
  const start = Date.UTC(y, mo, 1);
  const end = Date.UTC(y, mo + 1, 1);
  const days = (end - start) / DAY_MS;
  const t = now.getTime();
  if (t < start) throw new Error(`${month} has not started yet.`);
  const complete = t >= end;
  const elapsed = complete ? days : (t - start) / DAY_MS;
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return { month, from: iso(start), to: iso(complete ? end - DAY_MS : t), days, elapsed, complete };
}

/** The current UTC month, YYYY-MM. */
export const thisMonth = (now: Date) => now.toISOString().slice(0, 7);

/** Splits [from, to] into ranges of at most `span` days: the Analytics API caps a query's range. */
export function dateChunks(from: string, to: string, span = 10): [string, string][] {
  const out: [string, string][] = [];
  const last = Date.parse(`${to}T00:00:00Z`);
  for (let d = Date.parse(`${from}T00:00:00Z`); d <= last; d += span * DAY_MS) {
    const e = Math.min(d + (span - 1) * DAY_MS, last);
    out.push([new Date(d).toISOString().slice(0, 10), new Date(e).toISOString().slice(0, 10)]);
  }
  return out;
}

/** Scales what a month has used so far to the whole month. */
export const projected = (soFar: number, w: MonthWindow) =>
  w.complete || w.elapsed <= 0 ? soFar : (soFar * w.days) / w.elapsed;

/** Cost of `usage` units: past the included amount, and with nothing included. */
export function costOf(p: Price, usage: number): { cost: number; list: number } {
  const list = (Math.max(0, usage) * p.usd) / p.per;
  const cost = (Math.max(0, usage - p.included) * p.usd) / p.per;
  return { cost, list };
}

export interface CostLine {
  key: CostKey;
  product: string;
  metric: string;
  unit: string;
  /** Usage so far (a storage line: GB-months so far) and for the whole month. */
  usage: number;
  projectedUsage: number;
  included: number;
  /** After included, so far and projected; and the projection at list price with none included. */
  cost: number;
  projectedCost: number;
  projectedList: number;
  /** Not added to the totals (see Price.note). */
  excluded?: string;
}

/**
 * Usage per line: a count for the month so far, or for storage, the peak bytes of each day seen
 * (summed over the deployment's buckets, databases or namespaces).
 */
export type Usage = Partial<Record<CostKey, number | number[]>>;

const GB = 1e9;

export function costLines(usage: Usage, w: MonthWindow): CostLine[] {
  const lines: CostLine[] = [];
  for (const key of Object.keys(PRICES) as CostKey[]) {
    const p = PRICES[key];
    const u = usage[key];
    if (u === undefined) continue;
    let soFar: number;
    let whole: number;
    if (p.storage) {
      // A GB-month is the average of each day's peak over the month: the days seen so far count
      // toward it, and the rest of the month is taken to stay at their average.
      const peaks = (Array.isArray(u) ? u : [u]).map((b) => b / GB);
      const avg = peaks.length ? peaks.reduce((a, b) => a + b, 0) / peaks.length : 0;
      soFar = (avg * Math.min(w.elapsed, w.days)) / w.days;
      whole = avg;
    } else {
      soFar = Array.isArray(u) ? u.reduce((a, b) => a + b, 0) : u;
      whole = projected(soFar, w);
    }
    const now = costOf(p, soFar);
    const end = costOf(p, whole);
    lines.push({
      key,
      product: p.product,
      metric: p.metric,
      unit: p.unit,
      usage: soFar,
      projectedUsage: whole,
      included: p.included,
      cost: now.cost,
      projectedCost: end.cost,
      projectedList: end.list,
      ...(p.note ? { excluded: p.note } : {}),
    });
  }
  return lines;
}

/** @tempra's spend for one account, from D1 `agent_usage` (already at list price). */
export interface AgentSpend {
  user: string;
  handle: string;
  micro: number;
  calls: number;
  turns: number;
}

export interface CostReport {
  deployment: string;
  window: MonthWindow;
  pricesAsOf: string;
  lines: CostLine[];
  /** Cloudflare after included, so far and projected; and projected with nothing included. */
  cloudflare: { cost: number; projected: number; projectedList: number };
  agent: { usd: number; projected: number; calls: number; turns: number; accounts: AgentSpend[] };
  /** Cloudflare (after included) plus @tempra, projected; the plan's $5 is separate. */
  projectedTotal: number;
  planBase: number;
  notes: string[];
}

export function costReport(
  deployment: string,
  w: MonthWindow,
  usage: Usage,
  agent: AgentSpend[],
  notes: string[] = [],
): CostReport {
  const lines = costLines(usage, w);
  const counted = lines.filter((l) => !l.excluded);
  const sum = (f: (l: CostLine) => number) => counted.reduce((a, l) => a + f(l), 0);
  const usd = agent.reduce((a, s) => a + s.micro, 0) / 1e6;
  const cloudflare = {
    cost: sum((l) => l.cost),
    projected: sum((l) => l.projectedCost),
    projectedList: sum((l) => l.projectedList),
  };
  const agentProjected = projected(usd, w);
  return {
    deployment,
    window: w,
    pricesAsOf: PRICES_AS_OF,
    lines,
    cloudflare,
    agent: {
      usd,
      projected: agentProjected,
      calls: agent.reduce((a, s) => a + s.calls, 0),
      turns: agent.reduce((a, s) => a + s.turns, 0),
      accounts: [...agent].sort((a, b) => b.micro - a.micro),
    },
    projectedTotal: cloudflare.projected + agentProjected,
    planBase: PLAN_BASE_USD,
    notes,
  };
}

/** Dollars: cents, or four places under a cent so small costs still show. */
export function usd(v: number): string {
  if (v === 0) return "$0.00";
  if (Math.abs(v) < 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(2)}`;
}

/** A count in short form: 0.125 / 1,234 / 12.3k / 4.56M / 7.89B. */
export function amount(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `${(v / 1e3).toFixed(1)}k`;
  if (a < 10 && !Number.isInteger(v)) return v.toFixed(3);
  return Math.round(v).toLocaleString("en-US");
}

export function reportText(r: CostReport): string {
  const w = r.window;
  const head = w.complete
    ? `${r.deployment}, ${w.month} (whole month)`
    : `${r.deployment}, ${w.month} to ${w.to} (${w.elapsed.toFixed(1)} of ${w.days} days; projected to month end)`;
  const rows = r.lines.map((l) => [
    `${l.product} ${l.metric}`,
    `${amount(l.usage)} ${l.unit}`,
    `${amount(l.projectedUsage)}`,
    amount(l.included),
    usd(l.cost),
    usd(l.projectedCost),
    usd(l.projectedList) + (l.excluded ? `  (${l.excluded}; not in totals)` : ""),
  ]);
  const header = [
    "",
    "so far",
    "projected",
    "included",
    "cost",
    "projected",
    "projected, none included",
  ];
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((row) => (row[i] ?? "").length)),
  );
  const fmt = (row: string[]) =>
    row
      .map((c, i) =>
        i === 0 ? c.padEnd(widths[i] ?? 0) : i === row.length - 1 ? c : c.padStart(widths[i] ?? 0),
      )
      .join("  ");
  const agentRows = r.agent.accounts.map(
    (a) => `  @${a.handle}: ${usd(a.micro / 1e6)} (${a.turns} turns, ${a.calls} model calls)`,
  );
  return [
    `Tempra cost report: ${head}`,
    `List prices as of ${r.pricesAsOf}; "cost" takes the plan's included amounts off as if this deployment were alone on the account.`,
    "",
    fmt(header),
    ...rows.map(fmt),
    "",
    `Cloudflare: ${usd(r.cloudflare.cost)} so far, ${usd(r.cloudflare.projected)} projected (${usd(r.cloudflare.projectedList)} with nothing included).`,
    `@tempra: ${usd(r.agent.usd)} so far, ${usd(r.agent.projected)} projected (${r.agent.turns} turns, ${r.agent.calls} model calls).`,
    ...agentRows,
    `Projected month: ${usd(r.projectedTotal)}, plus the account's ${usd(r.planBase)} Workers Paid plan (${PLAN_URL}).`,
    ...(r.notes.length ? ["", ...r.notes.map((n) => `Note: ${n}`)] : []),
    "",
  ].join("\n");
}

/** @tempra's spend this month (UTC), from D1, for the operator digest. */
export async function agentSpendThisMonth(
  db: D1Database,
  now: Date,
): Promise<{ usd: number; projected: number; turns: number; accounts: number }> {
  const w = monthWindow(thisMonth(now), now);
  const row = await db
    .prepare(
      "SELECT COALESCE(SUM(micro_usd), 0) AS micro, COALESCE(SUM(turns), 0) AS turns, COUNT(DISTINCT user) AS accounts FROM agent_usage WHERE day >= ?1 AND day <= ?2",
    )
    .bind(w.from, w.to)
    .first<{ micro: number; turns: number; accounts: number }>();
  const spent = (row?.micro ?? 0) / 1e6;
  return {
    usd: spent,
    projected: projected(spent, w),
    turns: row?.turns ?? 0,
    accounts: row?.accounts ?? 0,
  };
}
