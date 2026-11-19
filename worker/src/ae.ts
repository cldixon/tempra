/**
 * Analytics Engine's SQL API, for reading `tempra_usage` back (usage.ts writes it): one helper so
 * `bun run admin limits`, `bun run costs` and later the operator digest (TEMPRA-236) share one
 * copy. Free of Worker APIs: it takes the account, a token with Account Analytics Read and `fetch`.
 */

export interface AeConfig {
  accountId: string;
  token: string;
}

/** A string literal for the SQL API, quotes doubled. */
export const aeString = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** A dataset name, checked before it goes into a query unquoted. */
export function aeDataset(name: string): string {
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`Not a dataset name: ${name}`);
  return name;
}

/** Runs one query and returns its rows; throws with the API's status and the start of its body. */
export async function aeSql<Row = Record<string, unknown>>(
  cfg: AeConfig,
  sql: string,
  fetcher: typeof fetch = fetch,
): Promise<Row[]> {
  const res = await fetcher(
    `https://api.cloudflare.com/client/v4/accounts/${cfg.accountId}/analytics_engine/sql`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.token}` },
      body: /\bFORMAT\s+JSON\s*$/i.test(sql) ? sql : `${sql}\nFORMAT JSON`,
    },
  );
  if (!res.ok)
    throw new Error(`Analytics Engine SQL ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { data?: Row[] };
  return body.data ?? [];
}
