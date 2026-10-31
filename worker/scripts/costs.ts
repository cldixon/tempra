/**
 * `bun run costs` (TEMPRA-233): one deployment's usage for a month and what it costs at list price,
 * from Cloudflare's GraphQL Analytics API, filtered to the deployment's own Workers, Durable Object
 * namespaces, D1, bucket, Queues, KV namespace and dataset (cloudflare.config.ts), plus @tempra's
 * spend from D1 `agent_usage`. Read-only: GraphQL, two REST listings and one D1 SELECT.
 *
 *   bun run costs [--month YYYY-MM] [--mode production|staging] [--json]
 *
 * Needs CLOUDFLARE_API_TOKEN (Account Analytics read, Workers read, D1 read) and
 * CLOUDFLARE_ACCOUNT_ID. Prices and the arithmetic are in src/costs.ts.
 *
 * Follow-up (TEMPRA-236): cost per account needs TEMPRA-228's per-call rows and DO time in
 * `tempra_usage`, and the digest's Cloudflare line needs an Analytics read the Worker lacks.
 */
import { parseArgs } from "node:util";
import { deploymentFor } from "../cloudflare.config";
import {
  type AgentSpend,
  costReport,
  dateChunks,
  monthWindow,
  r2Class,
  reportText,
  thisMonth,
  type Usage,
} from "../src/costs";
import { d1Raw } from "./cf";

const { values } = parseArgs({
  options: {
    month: { type: "string" },
    mode: { type: "string" },
    json: { type: "boolean" },
  },
});
const mode = values.mode ?? "production";
if (mode !== "production" && mode !== "staging") {
  throw new Error(`--mode is production or staging, not ${mode}`);
}
const d = deploymentFor(mode);
const now = new Date();
const w = monthWindow(values.month ?? thisMonth(now), now);

const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!token || !account) throw new Error("Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.");
const API = "https://api.cloudflare.com/client/v4";
const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

async function rest<T>(path: string): Promise<T[]> {
  const r = await fetch(`${API}/accounts/${account}${path}`, { headers });
  const j = (await r.json()) as { success: boolean; result: T[]; errors?: unknown };
  if (!j.success) throw new Error(`GET ${path}: ${JSON.stringify(j.errors)}`);
  return j.result;
}

// biome-ignore lint/suspicious/noExplicitAny: the Analytics API's rows, read field by field below.
type Row = any;
async function gql(
  query: string,
  variables: Record<string, unknown>,
): Promise<Record<string, Row[]>> {
  const r = await fetch(`${API}/graphql`, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
  });
  const j = (await r.json()) as {
    data?: { viewer: { accounts: Record<string, Row[]>[] } };
    errors?: unknown;
  };
  if (j.errors) throw new Error(`GraphQL: ${JSON.stringify(j.errors)}`);
  return j.data?.viewer.accounts[0] ?? {};
}

// The deployment's resources by id: Durable Object namespaces by script, Queues by name.
const namespaces = (
  await rest<{ id: string; script: string }>("/workers/durable_objects/namespaces?per_page=1000")
)
  .filter((n) => n.script === d.name)
  .map((n) => n.id);
const queueNames = [d.queue, d.agentQueue, d.mailQueue];
const queues = (await rest<{ queue_id: string; queue_name: string }>("/queues?per_page=1000"))
  .filter((q) => queueNames.includes(q.queue_name))
  .map((q) => q.queue_id);
const scripts = [d.name, d.render];
const dataset = d.usage ?? "tempra_usage";

