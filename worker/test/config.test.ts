import { describe, expect, test } from "bun:test";
import config, { previewDeployment } from "../cloudflare.config";

/** The metering and rate-limit bindings one deployment gets from cloudflare.config.ts. */
async function counters(mode: string) {
  const worker = (await (
    await config({ isPreview: false, mode } as never)
  ).worker) as {
    env: Record<string, { name?: string; namespace?: string }>;
  };
  return {
    usage: worker.env.USAGE?.name,
    write: worker.env.WRITE_LIMITER?.namespace,
    request: worker.env.REQUEST_LIMITER?.namespace,
  };
}

// TEMPRA-76: staging metered into production's dataset and shared its limiter namespaces.
describe("each deployment meters and rate-limits on its own", () => {
  test("production is unchanged", async () => {
    expect(await counters("production")).toEqual({
      usage: "tempra_usage",
      write: "1001",
      request: "1002",
    });
  });

  test("staging and previews share nothing with production or each other", async () => {
    const all = [
      await counters("production"),
      await counters("staging"),
      // The preview mode reads its ids from the environment; the deployment itself is the same.
      (({ usage, limiters }) => ({ usage, write: limiters?.write, request: limiters?.request }))(
        previewDeployment("7"),
      ),
    ];
    for (const key of ["usage", "write", "request"] as const) {
      const values = all.map((c) => c[key]);
      expect(new Set(values).size).toBe(values.length);
    }
    expect(all[1]?.usage).toBe("tempra_usage_staging");
  });
});

// TEMPRA-67: the agent spike is bound on previews only.
describe("the agent spike", () => {
  const bound = async (mode: string, extra: Record<string, string> = {}) => {
    const env = (globalThis as { process: { env: Record<string, string | undefined> } }).process
      .env;
    const saved = { ...env };
    Object.assign(env, extra);
    try {
      const c = await config({ isPreview: false, mode } as never);
      const worker = (await c.worker) as {
        env: Record<string, unknown>;
        exports: Record<string, unknown>;
      };
      return {
        env: ["AGENT_SPIKE", "LIBRARY_AGENT", "AGENT_RUN", "AI"].filter((k) => k in worker.env),
        exports: Object.keys(worker.exports).sort(),
      };
    } finally {
      for (const k of Object.keys(extra)) if (saved[k] === undefined) delete env[k];
    }
  };

  test("production and staging do not have it", async () => {
    for (const mode of ["production", "staging"]) {
      expect(await bound(mode)).toEqual({ env: [], exports: ["Library"] });
    }
  });

  test("a preview does", async () => {
    expect(
      await bound("preview", {
        TEMPRA_PR: "7",
        TEMPRA_PREVIEW_D1_ID: "d1",
        TEMPRA_PREVIEW_KV_ID: "kv",
      }),
    ).toEqual({
      env: ["AGENT_SPIKE", "LIBRARY_AGENT", "AGENT_RUN", "AI"],
      exports: ["AgentRun", "Library", "LibraryAgent"],
    });
  });
});
