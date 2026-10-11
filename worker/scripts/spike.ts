/**
 * `bun run spike`: the managed-agent spike (TEMPRA-67) on a PR's preview, from a terminal. It
 * calls the library's owner-only agent routes with the operator's preview token (the same one
 * `bun run mcp --pr N` keeps); the token is never printed.
 *
 *   bun run spike --pr 62 --library tempra-dev status            task set, runs, spend, keys
 *   bun run spike --pr 62 --library tempra-dev tasks             choose the task set (once)
 *   bun run spike --pr 62 --library tempra-dev run a glm-5.3 [batch]
 *   bun run spike --pr 62 --library tempra-dev run-status 3      a run's items and comments
 *   bun run spike --pr 62 --library tempra-dev results           the results table
 *   bun run spike --pr 62 --library tempra-dev stop 3            mark a stuck run stopped
 *
 * The grading sheet is a page: /api/v1/libraries/<owner>/<library>/agent/grading, signed in.
 */
import { parseArgs } from "node:util";
import { previewToken } from "./preview-token";

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    pr: { type: "string" },
    library: { type: "string" },
    actor: { type: "string" },
  },
});
const [command, ...rest] = positionals;
if (!values.pr || !values.library || !command) {
  console.error(
    "Usage: bun run spike --pr N --library <slug> status|tasks|run <arm> <model> [batch]|run-status <id>|results|stop <id>",
  );
  process.exit(2);
}
const t = await previewToken(values.pr, values.library, values.actor ?? "claude-code/dev");
const base = `${t.url}/api/v1/libraries/${t.owner}/${t.slug}/agent`;

async function call(method: string, path: string, body?: unknown): Promise<unknown> {
  const r = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${t.token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const out = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok) {
    console.error(JSON.stringify(out));
    process.exit(1);
  }
  return out;
}

const print = (v: unknown) => console.log(JSON.stringify(v, null, 2));

switch (command) {
  case "status": {
    const s = (await call("GET", "")) as Record<string, unknown> & {
      taskset: { batches: number[][] } | null;
    };
    print({ ...s, taskset: s.taskset ? { batches: s.taskset.batches } : null });
    break;
  }
  case "tasks":
    print(await call("POST", "/tasks", {}));
    break;
  case "run": {
    const [arm, model, batch] = rest;
    print(await call("POST", "/runs", { arm, model, ...(batch ? { batch: Number(batch) } : {}) }));
    break;
  }
  case "run-status":
    print(await call("GET", `/runs/${rest[0]}`));
    break;
  case "results":
    print(await call("GET", "/results"));
    break;
  case "stop":
    print(await call("POST", `/runs/${rest[0]}/stop`));
    break;
  default:
    console.error(`Unknown command ${command}.`);
    process.exit(2);
}