const QUERY = `query($a: String!, $from: Date!, $to: Date!, $scripts: [String!], $ns: [String!],
  $db: String!, $bucket: String!, $queues: [String!], $kv: String!, $dataset: String!) {
  viewer { accounts(filter: {accountTag: $a}) {
    workers: workersInvocationsAdaptive(limit: 100, filter: {date_geq: $from, date_leq: $to, scriptName_in: $scripts}) {
      sum { requests cpuTimeUs } }
    doCalls: durableObjectsInvocationsAdaptiveGroups(limit: 100, filter: {date_geq: $from, date_leq: $to, namespaceId_in: $ns}) {
      sum { requests } }
    doPeriodic: durableObjectsPeriodicGroups(limit: 100, filter: {date_geq: $from, date_leq: $to, namespaceId_in: $ns}) {
      sum { duration rowsRead rowsWritten inboundWebsocketMsgCount } }
    doStorage: durableObjectsSqlStorageGroups(limit: 1000, filter: {date_geq: $from, date_leq: $to, namespaceId_in: $ns}) {
      max { storedBytes } dimensions { date namespaceId } }
    d1: d1AnalyticsAdaptiveGroups(limit: 100, filter: {date_geq: $from, date_leq: $to, databaseId: $db}) {
      sum { rowsRead rowsWritten } }
    d1Storage: d1StorageAdaptiveGroups(limit: 1000, filter: {date_geq: $from, date_leq: $to, databaseId: $db}) {
      max { databaseSizeBytes } dimensions { date } }
    r2: r2OperationsAdaptiveGroups(limit: 1000, filter: {date_geq: $from, date_leq: $to, bucketName: $bucket}) {
      sum { requests } dimensions { actionType } }
    r2Storage: r2StorageAdaptiveGroups(limit: 1000, filter: {date_geq: $from, date_leq: $to, bucketName: $bucket}) {
      max { payloadSize metadataSize } dimensions { date storageClass } }
    queues: queueMessageOperationsAdaptiveGroups(limit: 100, filter: {date_geq: $from, date_leq: $to, queueId_in: $queues}) {
      sum { billableOperations } }
    kv: kvOperationsAdaptiveGroups(limit: 100, filter: {date_geq: $from, date_leq: $to, namespaceId: $kv}) {
      sum { requests } dimensions { actionType } }
    kvStorage: kvStorageAdaptiveGroups(limit: 1000, filter: {date_geq: $from, date_leq: $to, namespaceId: $kv}) {
      max { byteCount } dimensions { date } }
    ae: workersAnalyticsEngineAdaptiveGroups(limit: 100, filter: {date_geq: $from, date_leq: $to, dataset: $dataset}) {
      count }
    images: imagesTransformationsAdaptiveGroups(limit: 100, filter: {date_geq: $from, date_leq: $to, scriptName_in: $scripts}) {
      sum { billableEventCount } }
    browser: browserRenderingBrowserTimeUsageAdaptiveGroups(limit: 100, filter: {date_geq: $from, date_leq: $to}) {
      sum { totalSessionDurationMs } }
  } } }`;

const total: Record<string, number> = {};
const add = (k: string, v: unknown) => {
  total[k] = (total[k] ?? 0) + (Number(v) || 0);
};
/** Peak bytes per day, summed across the resources that report that day. */
const daily: Record<string, Map<string, number>> = {
  do: new Map(),
  d1: new Map(),
  r2: new Map(),
  kv: new Map(),
};
const peak = (k: string, date: string, bytes: unknown) => {
  const m = daily[k] as Map<string, number>;
  m.set(date, (m.get(date) ?? 0) + (Number(bytes) || 0));
};

