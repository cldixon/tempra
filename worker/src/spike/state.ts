import { OkfError } from "../store/errors";
import type { SqlHandle } from "../store/sql";
import { type Arm, MAX_NEW_THREADS, SPEND_CAP_USD, type Usage } from "./models";
import type { TaskSet } from "./tasks";

/**
 * The library agent's state for the spike (TEMPRA-67), in its Durable Object's SQLite: the
 * task set, one copy of the base library per arm and model, runs, what each item cost and
 * produced, the comments written, and the operator's grades. Free of Worker APIs so bun tests
 * run it on bun:sqlite. One instance per base library; one more ("_spike") keeps the spend
 * ledger and which copy belongs to which base library.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS copies (
  arm TEXT NOT NULL, model TEXT NOT NULL,
  library_id TEXT NOT NULL, owner TEXT NOT NULL, slug TEXT NOT NULL, do_id TEXT NOT NULL,
  token_id TEXT, threads TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (arm, model)
);
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  arm TEXT NOT NULL, model TEXT NOT NULL, batch INTEGER NOT NULL,
  status TEXT NOT NULL, workflow TEXT,
  created TEXT NOT NULL, started TEXT, finished TEXT, error TEXT,
  current_item INTEGER, threads INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS results (
  run INTEGER NOT NULL, item INTEGER NOT NULL,
  status TEXT NOT NULL, started TEXT, finished TEXT, latency_ms INTEGER,
  turns INTEGER NOT NULL DEFAULT 0, retries INTEGER NOT NULL DEFAULT 0,
  failures INTEGER NOT NULL DEFAULT 0,
  input INTEGER NOT NULL DEFAULT 0, output INTEGER NOT NULL DEFAULT 0,
  cache_read INTEGER NOT NULL DEFAULT 0, cache_write INTEGER NOT NULL DEFAULT 0,
  cost REAL NOT NULL DEFAULT 0, session TEXT, final TEXT, error TEXT,
  PRIMARY KEY (run, item)
);
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run INTEGER NOT NULL, item INTEGER, kind TEXT NOT NULL,
  thread TEXT NOT NULL, path TEXT NOT NULL, body TEXT NOT NULL, seq INTEGER, at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS grades (
  run INTEGER NOT NULL, item INTEGER NOT NULL, grade TEXT NOT NULL, at TEXT NOT NULL,
  PRIMARY KEY (run, item)
);
CREATE TABLE IF NOT EXISTS spend (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, what TEXT NOT NULL,
  model TEXT NOT NULL, usd REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS copy_of (library_id TEXT PRIMARY KEY, base TEXT NOT NULL);
`;

export type RunStatus = "queued" | "running" | "done" | "failed" | "stopped";

export interface Copy {
  arm: Arm;
  model: string;
  library_id: string;
  owner: string;
  slug: string;
  do_id: string;
  token_id: string | null;
  /** Question item → the thread it was posted as, in this copy. */
  threads: Record<string, string>;
}

export interface Run {
  id: number;
  arm: Arm;
  model: string;
  batch: number;
  status: RunStatus;
  workflow: string | null;
  created: string;
  started: string | null;
  finished: string | null;
  error: string | null;
  current_item: number | null;
  threads: number;
}

export interface ItemResult {
  run: number;
  item: number;
  status: "running" | "ok" | "failed" | "skipped";
  started: string | null;
  finished: string | null;
  latency_ms: number | null;
  turns: number;
  retries: number;
  failures: number;
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
  cost: number;
  session: string | null;
  final: string | null;
  error: string | null;
}

export interface RecordedComment {
  id: number;
  run: number;
  item: number | null;
  kind: string;
  thread: string;
  path: string;
  body: string;
  seq: number | null;
  at: string;
}

export type Grade = "useful" | "neutral" | "wrong";
export const GRADES: Grade[] = ["useful", "neutral", "wrong"];

