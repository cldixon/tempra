import { esc } from "../oauth/pages";
import { sha256Hex } from "../okf/hash";
import { type Arm, costOf, modelSpec } from "./models";
import type { Grade, ItemResult, RecordedComment, Run } from "./state";
import type { TaskItem, TaskSet } from "./tasks";

/**
 * The spike's read-outs (TEMPRA-67): the blind grading sheet, where each item shows what every
 * arm and model wrote for it in a shuffled order under hidden labels, and the results table the
 * grades feed. Pure functions over the agent's state, so bun tests check them.
 */
export interface Candidate {
  /** Opaque: names the response on the sheet without telling which run wrote it. */
  key: string;
  run: number;
  arm: Arm;
  model: string;
  item: number;
  status: ItemResult["status"];
  comments: RecordedComment[];
  final: string | null;
  grade: Grade | null;
}

export interface SheetData {
  set: TaskSet;
  runs: Run[];
  results: ItemResult[];
  comments: RecordedComment[];
  grades: { run: number; item: number; grade: Grade }[];
  salt: string;
}

const keyOf = (salt: string, run: number, item: number) =>
  sha256Hex(`${salt}|${run}|${item}`).slice(0, 16);

/**
 * Every item's responses: per arm and model, the latest run that finished the item (ok, or
 * failed after writing something), in an order fixed by the salt, so reloading keeps it and
 * nothing about it says which model wrote what.
 */
export function candidates(data: SheetData): Map<number, Candidate[]> {
  const runs = new Map(data.runs.map((r) => [r.id, r]));
  const grades = new Map(data.grades.map((g) => [`${g.run}|${g.item}`, g.grade]));
  const latest = new Map<string, Candidate>();
  for (const res of data.results) {
    const run = runs.get(res.run);
    if (!run) continue;
    const comments = data.comments.filter((c) => c.run === res.run && c.item === res.item);
    if (res.status !== "ok" && comments.length === 0) continue;
    const slot = `${run.arm}|${run.model}|${res.item}`;
    const prior = latest.get(slot);
    if (prior && prior.run > res.run) continue;
    latest.set(slot, {
      key: keyOf(data.salt, res.run, res.item),
      run: res.run,
      arm: run.arm,
      model: run.model,
      item: res.item,
      status: res.status,
      comments,
      final: res.final,
      grade: grades.get(`${res.run}|${res.item}`) ?? null,
    });
  }
  const out = new Map<number, Candidate[]>();
  for (const c of latest.values()) {
    const list = out.get(c.item) ?? [];
    list.push(c);
    out.set(c.item, list);
  }
  for (const list of out.values()) list.sort((a, b) => a.key.localeCompare(b.key));
  return out;
}

