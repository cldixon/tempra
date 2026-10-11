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
