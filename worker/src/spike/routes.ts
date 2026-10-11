import type { Context, Hono } from "hono";
import type { Deps } from "../app";
import type { TokenInfo } from "../auth";
import type { LibraryClient } from "../client";
import { page } from "../oauth/pages";
import { OkfError } from "../store/errors";
import { requireOwner } from "../tenancy";
import { SPIKE_INSTANCE } from "./agent-client";
import { type Arm, MODELS, modelSpec } from "./models";
import { byKey, gradingSheet, reportPage, resultsTable, type SheetData } from "./report";
import { type RunDeps, type RunParams, saveBundle } from "./runner";
import { GRADES, type Grade } from "./state";
import { batches, buildTaskSet } from "./tasks";

type SpikeEnv = {
  Bindings: Cloudflare.Env;
  Variables: { token: TokenInfo; lib: LibraryClient; deps: Deps };
};
type C = Context<SpikeEnv>;

/**
 * The spike's routes (TEMPRA-67), under a library's API path, for its owner only, on a preview
 * that binds the spike (404 elsewhere): choose the task set, run now, the blind grading sheet,
 * and the results.
 */
export function registerSpikeRoutes(app: Hono<SpikeEnv>, base: string) {
  const ready = (c: C) => {
    const d = c.var.deps;
    if (!d.spike) throw new OkfError(404, "no_route", "No such route.");
    requireOwner(c.var.token.role, "run the library's agent");
    return { d: d as Deps & RunDeps, spike: d.spike, lib: c.var.token.library };
  };

  const sheetData = async (c: C): Promise<SheetData> => {
    const { spike, lib } = ready(c);
    const agent = spike.agent(lib.id);
    const set = await agent.taskSet();
    if (!set)
      throw new OkfError(404, "no_taskset", "Choose the task set first: POST …/agent/tasks.");
    const [runs, results, comments, grades, salt] = await Promise.all([
      agent.runs(),
      agent.results(),
      agent.comments(),
      agent.grades(),
      agent.salt(),
    ]);
    return { set, runs, results, comments, grades, salt };
  };

  app.get(`${base}/agent`, async (c) => {
    const { d, spike, lib } = ready(c);
    const agent = spike.agent(lib.id);
    const budget = spike.agent(SPIKE_INSTANCE);
    const set = await agent.taskSet();
    return c.json({
      models: MODELS.map((m) => ({ id: m.id, label: m.label, arms: m.arms })),
      keys: { anthropic: (await spike.anthropic()) !== null, workers_ai: spike.ai !== null },
      taskset: set
        ? {
            built_at: set.built_at,
            seq: set.seq,
            items: set.items,
            batches: batches(set).map((b) => b.map((i) => i.n)),
          }
        : null,
      copies: await agent.copies(),
      runs: await agent.runs(),
      active: await agent.active(),
      spend: {
        spent: await budget.spent(),
        cap: await budget.cap(),
        by_model: await budget.spendByModel(),
      },
      notifications: d.notifications ? "on" : "off",
    });
  });

  // The task set, chosen once from this library's work queue and its bundle saved.
  app.post(`${base}/agent/tasks`, async (c) => {
    const { d, spike, lib } = ready(c);
    const body = await c.req
      .json<{ replace?: boolean }>()
      .catch(() => ({}) as { replace?: boolean });
    const agent = spike.agent(lib.id);
    if ((await agent.taskSet()) && !body.replace) {
      throw new OkfError(409, "taskset_exists", "The task set is already chosen; pass replace.");
    }
    const queue = (await c.var.lib.work({ limit: 500 })).items;
    const saved = await saveBundle(d, c.var.lib);
    const set = buildTaskSet(queue, saved, new Date());
    await agent.saveTaskSet(set, !!body.replace);
    return c.json(set, 201);
  });

  // Run now: one arm, one model, one batch (the next one not yet done, unless named).
  app.post(`${base}/agent/runs`, async (c) => {
    const { d, spike, lib } = ready(c);
    const body = await c.req
      .json<{ arm?: string; model?: string; batch?: number }>()
      .catch(() => ({}) as { arm?: string; model?: string; batch?: number });
    const arm = body.arm === "a" || body.arm === "b" ? (body.arm as Arm) : null;
    if (!arm) throw new OkfError(400, "bad_arm", "`arm` is a (our loop) or b (Managed Agents).");
    const model = modelSpec(body.model ?? "");
    if (!model) {
      throw new OkfError(
        400,
        "bad_model",
        `\`model\` is one of ${MODELS.map((m) => m.id).join(", ")}.`,
      );
    }
    if (!model.arms.includes(arm)) {
      throw new OkfError(
        400,
        "bad_model",
        `${model.id} runs in arm ${model.arms.join(", ")} only.`,
      );
    }
    if (model.provider === "anthropic" && !(await spike.anthropic())) {
      throw new OkfError(503, "no_key", "No Anthropic key on this preview: the Claude arms skip.");
    }
    if (model.provider === "workers-ai" && !spike.ai) {
      throw new OkfError(503, "no_ai", "No Workers AI binding on this preview.");
    }
    const agent = spike.agent(lib.id);
    const set = await agent.taskSet();
    if (!set)
      throw new OkfError(409, "no_taskset", "Choose the task set first: POST …/agent/tasks.");
    await spike.agent(SPIKE_INSTANCE).remaining();
    const count = batches(set).length;
    const done = new Set(await agent.doneBatches(arm, model.id));
    const batch =
      body.batch ?? Array.from({ length: count }, (_, i) => i + 1).find((b) => !done.has(b));
    if (!batch || !Number.isInteger(batch) || batch < 1 || batch > count) {
      throw new OkfError(
        409,
        "no_batch",
        `Every batch of ${model.id} in arm ${arm} is done (1–${count}).`,
      );
    }
    const found = await d.accounts.library(lib.owner, lib.slug);
    if (!found) throw new OkfError(404, "no_library", "No such library.");
    const run = await agent.createRun(arm, model.id, batch);
    const params: RunParams = {
      base: { ...lib, ownerId: found.ownerId },
      run: run.id,
      arm,
      model: model.id,
      batch,
    };
    try {
      await agent.setWorkflow(run.id, await spike.start(params));
    } catch (e) {
      await agent.finishRun(run.id, "failed", e instanceof Error ? e.message : String(e));
      throw e;
    }
    return c.json(await agent.run(run.id), 202);
  });

  app.get(`${base}/agent/runs/:id`, async (c) => {
    const { spike, lib } = ready(c);
    const agent = spike.agent(lib.id);
    const id = Number(c.req.param("id"));
    const run = await agent.run(id);
    if (!run) throw new OkfError(404, "no_run", "No such run.");
    return c.json({ run, results: await agent.results(id), comments: await agent.comments(id) });
  });

  // Marks a stuck run stopped, so the library can run again (its Workflow is left to end).
  app.post(`${base}/agent/runs/:id/stop`, async (c) => {
    const { spike, lib } = ready(c);
    const agent = spike.agent(lib.id);
    const id = Number(c.req.param("id"));
    await agent.finishRun(id, "stopped", "stopped by the owner");
    return c.json(await agent.run(id));
  });

  // The spend cap for the whole spike; the parent session raises it.
  app.post(`${base}/agent/cap`, async (c) => {
    const { spike } = ready(c);
    const body = await c.req.json<{ usd?: number }>().catch(() => ({}) as { usd?: number });
    const budget = spike.agent(SPIKE_INSTANCE);
    await budget.setCap(Number(body.usd));
    return c.json({ spent: await budget.spent(), cap: await budget.cap() });
  });

  const html = (c: C, title: string, body: string) =>
    c.html(page(title, body), 200, { "Cache-Control": "no-store" });

  app.get(`${base}/agent/grading`, async (c) =>
    html(c, "Grade the librarian", gradingSheet(await sheetData(c), c.req.path)),
  );

  // The sheet posts back here: every field g_<key> names one response and its grade.
  app.post(`${base}/agent/grading`, async (c) => {
    const { spike, lib } = ready(c);
    const data = await sheetData(c);
    const form = await c.req.parseBody();
    const agent = spike.agent(lib.id);
    let saved = 0;
    for (const [name, value] of Object.entries(form)) {
      if (!name.startsWith("g_") || typeof value !== "string") continue;
      if (!GRADES.includes(value as Grade)) continue;
      const cand = byKey(data, name.slice(2));
      if (!cand) continue;
      await agent.grade(cand.run, cand.item, value as Grade);
      saved++;
    }
    return html(c, "Grade the librarian", gradingSheet(await sheetData(c), c.req.path, saved));
  });

  app.get(`${base}/agent/results`, async (c) => {
    const { spike, lib } = ready(c);
    const data = await sheetData(c);
    const budget = spike.agent(SPIKE_INSTANCE);
    const spent = await budget.spent();
    const cap = await budget.cap();
    if ((c.req.header("Accept") ?? "").includes("text/html")) {
      const copies = await spike.agent(lib.id).copies();
      return html(c, "Librarian spike results", reportPage(data, { spent, cap, copies }));
    }
    return c.json({ spent, cap, rows: resultsTable(data), runs: data.runs });
  });
}
