/**
 * Cold loads of a concept page in Chromium against a fresh `cf dev` (the Svelte port's before
 * and after numbers): each run a new browser context (empty cache), timed from navigation to the
 * reader's first block, with the bytes of script the page fetched.
 *
 *   bun scripts/coldload.ts [--runs 5] [--port 8798]
 */
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright-core";
import { writeTar } from "../src/util/tar";
import { loadBundle } from "../test/fixtures";
import { WORKER_DIR } from "./cf";
import { seed } from "./seed";

const { values } = parseArgs({
  options: {
    runs: { type: "string" },
    port: { type: "string" },
    path: { type: "string" },
    selector: { type: "string" },
  },
});
const runs = Number(values.runs ?? 5);
const port = Number(values.port ?? 8798);
const base = `http://127.0.0.1:${port}`;

mkdirSync(join(WORKER_DIR, ".gate"), { recursive: true });
const project = mkdtempSync(join(WORKER_DIR, ".gate", "cold-"));
for (const f of ["cloudflare.config.ts", "wrangler.config.ts", "package.json", "tsconfig.json"])
  copyFileSync(join(WORKER_DIR, f), join(project, f));
for (const d of ["src", "migrations", "node_modules"])
  symlinkSync(join(WORKER_DIR, d), join(project, d));
writeFileSync(join(project, ".dev.vars"), "DEV_SIGNIN=1\nSIGNUP=open\n");
const state = join(project, ".wrangler/state");
const t = await seed({ slug: "acme-retail", persistTo: state });

const dev = Bun.spawn(["bunx", "cf", "dev", "--port", String(port)], {
  detached: true,
  cwd: project,
  env: { ...process.env, CF_SEND_TELEMETRY: "false", CI: "1" },
  stdout: "ignore",
  stderr: "ignore",
});
try {
  for (let i = 0; ; i++) {
    if (i > 120) throw new Error("cf dev did not start");
    if (
      await fetch(`${base}/healthz`).then(
        (r) => r.ok,
        () => false,
      )
    )
      break;
    await Bun.sleep(500);
  }
  const lib = `${base}/api/v1/libraries/${t.owner}/${t.slug}`;
  const imp = await fetch(`${lib}/import?source=fixtures/acme_retail`, {
    method: "POST",
    headers: { Authorization: `Bearer ${t.token}`, "Content-Type": "application/x-tar" },
    body: writeTar(loadBundle("acme_retail")),
  });
  if (!imp.ok) throw new Error(`import: ${imp.status}`);
  const asked = await fetch(`${base}/sign-in`, {
    method: "POST",
    headers: { Origin: base },
    body: new URLSearchParams({ email: "dev@localhost", next: "/" }),
  });
  const token = /[?&]t=([0-9a-f]{64})/.exec((await asked.text()).replace(/&#38;/g, "&"))?.[1];
  const done = await fetch(`${base}/sign-in/link`, {
    method: "POST",
    headers: { Origin: base },
    body: new URLSearchParams({ t: token ?? "", next: "/" }),
    redirect: "manual",
  });
  const cookie = done.headers.get("Set-Cookie")?.split(";")[0] ?? "";
  const path = values.path ?? "tables/orders.md";
  const url = `${base}/${t.owner}/${t.slug}/${path}`;
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium",
  });
  const times: number[] = [];
  for (let i = 0; i <= runs; i++) {
    const context = await browser.newContext({ extraHTTPHeaders: { Cookie: cookie } });
    const page = await context.newPage();
    await page.addInitScript(() => {
      const w = window as unknown as { __drawn?: number; __lcp?: number; __fcp?: number };
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) w.__lcp = e.startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) if (e.name === "first-contentful-paint") w.__fcp = e.startTime;
      }).observe({ type: "paint", buffered: true });
      new MutationObserver((_, o) => {
        if (document.querySelector(".prose [data-block]")) {
          w.__drawn = performance.now();
          o.disconnect();
        }
      }).observe(document, { childList: true, subtree: true });
    });
    let script = 0;
    const csp: string[] = [];
    page.on("console", (m) => {
      if (/Content Security Policy|Refused to/.test(m.text()) || m.type() === "error")
        csp.push(m.text());
    });
    page.on("response", async (r) => {
      if (r.request().resourceType() === "script") script += (await r.body()).length;
    });
    const cdp = process.env.PROFILE && i === 1 ? await context.newCDPSession(page) : null;
    if (cdp) {
      await cdp.send("Profiler.enable");
      await cdp.send("Profiler.setSamplingInterval", { interval: 100 });
      await cdp.send("Profiler.start");
    }
    const start = Date.now();
    await page.goto(url);
    await page.waitForSelector(values.selector ?? ".prose [data-block]", { timeout: 20_000 });
    if (process.env.TIMELINE) await page.waitForTimeout(1000);
    const ms = Date.now() - start;
    const t = await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
      const res = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
      const js = res.find((r) => r.name.includes("/_app/app."));
      const api = res.filter((r) => r.name.includes("/api/"));
      return {
        doc: Math.round(nav.responseEnd),
        js: Math.round(js?.responseEnd ?? 0),
        dcl: Math.round(nav.domContentLoadedEventEnd),
        api: api.map((r) => `${new URL(r.name).pathname.split("/").slice(-1)[0]}@${Math.round(r.startTime)}-${Math.round(r.responseEnd)}`).join(" "),
        drawn: Math.round((window as unknown as { __drawn?: number }).__drawn ?? -1),
        fcp: Math.round((window as unknown as { __fcp?: number }).__fcp ?? -1),
        lcp: Math.round((window as unknown as { __lcp?: number }).__lcp ?? -1),
      };
    });
    if (process.env.TIMELINE) console.log(JSON.stringify(t));
    if (cdp) {
      const { profile } = (await cdp.send("Profiler.stop")) as {
        profile: { nodes: { id: number; callFrame: { functionName: string; url: string; lineNumber: number }; hitCount: number }[]; samples: number[]; timeDeltas: number[] };
      };
      const self = new Map<string, number>();
      const byId = new Map(profile.nodes.map((n) => [n.id, n]));
      profile.samples.forEach((id, k) => {
        const n = byId.get(id);
        if (!n) return;
        const f = n.callFrame;
        const key = `${f.functionName || "(anon)"} ${f.url.split("/").pop()}:${f.lineNumber}`;
        self.set(key, (self.get(key) ?? 0) + (profile.timeDeltas[k] ?? 0));
      });
      const top = [...self].sort((a, b) => b[1] - a[1]).slice(0, 30);
      for (const [k, us] of top) console.log(`${(us / 1000).toFixed(1).padStart(7)} ms  ${k}`);
    }
    // The first run warms cf dev (its first request compiles the Worker); it is not counted.
    if (i > 0) times.push(ms);
    if (i === 0 && values.selector) console.log(await page.content());
    console.log(
      `${i === 0 ? "warm-up" : `run ${i}`}: ${ms} ms, ${(script / 1024).toFixed(0)} KB of script${csp.length ? `, CSP: ${csp.join(" | ")}` : ""}`,
    );
    await context.close();
  }
  times.sort((a, b) => a - b);
  console.log(
    `median ${times[Math.floor(times.length / 2)]} ms, min ${times[0]} ms, max ${times.at(-1)} ms`,
  );
  await browser.close();
} finally {
  try {
    process.kill(-dev.pid, "SIGKILL");
  } catch {}
  rmSync(project, { recursive: true, force: true });
}