/** Finds the response a sheet's field names. */
export function byKey(data: SheetData, key: string): Candidate | null {
  for (const list of candidates(data).values()) {
    const c = list.find((x) => x.key === key);
    if (c) return c;
  }
  return null;
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function itemHeading(item: TaskItem): string {
  const what = item.kind === "question" ? "Question" : `Work item (${item.kind.replace("_", " ")})`;
  return `<h2>${item.n}. ${esc(what)} on <code>${esc(item.path)}</code></h2>
<blockquote>${esc(item.detail)}</blockquote>${
    item.suggested_action ? `<p>The queue suggests: ${esc(item.suggested_action)}</p>` : ""
  }`;
}

function responseHtml(c: Candidate, letter: string): string {
  const said = c.comments.length
    ? c.comments
        .map(
          (m) =>
            `<p>${m.kind === "open" ? "Opened a thread on" : "Replied on"} <code>${esc(m.path)}</code>:</p><blockquote>${esc(m.body)}</blockquote>`,
        )
        .join("")
    : `<p>No comment. Its last words: ${c.final ? esc(c.final) : "(none)"}</p>`;
  const choices = (["useful", "neutral", "wrong"] as Grade[])
    .map(
      (g) =>
        `<label><input type="radio" name="g_${c.key}" value="${g}"${c.grade === g ? " checked" : ""}> ${g}</label>`,
    )
    .join(" ");
  return `<fieldset><legend>Response ${letter}</legend>${said}<p>${choices}</p></fieldset>`;
}

/** The blind grading sheet: a no-script form, posted back to the same URL. */
export function gradingSheet(data: SheetData, action: string, saved?: number): string {
  const all = candidates(data);
  const graded = [...all.values()].flat().filter((c) => c.grade).length;
  const total = [...all.values()].flat().length;
  const items = data.set.items
    .map((item) => {
      const list = all.get(item.n) ?? [];
      if (list.length === 0) return "";
      return `<section>${itemHeading(item)}${list.map((c, i) => responseHtml(c, LETTERS[i] ?? String(i + 1))).join("")}</section>`;
    })
    .join("");
  return `<h1>Grade the librarian</h1>
<p>Each item shows what every model wrote, shuffled, with the model hidden. Mark each response useful, neutral or wrong. ${graded} of ${total} graded.${saved !== undefined ? ` Saved ${saved}.` : ""}</p>
<form method="post" action="${esc(action)}">${items || "<p>No responses yet.</p>"}
<p><button class="pill" type="submit">Save grades</button></p></form>`;
}

// ------------------------------------------------------------------ the results table

export interface ResultRow {
  arm: Arm;
  model: string;
  runs: number;
  items: number;
  ok: number;
  failed: number;
  skipped: number;
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
  /** What was charged: Arm A at list price from tokens; Arm B the session's list cost. */
  cost: number;
  /**
   * The tokens at list price, the same way for both arms: Arm B's list cost also has session
   * runtime ($0.08 an hour) and is rounded to the cent per session.
   */
  token_cost: number;
  latency_p50_ms: number | null;
  latency_p90_ms: number | null;
  latency_mean_ms: number | null;
  retries: number;
  failures: number;
  threads: number;
  replies: number;
  useful: number;
  neutral: number;
  wrong: number;
  ungraded: number;
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i] ?? null;
}

/** One row per arm and model: what it cost, how fast, how often it failed, how it graded. */
export function resultsTable(data: SheetData): ResultRow[] {
  const runs = new Map(data.runs.map((r) => [r.id, r]));
  const rows = new Map<string, ResultRow & { lat: number[]; runIds: Set<number> }>();
  const rowFor = (arm: Arm, model: string) => {
    const k = `${arm}|${model}`;
    let row = rows.get(k);
    if (!row) {
      row = {
        arm,
        model,
        runs: 0,
        items: 0,
        ok: 0,
        failed: 0,
        skipped: 0,
        input: 0,
        output: 0,
        cache_read: 0,
        cache_write: 0,
        cost: 0,
        token_cost: 0,
        latency_p50_ms: null,
        latency_p90_ms: null,
        latency_mean_ms: null,
        retries: 0,
        failures: 0,
        threads: 0,
        replies: 0,
        useful: 0,
        neutral: 0,
        wrong: 0,
        ungraded: 0,
        lat: [],
        runIds: new Set(),
      };
      rows.set(k, row);
    }
    return row;
  };
  for (const res of data.results) {
    const run = runs.get(res.run);
    if (!run) continue;
    const row = rowFor(run.arm, run.model);
    row.runIds.add(res.run);
    row.items++;
    if (res.status === "ok") row.ok++;
    else if (res.status === "failed") row.failed++;
    else if (res.status === "skipped") row.skipped++;
    row.input += res.input;
    row.output += res.output;
    row.cache_read += res.cache_read;
    row.cache_write += res.cache_write;
    row.cost += res.cost;
    const spec = modelSpec(run.model);
    if (spec) {
      row.token_cost += costOf(spec, {
        input: res.input,
        output: res.output,
        cacheRead: res.cache_read,
        cacheWrite: res.cache_write,
      });
    }
    row.retries += res.retries;
    row.failures += res.failures;
    if (res.status !== "skipped" && res.latency_ms !== null) row.lat.push(res.latency_ms);
  }
  for (const c of data.comments) {
    const run = runs.get(c.run);
    if (!run) continue;
    const row = rowFor(run.arm, run.model);
    if (c.kind === "open") row.threads++;
    else row.replies++;
  }
  for (const list of candidates(data).values()) {
    for (const c of list) {
      const row = rowFor(c.arm, c.model);
      if (c.grade) row[c.grade]++;
      else row.ungraded++;
    }
  }
  return [...rows.values()]
    .map(({ lat, runIds, ...row }) => {
      const sorted = [...lat].sort((a, b) => a - b);
      return {
        ...row,
        runs: runIds.size,
        cost: Math.round(row.cost * 10000) / 10000,
        token_cost: Math.round(row.token_cost * 10000) / 10000,
        latency_p50_ms: percentile(sorted, 50),
        latency_p90_ms: percentile(sorted, 90),
        latency_mean_ms: sorted.length
          ? Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length)
          : null,
      };
    })
    .sort((a, b) => a.arm.localeCompare(b.arm) || a.model.localeCompare(b.model));
}

