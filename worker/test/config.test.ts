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
    session: worker.env.SESSION_LIMITER?.namespace,
  };
}

// TEMPRA-76: staging metered into production's dataset and shared its limiter namespaces.
describe("each deployment meters and rate-limits on its own", () => {
  test("production is unchanged", async () => {
    expect(await counters("production")).toEqual({
      usage: "tempra_usage",
      write: "1001",
      request: "1002",
      session: "1003",
    });
  });

  test("staging and previews share nothing with production or each other", async () => {
    const all = [
      await counters("production"),
      await counters("staging"),
      // The preview mode reads its ids from the environment; the deployment itself is the same.
      (({ usage, limiters }) => ({
        usage,
        write: limiters?.write,
        request: limiters?.request,
        session: limiters?.session,
      }))(previewDeployment("7")),
    ];
    for (const key of ["usage", "write", "request", "session"] as const) {
      const values = all.map((c) => c[key]);
      expect(new Set(values).size).toBe(values.length);
    }
    // No namespace is used twice anywhere, within a deployment or across them.
    const namespaces = all.flatMap((c) => [c.write, c.request, c.session]);
    expect(namespaces.every(Boolean)).toBe(true);
    expect(new Set(namespaces).size).toBe(namespaces.length);
    expect(all[1]?.usage).toBe("tempra_usage_staging");
  });
});

// TEMPRA-81: the blob sweep's queue, sent to and consumed by the same Worker, one per deployment.
describe("each deployment has its own sweep queue", () => {
  async function sweepQueue(mode: string) {
    const worker = (await (
      await config({ isPreview: false, mode } as never)
    ).worker) as {
      env: Record<string, { name?: string }>;
      triggers: { type: string; name?: string }[];
    };
    return {
      producer: worker.env.SWEEP_QUEUE?.name,
      consumer: worker.triggers.find((t) => t.type === "queue")?.name,
    };
  }

  test("production, staging and previews", async () => {
    expect(await sweepQueue("production")).toEqual({
      producer: "tempra-sweep",
      consumer: "tempra-sweep",
    });
    expect(await sweepQueue("staging")).toEqual({
      producer: "tempra-sweep-staging",
      consumer: "tempra-sweep-staging",
    });
    expect(previewDeployment("7").queue).toBe("tempra-sweep-pr-7");
  });
});

// TEMPRA-125: the landing page asks people to Request access while production is invite-only.
describe("the landing page's calls to action match production's SIGNUP", () => {
  test("invite in production: Request access and Sign in, never Sign up", async () => {
    const worker = (await (
      await config({ isPreview: false, mode: "production" } as never)
    ).worker) as { env: Record<string, unknown> };
    expect(JSON.stringify(worker.env.SIGNUP)).toContain("invite");
    const site = new URL("../../site/src/", import.meta.url);
    const file = (p: string) => Bun.file(new URL(p, site));
    if (!(await file("pages/index.astro").exists())) return; // worker/ built on its own
    for (const page of ["pages/index.astro", "layouts/Base.astro"]) {
      const text = await file(page).text();
      expect(text).toContain("/request-access");
      expect(text).toContain("/sign-in");
      expect(text).not.toMatch(/Sign up|Get started/);
    }
  });
});