/** How an item ended, as its runner reports it (usage is added as it is spent). */
export interface ItemOutcome {
  status: "ok" | "failed" | "skipped";
  /** Model or API calls retried inside the item (the SDK's own retries are not seen). */
  retries: number;
  failures: number;
  latency_ms: number;
  session?: string | null;
  final?: string | null;
  error?: string | null;
}

export class SpikeState {
  constructor(
    private readonly sql: SqlHandle,
    private readonly now: () => Date = () => new Date(),
  ) {
    sql.script(SCHEMA);
  }

  private get<T>(key: string): T | null {
    const row = this.sql.all<{ value: string }>("SELECT value FROM meta WHERE key = ?", key)[0];
    return row ? (JSON.parse(row.value) as T) : null;
  }

  private set(key: string, value: unknown) {
    this.sql.run(
      "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      key,
      JSON.stringify(value),
    );
  }

  // -------------------------------------------------------------- the task set

  taskSet(): TaskSet | null {
    return this.get<TaskSet>("taskset");
  }

  /** Saved once: replacing it would make earlier runs incomparable, so that needs `replace`. */
  saveTaskSet(set: TaskSet, replace = false) {
    if (this.taskSet() && !replace) {
      throw new OkfError(409, "taskset_exists", "The task set is already chosen; pass replace.");
    }
    if (replace && this.runs().length > 0) {
      throw new OkfError(409, "runs_exist", "Runs used this task set; it can no longer change.");
    }
    this.set("taskset", set);
  }

  /** A random value, made once, that keeps the grading sheet's order and keys unguessable. */
  salt(): string {
    let salt = this.get<string>("salt");
    if (!salt) {
      salt = crypto.randomUUID();
      this.set("salt", salt);
    }
    return salt;
  }

  /** Managed Agents resources (Arm B): created once, reused by every session. */
  cma(): Record<string, string> {
    return this.get<Record<string, string>>("cma") ?? {};
  }

  setCma(ids: Record<string, string>) {
    this.set("cma", { ...this.cma(), ...ids });
  }

  // -------------------------------------------------------------- copies

  copy(arm: Arm, model: string): Copy | null {
    const row = this.sql.all<Omit<Copy, "threads"> & { threads: string }>(
      "SELECT * FROM copies WHERE arm = ? AND model = ?",
      arm,
      model,
    )[0];
    return row ? { ...row, threads: JSON.parse(row.threads) } : null;
  }

  copies(): Copy[] {
    return this.sql
      .all<Omit<Copy, "threads"> & { threads: string }>("SELECT * FROM copies ORDER BY arm, model")
      .map((r) => ({ ...r, threads: JSON.parse(r.threads) }));
  }

  saveCopy(c: Copy) {
    this.sql.run(
      `INSERT INTO copies (arm, model, library_id, owner, slug, do_id, token_id, threads)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (arm, model) DO UPDATE SET library_id = excluded.library_id,
         owner = excluded.owner, slug = excluded.slug, do_id = excluded.do_id,
         token_id = excluded.token_id, threads = excluded.threads`,
      c.arm,
      c.model,
      c.library_id,
      c.owner,
      c.slug,
      c.do_id,
      c.token_id,
      JSON.stringify(c.threads),
    );
  }

  // -------------------------------------------------------------- runs

  /** Queues a run; one per library at a time, so a second while one is active is refused. */
  createRun(arm: Arm, model: string, batch: number): Run {
    const active = this.active();
    if (active) {
      throw new OkfError(409, "run_active", `Run ${active.id} is still ${active.status}.`, {
        run: active.id,
      });
    }
    this.sql.run(
      "INSERT INTO runs (arm, model, batch, status, created) VALUES (?, ?, ?, 'queued', ?)",
      arm,
      model,
      batch,
      this.now().toISOString(),
    );
    const id = this.sql.all<{ id: number }>("SELECT last_insert_rowid() AS id")[0]?.id ?? 0;
    return this.run(id) as Run;
  }

  run(id: number): Run | null {
    return this.sql.all<Run>("SELECT * FROM runs WHERE id = ?", id)[0] ?? null;
  }

