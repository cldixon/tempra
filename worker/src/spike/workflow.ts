import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { depsFor } from "../index";
import { OkfError } from "../store/errors";
import { MAX_NEW_THREADS } from "./models";
import {
  finishItemB,
  prepareRun,
  type RunDeps,
  type RunParams,
  runItemA,
  startItemB,
  waitItemB,
} from "./runner";
import { batches } from "./tasks";

/** A model call can be slow; an item's step may take this long before the Workflow retries it. */
const ITEM = {
  retries: { limit: 1, delay: "10 seconds", backoff: "constant" },
  timeout: "15 minutes",
} as const;
const QUICK = { retries: { limit: 3, delay: "5 seconds", backoff: "exponential" } } as const;

/** Arm B waits on a session in slices this long, up to WAITS of them (about 17 minutes). */
const WAIT_MS = 50_000;
const WAITS = 20;

/**
 * One run of the spike (TEMPRA-67): a Workflow per run, one step per item (Arm A runs the item's
 * whole model loop in its step; Arm B starts a session, waits on it in slices, then records it).
 * State lives in the library agent's object; the steps only move it forward.
 */
export class AgentRun extends WorkflowEntrypoint<Env, RunParams> {
  override async run(event: WorkflowEvent<RunParams>, step: WorkflowStep) {
    const p = event.payload;
    const d = depsFor(this.env) as RunDeps;
    if (!d.spike) throw new Error("The agent spike is not bound on this Worker.");
    const agent = d.spike.agent(p.base.id);
    try {
      const set = await step.do("start", QUICK, async () => {
        await agent.startRun(p.run);
        const s = await agent.taskSet();
        if (!s) throw new OkfError(409, "no_taskset", "No task set.");
        return s;
      });
      const copy = await step.do("prepare", QUICK, () => prepareRun(d, p, set));
      const items = batches(set)[p.batch - 1] ?? [];
      let stopped: string | null = null;
      for (const item of items) {
        const capped = await step.do(`begin ${item.n}`, QUICK, async () => {
          const run = await agent.run(p.run);
          await agent.beginItem(p.run, item.n);
          return item.kind !== "question" && (run?.threads ?? 0) >= MAX_NEW_THREADS;
        });
        if (capped || stopped) {
          await step.do(`skip ${item.n}`, QUICK, () =>
            agent.endItem(p.run, item.n, {
              status: "skipped",
              retries: 0,
              failures: 0,
              latency_ms: 0,
              error: stopped ?? "the run's thread cap was reached",
            }),
          );
          continue;
        }
        if (p.arm === "a") {
          stopped = await step.do(`item ${item.n}`, ITEM, async () => {
            try {
              await agent.endItem(p.run, item.n, await runItemA(d, p, copy, item));
              return null;
            } catch (e) {
              if (!(e instanceof OkfError && e.code === "spend_cap")) throw e;
              await agent.endItem(p.run, item.n, {
                status: "failed",
                retries: 0,
                failures: 0,
                latency_ms: 0,
                error: e.message,
              });
              return e.message;
            }
          });
          continue;
        }
        const started = await step.do(`session ${item.n}`, QUICK, async () => {
          try {
            return { at: Date.now(), session: await startItemB(d, p, copy, item), error: null };
          } catch (e) {
            if (!(e instanceof OkfError && e.code === "spend_cap")) throw e;
            return { at: Date.now(), session: null, error: e.message };
          }
        });
        if (!started.session) {
          stopped = started.error;
          await step.do(`stop ${item.n}`, QUICK, () =>
            agent.endItem(p.run, item.n, {
              status: "failed",
              retries: 0,
              failures: 0,
              latency_ms: 0,
              error: started.error,
            }),
          );
          continue;
        }
        const session = started.session;
        let done = false;
        for (let k = 0; k < WAITS && !done; k++) {
          done = await step.do(`wait ${item.n}.${k}`, QUICK, () => waitItemB(d, session, WAIT_MS));
        }
        await step.do(`record ${item.n}`, QUICK, async () => {
          await agent.endItem(
            p.run,
            item.n,
            await finishItemB(d, p, item, session, started.at, !done),
          );
        });
      }
      await step.do("finish", QUICK, () =>
        agent.finishRun(p.run, stopped ? "stopped" : "done", stopped ?? undefined),
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await step.do("fail", QUICK, () => agent.finishRun(p.run, "failed", message.slice(0, 500)));
    }
  }
}
