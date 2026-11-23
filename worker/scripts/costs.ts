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
 * Cost per account (TEMPRA-236): TEMPRA-228's `cost` points and the `request` points in the
 * deployment's Analytics Engine dataset, read with the SQL API (src/ae.ts), joined to D1 for
 * library owners, stored bytes and @tempra; priced by accountCosts() in src/costs.ts. The
 * operator's account (`--operator <handle>`, or OPERATOR_EMAIL's) is left out of cost per active
 * account. The digest's lines wait on the app Worker's ANALYTICS_TOKEN.
 */
import { parseArgs } from "node:util";
import { deploymentFor } from "../cloudflare.config";
import { aeDataset, aeSql, aeString } from "../src/ae";
import {
  type AccountReport,
  type AgentSpend,
  accountCosts,
  accountsText,
  type CostMeter,
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
    operator: { type: "string" },
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
];
if (now.getTime() - Date.parse(`${w.from}T00:00:00Z`) > 31 * 86_400_000) {
  notes.push(
    "The Analytics API keeps about 31 days for some datasets (D1 among them); older days may be missing.",
  );
}
const report = costReport(d.name, w, usage, agent, notes);

// Cost per account (TEMPRA-236): the month's `cost` and `request` points from Analytics Engine.
const nextMonth = new Date(Date.parse(`${w.from}T00:00:00Z`));
nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
const within = `timestamp >= toDateTime(${aeString(`${w.from} 00:00:00`)})
    AND timestamp < toDateTime(${aeString(`${nextMonth.toISOString().slice(0, 10)} 00:00:00`)})`;
const ae = { accountId: account, token };
const ds = aeDataset(dataset);
let accounts: AccountReport | null = null;
let accountsError: string | null = null;
try {
  // usagePoint's layout (src/usage.ts): blob1 the kind, index1 the account, blob3 the library;
  // double3 DO calls, double4 rows read, double5 rows written, double8 round-trip ms.
  const costRows = await aeSql<Record<string, string | number>>(
    ae,
    `SELECT index1 AS account, blob3 AS library, SUM(_sample_interval) AS points,
    SUM(_sample_interval * double3) AS do_calls, SUM(_sample_interval * double4) AS rows_read,
    SUM(_sample_interval * double5) AS rows_written, SUM(_sample_interval * double8) AS ms
  FROM ${ds} WHERE blob1 = 'cost' AND ${within}
  GROUP BY account, library`,
  );
  const requestRows = await aeSql<Record<string, string | number>>(
    ae,
    `SELECT index1 AS account, SUM(_sample_interval) AS n FROM ${ds}
  WHERE blob1 = 'request' AND ${within} GROUP BY account`,
  );
  const meters: CostMeter[] = costRows.map((r) => ({
    account: String(r.account ?? ""),
    library: String(r.library ?? ""),
    points: Number(r.points) || 0,
    doCalls: Number(r.do_calls) || 0,
    rowsRead: Number(r.rows_read) || 0,
    rowsWritten: Number(r.rows_written) || 0,
    ms: Number(r.ms) || 0,
  }));
  const requests: Record<string, number> = {};
  for (const r of requestRows) requests[String(r.account ?? "")] = Number(r.n) || 0;

  // Library owners and stored bytes by owner (one SELECT), and the operator's handle.
  const libs = await d1Raw(
    d.d1.id,
    `SELECT l.id, COALESCE(u.handle, ''), l.storage_bytes FROM libraries l LEFT JOIN users u ON u.id = l.owner`,
  );
  const owners: Record<string, string> = {};
  const storage: Record<string, number> = {};
  for (const r of libs.rows) {
    const handle = String(r[1]);
    if (!handle) continue;
    owners[String(r[0])] = handle;
    storage[handle] = (storage[handle] ?? 0) + (Number(r[2]) || 0);
  }
  let operator = values.operator?.replace(/^@/, "");
  const operatorEmail = process.env.OPERATOR_EMAIL;
  if (!operator && operatorEmail) {
    const op = await d1Raw(
      d.d1.id,
      `SELECT handle FROM users WHERE email = ${q(operatorEmail.toLowerCase())}`,
    );
    operator = op.rows[0] ? String(op.rows[0][0]) : undefined;
  }
  accounts = accountCosts({ meters, requests, owners, storage, agent, operator }, report);
  if (!operator) {
    report.notes.push(
      "No operator account given (--operator or OPERATOR_EMAIL): cost per active account counts every account.",
    );
  }
} catch (e) {
  accountsError = String(e);
  report.notes.push(`Cost per account unavailable: ${accountsError}`);
}

if (values.json) {
  console.log(JSON.stringify({ ...report, accounts }, null, 2));
} else {
  console.log(reportText(report));
  if (accounts) console.log(accountsText(accounts));
}