  runs(): Run[] {
    return this.sql.all<Run>("SELECT * FROM runs ORDER BY id");
  }

  active(): Run | null {
    return (
      this.sql.all<Run>(
        "SELECT * FROM runs WHERE status IN ('queued', 'running') ORDER BY id DESC LIMIT 1",
      )[0] ?? null
    );
  }

  setWorkflow(id: number, workflow: string) {
    this.sql.run("UPDATE runs SET workflow = ? WHERE id = ?", workflow, id);
  }

  startRun(id: number) {
    this.sql.run(
      "UPDATE runs SET status = 'running', started = COALESCE(started, ?) WHERE id = ?",
      this.now().toISOString(),
      id,
    );
  }

  finishRun(id: number, status: Exclude<RunStatus, "queued" | "running">, error?: string) {
    this.sql.run(
      "UPDATE runs SET status = ?, finished = ?, error = ?, current_item = NULL WHERE id = ?",
      status,
      this.now().toISOString(),
      error ?? null,
      id,
    );
  }

  /** The batches of (arm, model) that finished, so "run now" can take the next one. */
  doneBatches(arm: Arm, model: string): number[] {
    return this.sql
      .all<{ batch: number }>(
        "SELECT DISTINCT batch FROM runs WHERE arm = ? AND model = ? AND status = 'done' ORDER BY batch",
        arm,
        model,
      )
      .map((r) => r.batch);
  }

  // -------------------------------------------------------------- items

  /**
   * Marks an item started. A Workflow retry starts it again: that counts as a retry, and what
   * the failed attempt spent stays in the row (usage is added as it is spent, addUsage).
   */
  beginItem(run: number, item: number) {
    const at = this.now().toISOString();
    this.sql.transaction(() => {
      this.sql.run(
        `INSERT INTO results (run, item, status, started) VALUES (?, ?, 'running', ?)
         ON CONFLICT (run, item) DO UPDATE SET status = 'running',
           retries = results.retries + (results.status = 'running')`,
        run,
        item,
        at,
      );
      this.sql.run("UPDATE runs SET current_item = ? WHERE id = ?", item, run);
    });
  }

  /** Adds one model call's usage and cost to an item, as it is spent. */
  addUsage(run: number, item: number, u: Usage, cost: number, turns = 1) {
    this.sql.run(
      `UPDATE results SET turns = turns + ?, input = input + ?, output = output + ?,
         cache_read = cache_read + ?, cache_write = cache_write + ?, cost = cost + ?
       WHERE run = ? AND item = ?`,
      turns,
      u.input,
      u.output,
      u.cacheRead,
      u.cacheWrite,
      cost,
      run,
      item,
    );
  }

  /** Records how an item ended. */
  endItem(run: number, item: number, o: ItemOutcome) {
    this.sql.run(
      `UPDATE results SET status = ?, finished = ?, latency_ms = ?, retries = retries + ?,
         failures = failures + ?, session = COALESCE(?, session), final = ?, error = ?
       WHERE run = ? AND item = ?`,
      o.status,
      this.now().toISOString(),
      o.latency_ms,
      o.retries,
      o.failures,
      o.session ?? null,
      o.final ?? null,
      o.error ?? null,
      run,
      item,
    );
  }

  result(run: number, item: number): ItemResult | null {
    return (
      this.sql.all<ItemResult>("SELECT * FROM results WHERE run = ? AND item = ?", run, item)[0] ??
      null
    );
  }

  results(run?: number): ItemResult[] {
    return run === undefined
      ? this.sql.all<ItemResult>("SELECT * FROM results ORDER BY run, item")
      : this.sql.all<ItemResult>("SELECT * FROM results WHERE run = ? ORDER BY item", run);
  }

  // -------------------------------------------------------------- comments