for (const [from, to] of dateChunks(w.from, w.to)) {
  const a = await gql(QUERY, {
    a: account,
    from,
    to,
    scripts,
    ns: namespaces.length ? namespaces : ["none"],
    db: d.d1.id,
    bucket: d.r2,
    queues: queues.length ? queues : ["none"],
    kv: d.kv,
    dataset,
  });
  for (const r of a.workers ?? []) {
    add("workers.requests", r.sum.requests);
    add("workers.cpu_ms", r.sum.cpuTimeUs / 1000);
  }
  for (const r of a.doCalls ?? []) add("do.requests", r.sum.requests);
  for (const r of a.doPeriodic ?? []) {
    // Incoming WebSocket messages are billed as requests at 20:1.
    add("do.requests", r.sum.inboundWebsocketMsgCount / 20);
    add("do.duration_gbs", r.sum.duration);
    add("do.rows_read", r.sum.rowsRead);
    add("do.rows_written", r.sum.rowsWritten);
  }
  for (const r of a.doStorage ?? []) peak("do", r.dimensions.date, r.max.storedBytes);
  for (const r of a.d1 ?? []) {
    add("d1.rows_read", r.sum.rowsRead);
    add("d1.rows_written", r.sum.rowsWritten);
  }
  for (const r of a.d1Storage ?? []) peak("d1", r.dimensions.date, r.max.databaseSizeBytes);
  for (const r of a.r2 ?? []) {
    const c = r2Class(r.dimensions.actionType);
    if (c !== "free") add(`r2.class_${c}`, r.sum.requests);
  }
  for (const r of a.r2Storage ?? []) {
    peak("r2", r.dimensions.date, Number(r.max.payloadSize) + Number(r.max.metadataSize));
  }
  for (const r of a.queues ?? []) add("queues.operations", r.sum.billableOperations);
  for (const r of a.kv ?? []) {
    const t = String(r.dimensions.actionType);
    const k =
      t === "read"
        ? "kv.reads"
        : t === "delete"
          ? "kv.deletes"
          : t === "list"
            ? "kv.lists"
            : "kv.writes";
    add(k, r.sum.requests);
  }
  for (const r of a.kvStorage ?? []) peak("kv", r.dimensions.date, r.max.byteCount);
  for (const r of a.ae ?? []) add("ae.data_points", r.count);
  for (const r of a.images ?? []) add("images.transformations", r.sum.billableEventCount);
  for (const r of a.browser ?? []) add("browser.hours", r.sum.totalSessionDurationMs / 3_600_000);
}

const usage: Usage = {};
const counts = [
  "workers.requests",
  "workers.cpu_ms",
  "do.requests",
  "do.duration_gbs",
  "do.rows_read",
  "do.rows_written",
  "d1.rows_read",
  "d1.rows_written",
  "r2.class_a",
  "r2.class_b",
  "queues.operations",
  "kv.reads",
  "kv.writes",
  "kv.deletes",
  "kv.lists",
  "ae.data_points",
  "images.transformations",
  "browser.hours",
] as const;
for (const k of counts) usage[k] = total[k] ?? 0;
const levels = (k: string) => [...(daily[k] as Map<string, number>).values()];
usage["do.storage_gb_month"] = levels("do");
usage["d1.storage_gb_month"] = levels("d1");
usage["r2.storage_gb_month"] = levels("r2");
usage["kv.storage_gb_month"] = levels("kv");

// @tempra's spend, per account, from the deployment's D1 (one SELECT).
const q = (s: string) => `'${s.replaceAll("'", "''")}'`;
const { rows } = await d1Raw(
  d.d1.id,
  `SELECT a.user, COALESCE(u.handle, '?'), SUM(a.micro_usd), SUM(a.calls), SUM(a.turns)
   FROM agent_usage a LEFT JOIN users u ON u.id = a.user
   WHERE a.day >= ${q(w.from)} AND a.day <= ${q(w.to)} GROUP BY a.user`,
);
const agent: AgentSpend[] = rows.map((r) => ({
  user: String(r[0]),
  handle: String(r[1]),
  micro: Number(r[2]) || 0,
  calls: Number(r[3]) || 0,
  turns: Number(r[4]) || 0,
}));

const notes = [
  `Workers ${scripts.join(", ")}; Durable Object namespaces ${namespaces.length}; D1 ${d.d1.name}; R2 ${d.r2}; Queues ${queueNames.join(", ")} (${queues.length} found); KV ${d.kv}; dataset ${dataset}.`,
  'Included amounts are the account\'s, shared with other projects: "cost" is this deployment alone on the plan, a lower bound; "none included" is the upper bound.',
  "Cost per account and the most expensive accounts wait for TEMPRA-228's per-call metering (TEMPRA-236).",
];
if (now.getTime() - Date.parse(`${w.from}T00:00:00Z`) > 31 * 86_400_000) {
  notes.push(
    "The Analytics API keeps about 31 days for some datasets (D1 among them); older days may be missing.",
  );
}
const report = costReport(d.name, w, usage, agent, notes);
console.log(values.json ? JSON.stringify(report, null, 2) : reportText(report));