const secs = (ms: number | null) => (ms === null ? "–" : `${(ms / 1000).toFixed(1)} s`);

/** The labelled report: the results table and every run's items, with links to the comments. */
export function reportPage(
  data: SheetData,
  opts: {
    spent: number;
    cap: number;
    copies: { arm: Arm; model: string; owner: string; slug: string }[];
  },
): string {
  const rows = resultsTable(data);
  const name = (model: string) => modelSpec(model)?.label ?? model;
  const table = rows.length
    ? `<table><thead><tr><th>Arm</th><th>Model</th><th>Runs</th><th>Items ok / failed / skipped</th><th>Tokens in / out / cache read / cache write</th><th>Cost charged / at token prices</th><th>Latency p50 / p90</th><th>Retries</th><th>Failures</th><th>Threads / replies</th><th>Useful / neutral / wrong / ungraded</th></tr></thead><tbody>${rows
        .map(
          (r) =>
            `<tr><td>${r.arm.toUpperCase()}</td><td>${esc(name(r.model))}</td><td>${r.runs}</td><td>${r.ok} / ${r.failed} / ${r.skipped}</td><td>${r.input} / ${r.output} / ${r.cache_read} / ${r.cache_write}</td><td>$${r.cost.toFixed(4)} / $${r.token_cost.toFixed(4)}</td><td>${secs(r.latency_p50_ms)} / ${secs(r.latency_p90_ms)}</td><td>${r.retries}</td><td>${r.failures}</td><td>${r.threads} / ${r.replies}</td><td>${r.useful} / ${r.neutral} / ${r.wrong} / ${r.ungraded}</td></tr>`,
        )
        .join("")}</tbody></table>`
    : "<p>No runs yet.</p>";
  const copyOf = new Map(opts.copies.map((c) => [`${c.arm}|${c.model}`, c]));
  const runList = data.runs
    .map((run) => {
      const copy = copyOf.get(`${run.arm}|${run.model}`);
      const items = data.results
        .filter((r) => r.run === run.id)
        .map((r) => {
          const said = data.comments
            .filter((c) => c.run === run.id && c.item === r.item)
            .map((c) => {
              const link = copy ? `/${copy.owner}/${copy.slug}/${c.path}` : "";
              return `<li>${c.kind} on ${link ? `<a href="${esc(link)}">${esc(c.path)}</a>` : esc(c.path)}: ${esc(c.body)}</li>`;
            })
            .join("");
          return `<li>Item ${r.item}: ${r.status}, ${secs(r.latency_ms)}, $${r.cost.toFixed(4)}, ${r.turns} turns${r.error ? `, ${esc(r.error)}` : ""}${said ? `<ul>${said}</ul>` : ""}</li>`;
        })
        .join("");
      return `<section><h3>Run ${run.id}: arm ${run.arm.toUpperCase()}, ${esc(name(run.model))}, batch ${run.batch}, ${run.status}${run.error ? ` (${esc(run.error)})` : ""}</h3><ul>${items}</ul></section>`;
    })
    .join("");
  return `<h1>Librarian spike results</h1>
<p>Spent $${opts.spent.toFixed(2)} of the $${opts.cap} cap (list prices).</p>${table}<h2>Runs</h2>${runList}`;
}