  /**
   * Admits a comment action from the agent during a run (both arms post through the same MCP
   * tool, which asks here first): a new thread counts against the run's cap, and is refused
   * past it. Answers which run and item it is for.
   */
  admitComment(kind: string): { run: number; item: number | null } {
    const run = this.active();
    if (!run || run.status !== "running") {
      throw new OkfError(409, "no_run", "The agent comments only during a run.");
    }
    if (kind === "open") {
      if (run.threads >= MAX_NEW_THREADS) {
        throw new OkfError(
          429,
          "thread_cap",
          `This run has opened ${MAX_NEW_THREADS} threads, its limit. Reply in an existing thread or stop.`,
        );
      }
      this.sql.run("UPDATE runs SET threads = threads + 1 WHERE id = ?", run.id);
    } else if (kind === "resolve" || kind === "reopen") {
      throw new OkfError(403, "agent_no_resolve", "The agent never resolves or reopens threads.");
    }
    return { run: run.id, item: run.current_item };
  }

  /** Gives back an admitted thread that was not opened (the write failed). */
  releaseThread(run: number) {
    this.sql.run("UPDATE runs SET threads = MAX(threads - 1, 0) WHERE id = ?", run);
  }

  recordComment(c: Omit<RecordedComment, "id" | "at">) {
    this.sql.run(
      "INSERT INTO comments (run, item, kind, thread, path, body, seq, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      c.run,
      c.item,
      c.kind,
      c.thread,
      c.path,
      c.body,
      c.seq,
      this.now().toISOString(),
    );
  }

  comments(run?: number): RecordedComment[] {
    return run === undefined
      ? this.sql.all<RecordedComment>("SELECT * FROM comments ORDER BY id")
      : this.sql.all<RecordedComment>("SELECT * FROM comments WHERE run = ? ORDER BY id", run);
  }

  // -------------------------------------------------------------- grades

  grade(run: number, item: number, grade: Grade) {
    if (!GRADES.includes(grade)) throw new OkfError(400, "bad_grade", "useful, neutral or wrong.");
    this.sql.run(
      `INSERT INTO grades (run, item, grade, at) VALUES (?, ?, ?, ?)
       ON CONFLICT (run, item) DO UPDATE SET grade = excluded.grade, at = excluded.at`,
      run,
      item,
      grade,
      this.now().toISOString(),
    );
  }

  grades(): { run: number; item: number; grade: Grade }[] {
    return this.sql.all("SELECT run, item, grade FROM grades ORDER BY run, item");
  }

  // -------------------------------------------------------------- the spend ledger ("_spike")

  spent(): number {
    return (
      this.sql.all<{ usd: number }>("SELECT COALESCE(SUM(usd), 0) AS usd FROM spend")[0]?.usd ?? 0
    );
  }

  cap(): number {
    return this.get<number>("cap") ?? SPEND_CAP_USD;
  }

  setCap(usd: number) {
    if (!(usd > 0)) throw new OkfError(400, "bad_cap", "The cap is a positive amount of USD.");
    this.set("cap", usd);
  }

  /** What may still be spent; refuses at the cap. */
  remaining(): number {
    const left = this.cap() - this.spent();
    if (left <= 0) {
      throw new OkfError(
        402,
        "spend_cap",
        `The spike has spent $${this.spent().toFixed(2)} of its $${this.cap()} cap.`,
      );
    }
    return left;
  }

  charge(what: string, model: string, usd: number) {
    if (usd <= 0) return;
    this.sql.run(
      "INSERT INTO spend (at, what, model, usd) VALUES (?, ?, ?, ?)",
      this.now().toISOString(),
      what,
      model,
      usd,
    );
  }

  spendByModel(): { model: string; usd: number }[] {
    return this.sql.all("SELECT model, SUM(usd) AS usd FROM spend GROUP BY model ORDER BY model");
  }

  linkCopy(libraryId: string, base: string) {
    this.sql.run(
      "INSERT INTO copy_of (library_id, base) VALUES (?, ?) ON CONFLICT (library_id) DO UPDATE SET base = excluded.base",
      libraryId,
      base,
    );
  }

  baseOf(libraryId: string): string | null {
    return (
      this.sql.all<{ base: string }>("SELECT base FROM copy_of WHERE library_id = ?", libraryId)[0]
        ?.base ?? null
    );
  }
}
