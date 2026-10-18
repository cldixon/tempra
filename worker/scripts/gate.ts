/**
 * `bun run gate`: the Phase 1 gate against `cf dev` (spec: Phase 1 in detail, Gate), plus
 * the MCP smoke flow on a fresh, empty library.
 *
 * Starts the Worker with fresh local D1, R2 and DO state, seeds one library and write token per
 * sample bundle, imports each bundle as a tarball, exports it, and compares: same parsed
 * frontmatter (generated and verified included) and bodies, byte-identical attachments,
 * synthesized index.md and log.md ignored. Then checks every concept and directory of each bundle
 * is the app's page and renders through the API (signed in by a dev magic link), drives the app in
 * Chromium (playwright-core; CHROME_PATH picks the binary), runs the nightly export through the Durable
 * Object into local R2, signs up a second user who must not see the first one's libraries
 * (v2 spec: Phases and gates, A1), has a fresh account sign up, connect over OAuth and write
 * (A2), and has three scripted agents work on one library at once (scripts/agents.ts), every
 * write reaching the change feed. Exits non-zero on any mismatch.
 *
 *   bun run gate [--port 8799] [--keep]
 */
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { type Browser, chromium } from "playwright-core";
import { readTar, writeTar } from "../src/util/tar";
import { compareBundle } from "../test/compare";
import { BUNDLES, loadBundle } from "../test/fixtures";
import { formatReport, runAgents } from "./agents";
import { WORKER_DIR } from "./cf";
import { mcpSmoke } from "./mcp-smoke";
import { seed } from "./seed";

const { values } = parseArgs({
  options: { port: { type: "string" }, keep: { type: "boolean" } },
});
const port = Number(values.port ?? 8799);
const base = `http://127.0.0.1:${port}`;

/**
 * `cf dev` keeps local state in .wrangler/state beside cloudflare.config.ts and takes no state
 * directory, so the gate runs it from a throwaway project under worker/.gate/: the config files
 * copied, src/, migrations/ and node_modules/ linked, and a .dev.vars with DEV_SIGNIN=1 so
 * sign-in links are shown on the page (on loopback only) instead of mailed.
 */
mkdirSync(join(WORKER_DIR, ".gate"), { recursive: true });
const project = mkdtempSync(join(WORKER_DIR, ".gate", "run-"));
for (const f of ["cloudflare.config.ts", "wrangler.config.ts", "package.json", "tsconfig.json"]) {
  copyFileSync(join(WORKER_DIR, f), join(project, f));
}
for (const d of ["src", "migrations", "node_modules"]) {
  symlinkSync(join(WORKER_DIR, d), join(project, d));
}
writeFileSync(join(project, ".dev.vars"), "DEV_SIGNIN=1\nSIGNUP=open\n");
const state = join(project, ".wrangler/state");

console.log(`project: ${project}`);
const tokens: ({ bundle: string } & Awaited<ReturnType<typeof seed>>)[] = [];
for (const b of BUNDLES) {
  tokens.push({ bundle: b, ...(await seed({ slug: b.replace(/_/g, "-"), persistTo: state })) });
}
const mcpToken = (await seed({ slug: "mcp", actor: "claude-code/gate", persistTo: state })).token;
// Scripted agents (scripts/agents.ts): three tokens on one library, one actor each.
const agentTokens = [];
for (let i = 1; i <= 3; i++) {
  agentTokens.push(
    await seed({ slug: "agents", actor: `claude-code/agent-${i}`, persistTo: state }),
  );
}

// Its own process group, so stopping it stops wrangler and workerd beneath it too (they share
// its stderr, which ends only when all of them have).
const dev = Bun.spawn(["bunx", "cf", "dev", "--port", String(port)], {
  detached: true,
  cwd: project,
  env: { ...process.env, CF_SEND_TELEMETRY: "false", CI: "1" },
  stdout: "pipe",
  stderr: "pipe",
});
/**
 * cf dev's output, read as it comes so a full pipe can never stall it: the last 64 KB of each
 * stream kept for a failure, and all of it in GATE_LOGS/cf-dev.log.
 */
const devTail = { stdout: "", stderr: "" };
async function drain(name: "stdout" | "stderr", stream: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder();
  for await (const chunk of stream) {
    const text = decoder.decode(chunk, { stream: true });
    devTail[name] = (devTail[name] + text).slice(-65_536);
    if (process.env.GATE_LOGS) appendFileSync(join(process.env.GATE_LOGS, "cf-dev.log"), text);
  }
}
const drained = Promise.all([drain("stdout", dev.stdout), drain("stderr", dev.stderr)]).catch(
  () => {},
);
function stopDev() {
  try {
    process.kill(-dev.pid, "SIGKILL");
  } catch {
    // Already gone.
  }
}

async function waitForHealth() {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${base}/healthz`);
      if (r.ok) return;
    } catch {}
    await Bun.sleep(500);
  }
  throw new Error("cf dev did not become healthy");
}

/** Signs in by a dev magic link (DEV_SIGNIN=1 shows it on the page); returns the session cookie. */
async function signIn(email: string): Promise<string> {
  const asked = await fetch(`${base}/sign-in`, {
    method: "POST",
    headers: { Origin: base },
    body: new URLSearchParams({ email, next: "/" }),
  });
  const html = await asked.text();
  const t = /[?&]t=([0-9a-f]{64})/.exec(html.replace(/&#38;/g, "&"))?.[1];
  if (!t) throw new Error(`sign-in for ${email}: ${asked.status} ${html.slice(0, 300)}`);
  const done = await fetch(`${base}/sign-in/link`, {
    method: "POST",
    headers: { Origin: base },
    body: new URLSearchParams({ t, next: "/" }),
    redirect: "manual",
  });
  const cookie = done.headers.get("Set-Cookie")?.split(";")[0];
  if (done.status !== 303 || !cookie) throw new Error(`sign-in link for ${email}: ${done.status}`);
  return cookie;
}

/** The seeded user's session, set once the Worker is up. */
let devCookie = "";

/** A UI request as the seeded user; a redirect (e.g. to sign-in) is not followed. */
function ui(url: string, init: RequestInit = {}, cookie = devCookie) {
  const headers = new Headers(init.headers);
  headers.set("Cookie", cookie);
  return fetch(url, { ...init, headers, redirect: "manual" });
}

/** A JSON call to the REST API as a signed-in person (the app's own calls). */
function apiAs(cookie: string, path: string, method = "GET", body?: unknown) {
  return ui(
    `${base}${path}`,
    {
      method,
      headers: { Origin: base, Accept: "application/json", "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    cookie,
  );
}

/**
 * Every page of a library is the app's shell at its URL (TEMPRA-9), and every file reads through
 * the API as the app reads it (GET …/files/{path} as JSON), as the signed-in person.
 */
async function uiPages(owner: string, slug: string, paths: string[]): Promise<string[]> {
  const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");
  const lib = `${base}/${owner}/${slug}`;
  const api = `${base}/api/v1/libraries/${owner}/${slug}`;
  const concepts = paths.filter((p) => p.endsWith(".md") && !/(^|\/)(index|log)\.md$/.test(p));
  const dirs = new Set<string>();
  for (const p of paths) {
    const parts = p.split("/").slice(0, -1);
    for (let i = 1; i <= parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
  }
  const pages = [
    `${lib}/`,
    `${lib}/-/ledger`,
    ...["work", "transfer", "recovery", "connect", "delete"].map((p) => `${lib}/-/${p}`),
    ...[...dirs].map((d) => `${lib}/${enc(d)}/`),
    ...concepts.map((p) => `${lib}/${enc(p)}`),
  ];
  const problems: string[] = [];
  for (const url of pages) {
    const r = await ui(url);
    const html = await r.text();
    if (r.status !== 200 || !html.includes('<div id="root"></div>')) {
      problems.push(`${url.slice(base.length)}: ${r.status} ${html.slice(0, 200)}`);
    }
  }
  for (const p of [...concepts, "index.md", "log.md"]) {
    const r = await ui(`${api}/files/${enc(p)}`, { headers: { Accept: "application/json" } });
    const body = (await r.json().catch(() => null)) as { kind?: string } | null;
    if (r.status !== 200 || !body?.kind) {
      problems.push(`files ${p}: ${r.status} ${JSON.stringify(body).slice(0, 200)}`);
    }
  }
  return problems;
}

/** A Chromium for the browser step: CHROME_PATH, the container's Playwright build, or Chrome. */
function chromiumPath(): string | null {
  const candidates = [
    process.env.CHROME_PATH,
    "/opt/pw-browsers/chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ];
  return candidates.find((p): p is string => !!p && existsSync(p)) ?? null;
}

/** The longest one browser step may take before it is reported as hung. */
const STEP_MS = 90_000;

/** Resolves with `work`, or rejects once `ms` pass, naming what took too long. */
class NoAnswer extends Error {}

function within<T>(ms: number, what: string, work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new NoAnswer(`${what}: no answer in ${ms / 1000} s`)), ms);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

/**
 * GATE_LOGS=<dir>: what a failed run leaves for diagnosis (CI uploads it). cf dev's output
 * (cf-dev.log), and per browser N: Chrome's own log (chrome-N.log), a Playwright trace of its
 * actions, network and console (trace-N.zip, kept only when a step failed) and, when the browser
 * stops answering, the page's state at that moment (stuck-N.txt, also printed).
 */
const LOGS = process.env.GATE_LOGS;
let browsers = 0;
/** How long one Chrome launch may take; playwright's default is 180 s. */
const LAUNCH_TIMEOUT_MS = 30_000;

/** At most `n` characters of `s`, on one line. */
const clip = (s: string, n = 160) => s.replace(/\s+/g, " ").slice(0, n);

/** Chrome's processes (state, CPU, memory, what each waits in): a busy renderer or a blocked one. */
function chromeProcesses(exe: string): string[] {
  const ps = Bun.spawnSync(["ps", "-eo", "pid,ppid,stat,pcpu,rss,etime,wchan:24,args"]);
  const lines = ps.stdout.toString().split("\n");
  return [lines[0] ?? "", ...lines.filter((l) => l.includes(exe))].map((l) => clip(l, 200));
}

/**
 * Chromium with one page that records every failed response, console error and page error as a
 * problem; `step` runs a part of a check and records its failure without stopping the rest.
 */
async function openBrowser() {
  const executablePath = chromiumPath();
  if (!executablePath) return "no Chromium found; set CHROME_PATH";
  const n = ++browsers;
  /** Chrome's own log, written by Chrome: crashes, GPU, sandbox, IPC and network errors. */
  const chromeLog = LOGS ? join(LOGS, `chrome-${n}.log`) : null;
  const launch = () =>
    chromium.launch({
      executablePath,
      args: chromeLog ? ["--enable-logging", `--log-file=${chromeLog}`, "--v=0"] : [],
      timeout: LAUNCH_TIMEOUT_MS,
    });
  // Chrome now and then fails to start on CI runners (spawn ENOENT, then a launch that never
  // answers; run 38174138102). A launch that fails is tried once more: playwright gives each
  // launch a fresh profile dir of its own, and the first attempt's Chrome log stays as
  // chrome-N-failed.log. Only the launch is retried; a step that fails later fails the gate.
  let browser: Browser;
  try {
    browser = await launch();
  } catch (e) {
    if (chromeLog && existsSync(chromeLog))
      renameSync(chromeLog, chromeLog.replace(/\.log$/, "-failed.log"));
    if (process.env.GATE_TRACE)
      console.log(`  [browser ${n}] launch failed, trying once more: ${clip(String(e), 400)}`);
    browser = await launch();
  }
  if (process.env.GATE_TRACE)
    console.log(`  [browser ${n}] ${executablePath} ${browser.version()}`);
  const context = await browser.newContext();
  // Actions, network and console; no screenshots or DOM snapshots, so the timing the checks
  // depend on stays as it was.
  if (LOGS) await context.tracing.start({ screenshots: false, snapshots: false });
  const page = await context.newPage();
  const problems: string[] = [];
  /** The page's recent life, for when it stops answering. */
  const recent: string[] = [];
  const note = (line: string) => {
    recent.push(`${new Date().toISOString()} ${clip(line)}`);
    if (recent.length > 40) recent.shift();
  };
  const pending = new Map<object, { what: string; since: number }>();
  const sockets = new Map<object, { url: string; since: number }>();
  // Failed requests are reported by URL below; the console only repeats them.
  page.on("console", (m) => {
    note(`console.${m.type()}: ${m.text()}`);
    if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) {
      problems.push(`console: ${m.text()}`);
    }
  });
  page.on("request", (r) =>
    pending.set(r, { what: `${r.method()} ${r.url().replace(base, "")}`, since: Date.now() }),
  );
  page.on("requestfinished", (r) => pending.delete(r));
  page.on("requestfailed", (r) => {
    pending.delete(r);
    note(`request failed: ${r.method()} ${r.url().replace(base, "")} ${r.failure()?.errorText}`);
  });
  page.on("websocket", (ws) => {
    sockets.set(ws, { url: ws.url(), since: Date.now() });
    ws.on("close", () => sockets.delete(ws));
  });
  page.on("framenavigated", (f) => {
    if (f === page.mainFrame()) note(`navigated: ${f.url().replace(base, "")}`);
  });
  page.on("crash", () => note("the page crashed"));
  // Handled here, so Playwright no longer dismisses dialogs itself: dismissed as it would, noted.
  page.on("dialog", (d) => {
    note(`dialog ${d.type()}: ${d.message()}`);
    d.dismiss().catch(() => {});
  });
  page.on("response", (r) => {
    const path = new URL(r.url()).pathname;
    if (r.status() >= 400 && path !== "/favicon.ico") {
      problems.push(`${r.status()} ${path}`);
    }
  });
  page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));

  /** What the browser and the page were doing when `what` got no answer; printed and kept. */
  const diagnose = async (what: string) => {
    const now = Date.now();
    const age = (since: number) => `${((now - since) / 1000).toFixed(1)} s`;
    // Whether the browser still answers outside the page tells a stuck renderer from a stuck
    // browser process (or a stuck connection to it).
    const targets = await within(
      10_000,
      "the browser's own CDP session",
      browser
        .newBrowserCDPSession()
        .then((s) => s.send("Target.getTargets"))
        .then((r) =>
          r.targetInfos.map((t) => `${t.type}${t.attached ? " attached" : ""} ${clip(t.url, 100)}`),
        ),
    ).catch((e) => [String(e)]);
    const lines = [
      `the browser stopped answering in "${what}" (browser ${n}, ${browser.version()})`,
      `page: ${page.url()}${page.isClosed() ? " (closed)" : ""}`,
      `requests in flight (${pending.size}):`,
      ...[...pending.values()].map((r) => `  ${r.what} for ${age(r.since)}`),
      `open WebSockets (${sockets.size}):`,
      ...[...sockets.values()].map((w) => `  ${w.url} for ${age(w.since)}`),
      "the browser's targets:",
      ...targets.map((t) => `  ${t}`),
      "Chrome's processes:",
      ...chromeProcesses(executablePath).map((l) => `  ${l}`),
      "the page's last events:",
      ...recent.map((l) => `  ${l}`),
    ];
    console.log(lines.map((l) => `  | ${l}`).join("\n"));
    if (LOGS) writeFileSync(join(LOGS, `stuck-${n}.txt`), `${lines.join("\n")}\n`);
  };

  let failures = 0;
  /** The step the browser stopped answering in; every later step is skipped, not waited out. */
  let stuck: string | null = null;
  const step = async (what: string, run: () => Promise<unknown>) => {
    if (stuck) {
      problems.push(`${what}: skipped, the browser stopped answering in "${stuck}"`);
      return;
    }
    const t0 = Date.now();
    if (process.env.GATE_TRACE) console.log(`  [step] ${what}`);
    try {
      // A step that hangs (a wait with no timeout of its own) fails by name rather than
      // silently using up the CI job's time.
      await within(STEP_MS, what, run());
    } catch (e) {
      failures++;
      problems.push(`${what}: ${String(e).split("\n")[0]}`);
      if (process.env.GATE_TRACE)
        console.log(`  [step failed after ${Date.now() - t0} ms] ${what}`);
      if (e instanceof NoAnswer) {
        stuck = what;
        await diagnose(what);
      }
      // GATE_SCREENSHOTS: what the page showed when the step failed (if it still answers).
      const shots = process.env.GATE_SCREENSHOTS;
      if (shots) {
        await within(
          10_000,
          "screenshot",
          page.screenshot({ path: `${shots}/failed-${n}-${failures}.png`, fullPage: true }),
        ).catch(() => {});
      }
    }
  };
  /**
   * Closes the browser, giving up after a while: on CI's Google Chrome a close has never
   * returned, after every check had run. A stuck close is diagnosed and reported, not waited on;
   * the gate exits explicitly and the runner reaps what is left. The trace is kept only when a
   * step failed.
   */
  const close = async () => {
    if (LOGS) {
      await within(
        20_000,
        "saving the trace",
        context.tracing.stop(failures > 0 ? { path: join(LOGS, `trace-${n}.zip`) } : {}),
      ).catch((e) => console.log(`  (note: ${String(e)})`));
    }
    try {
      await within(30_000, "closing the browser", browser.close());
    } catch (e) {
      console.log(`  (note: ${String(e)}; carrying on)`);
      if (!stuck) await diagnose("closing the browser");
    }
  };
  /** Signs in the way a person does: the email form, then the (dev, on-page) link. */
  const signInAs = async (email: string, next: string) => {
    await page.goto(`${base}/sign-in?next=${encodeURIComponent(next)}`);
    await page.locator('input[name="email"]').fill(email);
    await page.getByRole("button", { name: "Email me a link" }).click();
    const link = await page.locator('a[href*="/sign-in/link?t="]').first().getAttribute("href");
    await page.goto(new URL(link ?? "", base).href);
    await page.getByRole("button", { name: "Continue" }).click();
  };
  /** The session cookie, for requests made beside the browser. */
  const cookie = async () =>
    (await context.cookies())
      .filter((c) => c.name.includes("session"))
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");
  return { browser, context, page, problems, step, close, signInAs, cookie };
}

/**
 * The app in a real browser, signed in as the seeded user: the library page, every concept in the
 * reader (drawn from the stored tree, with no Edit, a footnote card on hover) and the ledger draw
 * from the API, links move within the app without reloading the page, and nothing is refused by
 * the CSP or throws. GATE_SCREENSHOTS=<dir> saves screenshots of concepts (desktop and phone
 * width), a card, a selection and a comment.
 */
async function browserRenders(
  owner: string,
  slug: string,
  concepts: string[],
  token: string,
): Promise<string[]> {
  const b = await openBrowser();
  if (typeof b === "string") return [b];
  const { page, step, problems } = b;
  try {
    const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");
    /** Opens one of the concept's panels from the cluster (take 2), unless it is open. */
    const panel = async (name: string) => {
      const button = page.locator(".cluster").getByRole("button", { name, exact: true });
      await button.waitFor({ timeout: 15_000 });
      if ((await button.getAttribute("aria-pressed")) !== "true") await button.click();
      await page
        .locator(".ws-panel .panel-head")
        .getByRole("heading", { level: 2, name, exact: true })
        .waitFor({ timeout: 10_000 });
    };
    /** Someone else's write: the cluster's glyph, then Show new version in its menu. */
    const newVersion = () => page.locator(".cluster").getByRole("button", { name: "New version" });
    const showNewVersion = async () => {
      await newVersion().click();
      await page.getByRole("button", { name: "Show new version" }).click();
    };

    await step("sign in", async () => {
      await b.signInAs("dev@localhost", `/${owner}/${slug}/`);
      await page.waitForURL(`${base}/${owner}/${slug}/`);
    });
    await step("library page", async () => {
      // No document is open: the sheet is blank.
      await page.locator(".empty").waitFor({ timeout: 15_000 });
    });
    // The workspace (TEMPRA-19): the tree stays while files open in the main pane.
    const nested = concepts.find((c) => c.includes("/")) ?? concepts[0] ?? "";
    const folder = nested.split("/").slice(0, -1).join("/");
    const sidebar = page.locator(".ws-sidebar");
    const lib = `${base}/${owner}/${slug}`;
    const bearer = { Authorization: `Bearer ${token}` };
    const libApi = `${base}/api/v1/libraries/${owner}/${slug}`;
    await step("workspace: open a file from the tree, the sidebar stays", async () => {
      await sidebar.getByRole("navigation", { name: "Files" }).waitFor({ timeout: 15_000 });
      await sidebar.evaluate((el) => {
        (el as unknown as { dataset: Record<string, string> }).dataset.gate = "kept";
      });
      if (folder) {
        // Opening a folder is instant: the tree has the whole index, so no request is made.
        let asked = 0;
        const count = (r: { url(): string }) => {
          if (/\/(tree|outline)(\?|$)/.test(new URL(r.url()).pathname)) asked++;
        };
        page.on("request", count);
        const name = folder.split("/").pop() ?? "";
        await sidebar.getByRole("button", { name, exact: true }).click();
        await sidebar.locator(`a[title="${nested}"]`).waitFor({ timeout: 1000 });
        page.off("request", count);
        if (asked > 0) throw new Error(`opening a folder made ${asked} request(s)`);
      }
      await sidebar.locator(`a[title="${nested}"]`).click();
      await page.waitForURL(`${lib}/${enc(nested)}`);
      await page.locator(".body .prose").waitFor({ timeout: 15_000 });
      if ((await sidebar.locator(`a[aria-current="page"][title="${nested}"]`).count()) !== 1) {
        throw new Error("the open file is not marked in the tree");
      }
      // The concept's panels: one at a time, from the cluster.
      await panel("History");
      await page.goBack();
      await page.waitForURL(`${lib}/`);
      await page.locator(".empty").waitFor();
      await page.goForward();
      await page.waitForURL(`${lib}/${enc(nested)}`);
      // A page seen before draws from the cache: no loading state on the way back.
      if ((await page.getByText("Loading…").count()) > 0) {
        throw new Error("a page seen before showed Loading… again");
      }
      await page.locator(".body .prose").waitFor({ timeout: 1000 });
      if ((await page.locator('.ws-sidebar[data-gate="kept"]').count()) !== 1) {
        throw new Error("the sidebar was rebuilt (the page reloaded or the frame remounted)");
      }
    });
    await step(
      "workspace: hover prefetches, new pages start at the top, back restores",
      async () => {
        const other = concepts.find(
          (c) => c !== nested && c.split("/").slice(0, -1).join("/") === folder,
        );
        if (!other) throw new Error(`no second concept in ${folder}/ to move to`);
        const main = page.locator(".ws-main");
        await page.locator(".body .prose").waitFor({ timeout: 15_000 });
        await main.evaluate((el) => {
          el.scrollTop = 300;
        });
        const before = await main.evaluate((el) => el.scrollTop);
        const title = await main.locator("h1").first().innerText();
        const link = sidebar.locator(`a[title="${other}"]`);
        await link.hover();
        await page.waitForTimeout(1500); // the hover's prefetch lands in the cache
        await link.click();
        await page.waitForURL(`${lib}/${enc(other)}`);
        // The URL changes before React draws the new page: wait for the page itself (on a
        // slow runner the old one can still be on screen, scrolled, when the URL has moved).
        // (A locator, not waitForFunction: the app's CSP refuses string evaluation.)
        const exact = new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
        await main
          .locator("h1", { hasNotText: exact })
          .or(main.getByText("Loading…"))
          .first()
          .waitFor({ timeout: 5000 });
        if ((await page.getByText("Loading…").count()) > 0) {
          throw new Error("a hovered file still showed Loading… when opened");
        }
        if ((await main.evaluate((el) => el.scrollTop)) !== 0) {
          throw new Error("the new page did not start at the top");
        }
        await page.goBack();
        await page.waitForURL(`${lib}/${enc(nested)}`);
        const after = await main.evaluate((el) => el.scrollTop);
        if (Math.abs(after - before) > 2) {
          throw new Error(`back returned to ${after}px, not ${before}px`);
        }
      },
    );
    await step("workspace: the tree follows an agent's write and move, live", async () => {
      const put = await fetch(`${libApi}/files/gate-live.md`, {
        method: "PUT",
        headers: { ...bearer, "Content-Type": "text/markdown", "X-Note": "gate: tree" },
        body: "---\ntype: Note\ntitle: Gate live\ndescription: Written while the tree was open.\n---\nLive.\n",
      });
      if (!put.ok) throw new Error(`write: ${put.status}`);
      const row = sidebar.locator('a[title="gate-live.md"]');
      await row.waitFor({ timeout: 5000 });
      if ((await sidebar.locator('.tree-mark[title*="changed this just now"]').count()) === 0) {
        throw new Error("no activity mark on the agent's file");
      }
      // Named for its person, not by the raw actor (TEMPRA-77): "… for @dev changed this".
      await sidebar
        .locator('.tree-mark[title*=" for @"][title*="changed this just now"]')
        .first()
        .waitFor({ timeout: 5000 });
      const target = folder ? `${folder}/gate-live.md` : "moved/gate-live.md";
      const moved = await fetch(`${libApi}/files/gate-live.md/move`, {
        method: "POST",
        headers: { ...bearer, "Content-Type": "application/json" },
        body: JSON.stringify({ to: target, note: "gate: tree move" }),
      });
      if (!moved.ok) throw new Error(`move: ${moved.status}`);
      await row.waitFor({ state: "detached", timeout: 5000 });
      if (folder) await sidebar.locator(`a[title="${target}"]`).waitFor({ timeout: 5000 });
      await fetch(`${libApi}/files/${enc(target)}`, { method: "DELETE", headers: bearer });
    });
    await step("workspace: the quick switcher opens a concept", async () => {
      const first = concepts[0] ?? "";
      const meta = (await (
        await fetch(`${libApi}/files/${enc(first)}`, {
          headers: { ...bearer, Accept: "application/json" },
        })
      ).json()) as { frontmatter?: { title?: string } };
      const word = String(meta.frontmatter?.title ?? "").split(/\s+/)[0] ?? "";
      const dialog = page.getByRole("dialog", { name: "Open a file" });
      const box = dialog.getByRole("combobox");
      // It closes every way a person tries: Escape, the same keys, a click outside.
      const closes = async (how: string, close: () => Promise<void>) => {
        await page.keyboard.press("Control+k");
        await box.waitFor({ timeout: 5000 }).catch(() => {
          throw new Error(`the switcher did not open (before ${how})`);
        });
        await close();
        await dialog.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {
          throw new Error(`the switcher did not close with ${how}`);
        });
      };
      await closes("Escape", () => box.press("Escape"));
      await closes("the same keys", () => page.keyboard.press("Control+k"));
      await closes("a click outside", () => page.mouse.click(5, 5));
      await page.keyboard.press("Control+k");
      await box.fill(word);
      const option = page.locator('.switcher [role="option"]', { hasText: first }).first();
      await option.waitFor({ timeout: 5000 });
      await box.press("ArrowDown");
      await box.press("ArrowUp");
      // The hit for the first concept, wherever it ranks.
      await option.click();
      await page.waitForURL(`${lib}/${enc(first)}`);
    });
    await step("workspace: at phone width the tree is a drawer", async () => {
      await page.setViewportSize({ width: 420, height: 800 });
      if (await sidebar.isVisible()) throw new Error("the sidebar shows at phone width");
      const files = page.getByRole("button", { name: "Files" });
      await files.click();
      await sidebar.waitFor({ state: "visible" });
      // The drawer sits below the header: its button stays in reach, and Escape closes it.
      if (!(await files.isVisible())) throw new Error("the drawer covers the header");
      await page.keyboard.press("Escape");
      await sidebar.waitFor({ state: "hidden" });
      // A tap on the page closes it too.
      await files.click();
      await sidebar.waitFor({ state: "visible" });
      // (Wherever it lands outside the drawer: the sheet, or a panel overlaying it.)
      await page.mouse.click(405, 400);
      await sidebar.waitFor({ state: "hidden" });
      await files.click();
      await sidebar.waitFor({ state: "visible" });
      await sidebar.getByRole("link", { name: "Ledger" }).click();
      await page.waitForURL(`${lib}/-/ledger`);
      await sidebar.waitFor({ state: "hidden" });
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto(`${lib}/`);
    });

    const shots = process.env.GATE_SCREENSHOTS;
    // A few concepts with tables, code, footnotes and lists, as screenshots for review.
    const shotsOf = [
      concepts[0] ?? "",
      ...concepts.filter((c) => /orders|transactions|events|metrics\//.test(c)).slice(0, 3),
    ];
    let tooltipShown = false;
    for (const concept of concepts) {
      await step(`reader on ${concept}`, async () => {
        await page.goto(`${base}/${owner}/${slug}/${enc(concept)}`);
        const body = page.locator(".body .prose");
        await body.waitFor({ timeout: 15_000 });
        await page.locator(".cluster").waitFor();
        // Read and comment only (TEMPRA-99): nothing in the page edits.
        if ((await page.locator("[contenteditable]").count()) > 0) throw new Error("editable");
        if ((await page.getByRole("button", { name: "Edit", exact: true }).count()) > 0) {
          throw new Error("an Edit control is offered");
        }
        if ((await body.innerText()).trim() === "") throw new Error("empty body");
        // Every block carries its ID, every textblock its place in the text.
        if ((await body.locator("[data-block]").count()) === 0) throw new Error("no block IDs");
        if (shots && shotsOf.includes(concept)) {
          const name = concept.replace(/\.md$/, "").replaceAll("/", "-");
          // The page alone: no panel over it at phone width.
          const close = page.getByRole("button", { name: "Close panel" });
          if ((await close.count()) > 0) await close.click();
          await page.locator(".ws-main").evaluate((el) => {
            el.scrollTop = 0;
          });
          await page.screenshot({ path: `${shots}/reader-${name}.png` });
          await page.setViewportSize({ width: 390, height: 844 });
          await page.waitForTimeout(200);
          await page.screenshot({ path: `${shots}/reader-${name}-phone.png` });
          await page.setViewportSize({ width: 1280, height: 720 });
        }
        const ref = page.locator(".body .fnref a").first();
        if (!tooltipShown && (await ref.count()) > 0) {
          await ref.hover();
          await page.locator(".tooltip").first().waitFor({ timeout: 5_000 });
          tooltipShown = true;
          if (shots) await page.screenshot({ path: `${shots}/tooltip.png` });
        }
      });
    }
    if (!tooltipShown) problems.push("no footnote reference showed a tooltip");

    // Verify a concept as a person, let an agent change it, and see the change over the text.
    const concept = concepts[0] ?? "";
    const url = `${base}/${owner}/${slug}/${enc(concept)}`;
    const api = `${base}/api/v1/libraries/${owner}/${slug}/files/${enc(concept)}`;
    const auth = { Authorization: `Bearer ${token}` };
    /** An agent appends a sentence (which also lapses any human verification). */
    const agentAppends = async (sentence: string) => {
      const now = await fetch(api, { headers: auth });
      const md = await now.text();
      const put = await fetch(api, {
        method: "PUT",
        headers: {
          ...auth,
          "Content-Type": "text/markdown",
          "If-Match": now.headers.get("ETag") ?? "",
          "X-Note": "gate: an agent edits",
        },
        body: `${md.trimEnd()}\n\n${sentence}\n`,
      });
      if (!put.ok) throw new Error(`edit: ${put.status} ${await put.text()}`);
    };
    const markStay = () =>
      page.evaluate(() => {
        (globalThis as unknown as { stayed: boolean }).stayed = true;
      });
    const stayed = () =>
      page.evaluate(() => (globalThis as unknown as { stayed?: boolean }).stayed === true);

    // The change feed (TEMPRA-12): an agent's write reaches an open page without a reload.
    await step("an agent's write appears on the open page", async () => {
      await page.goto(url);
      await page.locator(".body .prose").waitFor({ timeout: 15_000 });
      await page.waitForTimeout(500); // the feed's socket opens after the page's data
      await markStay();
      const started = Date.now();
      await agentAppends("A sentence written while the page was open.");
      // A newer version shows as the cluster's glyph (take 2), saying who and why.
      await newVersion().waitFor({ timeout: 10_000 });
      const ms = Date.now() - started;
      console.log(`  (the change reached the page in ${ms} ms)`);
      if (ms > 3000) throw new Error(`the new-version glyph took ${ms} ms`);
      if (shots) await page.screenshot({ path: `${shots}/live.png` });
      // The open file prefetched again (a hover on its own row) must not hide the new version.
      await page.locator(`.ws-sidebar a[title="${concept}"]`).hover();
      await page.waitForTimeout(500);
      await newVersion().click();
      await page.getByRole("status").filter({ hasText: "changed this" }).waitFor();
      await page.getByRole("button", { name: "Show new version" }).click();
      await page
        .locator(".body")
        .getByText("A sentence written while the page was open.")
        .waitFor();
      if (!(await stayed())) throw new Error("the page reloaded");
    });

    await step("verify, an agent's edit, and the changes since verification", async () => {
      await agentAppends("A sentence before verification.");
      await page.goto(url);
      // Trust, Verify and the changes since live in the Review panel.
      await panel("Review");
      await page.getByRole("button", { name: "Verify this version" }).click();
      await page.getByText(/^Verified as human:/).waitFor({ timeout: 10_000 });
      await agentAppends("A sentence the gate added.");
      await page.goto(url);
      await panel("Review");
      await page.getByLabel(/Show changes since /).check();
      const added = page.locator(".body ins.diff-added").last();
      await added.waitFor({ timeout: 10_000 });
      if (!(await added.innerText()).includes("A sentence the gate added.")) {
        throw new Error(`added: ${await added.innerText()}`);
      }
      if (shots) await page.screenshot({ path: `${shots}/changes.png`, fullPage: true });
    });
    await step("an internal link's tooltip", async () => {
      const link = page.locator(".body a.internal:not(.broken)").first();
      if ((await link.count()) === 0) return;
      await link.hover();
      await page.locator(".tooltip strong").first().waitFor({ timeout: 10_000 });
      if (shots) await page.screenshot({ path: `${shots}/link.png` });
    });
    // Comments (TEMPRA-13): a person comments on selected text; an agent answers and resolves,
    // and the open page follows without reloading.
    await step(
      "comments: comment on a selection, an agent replies and resolves, live",
      async () => {
        await page.goto(url);
        await page.locator(".body .prose").waitFor({ timeout: 15_000 });
        await panel("Comments");
        // Selects the first 16 characters of the first longer run of paragraph text, as a
        // person dragging over it would (a script string: this file has no DOM types).
        const select = () =>
          page.evaluate<string | null>(`(() => {
          const root = document.querySelector(".body .prose");
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
          for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            const text = n.textContent ?? "";
            if (text.trim().length < 24 || n.parentElement?.closest("h1, h2, h3, a, code")) continue;
            const start = text.search(/\\S/);
            // In view, as a person selecting it would have it: the toolbar sits beside it.
            n.parentElement.scrollIntoView({ block: "center" });
            const range = document.createRange();
            range.setStart(n, start);
            range.setEnd(n, start + 16);
            const sel = document.getSelection();
            sel?.removeAllRanges();
            sel?.addRange(range);
            return range.toString();
          }
          return null;
        })()`);
        const unselect = () => page.evaluate("document.getSelection().removeAllRanges()");
        const tools = page.locator(".selection-tools");
        /** The text a highlight covers (the CSS Custom Highlight API: no element in the body). */
        const highlighted = (name: string) =>
          page.evaluate<string[]>(
            `[...(CSS.highlights.get(${JSON.stringify(name)}) ?? [])].map((r) => r.toString())`,
          );
        /** Waits until the highlight covers some text (or none, with `gone`). */
        const highlight = async (name: string, gone = false, ms = 10_000) => {
          const until = Date.now() + ms;
          for (;;) {
            const now = await highlighted(name);
            if (gone ? now.length === 0 : now.some((t) => t.trim() !== "")) return now;
            if (Date.now() > until) {
              throw new Error(`highlight ${name} ${gone ? "still drawn" : "not drawn"}: ${now}`);
            }
            await page.waitForTimeout(100);
          }
        };
        if (!(await page.evaluate<boolean>("typeof CSS !== 'undefined' && 'highlights' in CSS"))) {
          throw new Error("this Chrome has no CSS Custom Highlight API");
        }
        // Selecting shows the toolbar; clicking away (the selection gone) hides it, and
        // nothing is held for a comment.
        const quote = await select();
        if (!quote) throw new Error("no paragraph text to select");
        await tools.waitFor({ timeout: 5_000 });
        if (shots) await page.screenshot({ path: `${shots}/selection-tools.png` });
        await unselect();
        await tools.waitFor({ state: "detached", timeout: 5_000 });
        if ((await page.locator(".comment-form .quote").count()) > 0) {
          throw new Error("a quote stayed in the panel after the selection went");
        }
        // Comment on the toolbar starts a draft: outlined in the body, the box focused.
        // Escape drops it; a second draft is posted.
        await select();
        await tools.getByRole("button", { name: "Comment" }).click();
        const drafted = await highlight("tempra-comment-draft", false, 5_000);
        if (drafted.join("") !== quote) {
          throw new Error(
            `the draft covers ${JSON.stringify(drafted)}, not ${JSON.stringify(quote)}`,
          );
        }
        await page.locator(".comment-form .quote").waitFor();
        if (
          !(await page
            .locator("#new-comment")
            .evaluate((el) => el === el.ownerDocument.activeElement))
        ) {
          throw new Error("the comment box did not take the focus");
        }
        await page.keyboard.press("Escape");
        await highlight("tempra-comment-draft", true, 5_000);
        await select();
        await tools.getByRole("button", { name: "Comment" }).click();
        await tools.waitFor({ state: "detached", timeout: 5_000 });
        await page.locator("#new-comment").fill("Gate: please check this sentence.");
        if (shots) await page.screenshot({ path: `${shots}/comment-draft.png` });
        await page
          .locator(".comment-form")
          .first()
          .getByRole("button", { name: "Comment", exact: true })
          .click();
        await highlight("tempra-comment-draft", true);
        // The posted thread is the active one: solid, then dotted with the others.
        const marked = async () => [
          ...(await highlighted("tempra-comment")),
          ...(await highlighted("tempra-comment-active")),
        ];
        const until = Date.now() + 10_000;
        while (!(await marked()).some((t) => t.includes(quote.trim().slice(0, 8)))) {
          if (Date.now() > until) throw new Error(`highlight: ${await marked()} for ${quote}`);
          await page.waitForTimeout(100);
        }
        await page.locator(".thread").getByText("Gate: please check this sentence.").waitFor();
        if (shots) await page.screenshot({ path: `${shots}/comment.png` });
        const listed = (await (
          await fetch(`${libApi}/comments?path=${encodeURIComponent(concept)}&status=open`, {
            headers: bearer,
          })
        ).json()) as { threads: { id: string; comments: { body: string }[] }[] };
        const thread = listed.threads.find((t) =>
          t.comments.some((c) => c.body === "Gate: please check this sentence."),
        )?.id;
        if (!thread) throw new Error(`the thread is not listed: ${JSON.stringify(listed)}`);
        await markStay();
        await page.waitForTimeout(300);
        // An agent writes a new paragraph above it (TEMPRA-22): the commented block keeps its
        // ID, the thread stays on it, and the highlight follows the quote on the open page.
        type Anchored = { anchor: { block: string | null } | null; outdated: boolean };
        const threadNow = async () =>
          (await (
            await fetch(`${libApi}/comments/${thread}`, { headers: bearer })
          ).json()) as Anchored;
        const block = (await threadNow()).anchor?.block;
        if (!block) throw new Error("the comment's anchor names no block");
        const before = await fetch(api, { headers: auth });
        const md = await before.text();
        const end = md.indexOf("\n---\n", 3) + 5;
        const opening = "An agent's new opening paragraph.";
        const inserted = await fetch(api, {
          method: "PUT",
          headers: {
            ...auth,
            "Content-Type": "text/markdown",
            "If-Match": before.headers.get("ETag") ?? "",
            "X-Note": "gate: an agent writes above a comment",
          },
          body: `${md.slice(0, end)}${opening}\n\n${md.slice(end)}`,
        });
        if (!inserted.ok)
          throw new Error(`agent write: ${inserted.status} ${await inserted.text()}`);
        const after = (await (
          await fetch(api, { headers: { ...auth, Accept: "application/json" } })
        ).json()) as { doc: unknown };
        if (!JSON.stringify(after.doc).includes(`"id":"${block}"`)) {
          throw new Error("the commented block lost its ID in the agent's write");
        }
        const moved = await threadNow();
        if (moved.outdated || moved.anchor?.block !== block) {
          throw new Error(`the thread lost its place: ${JSON.stringify(moved)}`);
        }
        await showNewVersion();
        await page.locator(".body").getByText(opening).waitFor({ timeout: 10_000 });
        const followed = Date.now() + 10_000;
        while (!(await marked()).some((t) => t.includes(quote.trim().slice(0, 8)))) {
          if (Date.now() > followed) {
            throw new Error(`highlight after the agent's write: ${await marked()}`);
          }
          await page.waitForTimeout(100);
        }
        for (const [suffix, body] of [
          ["", { body: "Checked it; it holds." }],
          ["/resolve", {}],
        ] as const) {
          const r = await fetch(`${libApi}/comments/${thread}${suffix}`, {
            method: "POST",
            headers: { ...bearer, "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          if (!r.ok) throw new Error(`agent ${suffix || "reply"}: ${r.status} ${await r.text()}`);
        }
        await page.getByText("Resolved (1)").waitFor({ timeout: 10_000 });
        await highlight("tempra-comment", true);
        await highlight("tempra-comment-active", true);
        if (!(await stayed())) throw new Error("the page reloaded");
        // Notifications (TEMPRA-72, TEMPRA-74): the agent's reply on the person's thread is in
        // their inbox, its count shows in the open page's header without a reload, and the
        // batched mail lands in the dev outbox.
        await page.locator(".inbox-link .count").waitFor({ timeout: 10_000 });
        const inbox = (await (await apiAs(devCookie, "/api/v1/inbox")).json()) as {
          items: { kind: string; excerpt: string; href: string }[];
        };
        const item = inbox.items.find((i) => i.excerpt === "Checked it; it holds.");
        if (item?.kind !== "reply" || !item.href.endsWith("#comments")) {
          throw new Error(`inbox: ${JSON.stringify(inbox.items.slice(0, 3))}`);
        }
        const sent = await ui(`${base}/_dev/mail/send`, {
          method: "POST",
          headers: { Accept: "application/json" },
        });
        const outbox = (await (await ui(`${base}/_dev/mail.json`)).json()) as {
          mails: { to: string; text: string }[];
        };
        if (!sent.ok || !outbox.mails.some((m) => m.text.includes("Checked it; it holds."))) {
          throw new Error(`dev outbox: ${sent.status} ${JSON.stringify(outbox.mails[0] ?? null)}`);
        }
      },
    );
    // Markdown shows the file as stored, frontmatter first, in place of the reader.
    await step("the Markdown view shows the file as stored", async () => {
      await page.goto(url);
      const body = page.locator(".body .prose");
      await body.waitFor({ timeout: 15_000 });
      const asMarkdown = page.getByRole("button", { name: "Markdown", exact: true });
      await asMarkdown.click();
      const stored = page.locator(".raw-markdown pre");
      await stored.waitFor({ timeout: 10_000 });
      const text = await stored.innerText();
      if (!text.startsWith("---\ntype:")) throw new Error(`markdown view: ${text.slice(0, 60)}`);
      if (await body.isVisible()) throw new Error("the reader still shows beside the markdown");
      await asMarkdown.click();
      await body.waitFor({ state: "visible" });
    });
    await step("ledger, reached by a link within the app, tails live", async () => {
      await markStay();
      await page.getByRole("link", { name: /^Ledger/ }).click();
      await page.getByRole("heading", { level: 1, name: "Ledger" }).waitFor({ timeout: 15_000 });
      const requests = page.locator("li.request");
      await requests.first().waitFor();
      if (!(await stayed())) throw new Error("the link reloaded the page");
      if (!page.url().endsWith(`/${owner}/${slug}/-/ledger`)) throw new Error(page.url());
      const top = await requests.first().innerText();
      await page.waitForTimeout(500);
      await agentAppends("A sentence for the live ledger.");
      const until = Date.now() + 10_000;
      while ((await requests.first().innerText()) === top) {
        if (Date.now() > until) throw new Error("the new request did not appear");
        await page.waitForTimeout(200);
      }
      if (!(await stayed())) throw new Error("the page reloaded");
    });
  } finally {
    await b.close();
  }
  return problems;
}

/** Runs the daily maintainers as the app's Export now does, and reads the export from R2. */
async function nightlyExport(owner: string, slug: string, originals: number): Promise<string[]> {
  const lib = `${base}/${owner}/${slug}`;
  const r = await apiAs(devCookie, `/api/v1/libraries/${owner}/${slug}/maintain`, "POST");
  const body = (await r.json().catch(() => null)) as { export?: string | null } | null;
  if (r.status !== 200 || !body?.export) {
    return [`export now: ${r.status} ${JSON.stringify(body).slice(0, 200)}`];
  }
  const listed = (await (
    await apiAs(devCookie, `/api/v1/libraries/${owner}/${slug}/exports`)
  ).json()) as { exports: { date: string }[] };
  if (listed.exports.length === 0) return ["the export list is empty after Export now"];
  const date = new Date().toISOString().slice(0, 10);
  const tar = await ui(`${lib}/-/exports/${date}/bundle.tar`);
  if (!tar.ok) return [`nightly bundle.tar: ${tar.status}`];
  const files = readTar(new Uint8Array(await tar.arrayBuffer()));
  // The originals' own index.md and log.md are replaced by synthesized ones, so at least as many.
  if (files.length < originals) return [`nightly bundle has ${files.length} files`];
  const ledger = await ui(`${lib}/-/exports/${date}/ledger.jsonl`);
  if (!ledger.ok || !(await ledger.text()).includes('"t":"event"')) {
    return [`nightly ledger.jsonl: ${ledger.status}`];
  }
  // The daily alarm was set when the library was first used.
  const stats = (await (await ui(`${base}/api/v1/libraries/${owner}/${slug}/stats`)).json()) as {
    next_run: string | null;
  };
  if (!stats.next_run) return ["no daily maintenance alarm scheduled"];
  return [];
}

/**
 * A restore in cf dev (no point-in-time recovery there), as the app's Recovery page asks for it,
 * fails cleanly: a 501 naming the reason, no pre-restore export, the library still answering.
 */
async function restoreUnavailable(owner: string, slug: string): Promise<string[]> {
  const api = `/api/v1/libraries/${owner}/${slug}`;
  const to = new Date(Date.now() - 5 * 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const r = await apiAs(devCookie, `${api}/restore`, "POST", { to });
  const body = await r.text();
  if (r.status !== 501 || !body.includes("point-in-time recovery")) {
    return [`restore in cf dev: ${r.status} ${body.slice(0, 200)}`];
  }
  const exports = await (await apiAs(devCookie, `${api}/exports`)).text();
  if (exports.includes("pre-restore")) return ["a pre-restore export was written"];
  const home = await ui(`${base}/${owner}/${slug}/`);
  if (!home.ok) return [`library after a refused restore: ${home.status}`];
  return [];
}

/**
 * Two accounts cannot see each other (v2 spec: Tenancy): a second user signs up, creates a
 * library with a name the first already uses, and neither reaches the other's.
 */
async function strangers(owner: string, slug: string, token: string): Promise<string[]> {
  const problems: string[] = [];
  const cookie = await signIn("stranger@localhost");
  const created = await apiAs(cookie, "/api/v1/libraries", "POST", { slug });
  const theirs = (await created.json().catch(() => null)) as { owner?: string } | null;
  if (created.status !== 201 || theirs?.owner !== "stranger") {
    problems.push(`stranger creates ${slug}: ${created.status} ${JSON.stringify(theirs)}`);
  }
  const libraries = `${base}/api/v1/libraries`;
  const home = await (await ui(libraries, {}, cookie)).text();
  if (home.includes(`"owner":"${owner}"`)) problems.push("stranger's list shows the dev's");
  // Every page of the dev's library is a 404 to the stranger, as if it did not exist.
  for (const p of [
    "",
    "-/ledger",
    "-/work",
    "-/transfer",
    "-/recovery",
    "-/connect",
    "-/delete",
    "-/diff/a.md",
    "-/revert/x",
    "-/restore/a.md?to=1",
    "-/export",
    "a.md",
  ]) {
    const page = await ui(`${base}/${owner}/${slug}/${p}`, {}, cookie);
    if (page.status !== 404) problems.push(`stranger opens the dev's ${slug}/${p}: ${page.status}`);
  }
  const mine = await (await ui(libraries)).text();
  if (mine.includes('"owner":"stranger"')) problems.push("dev's list shows the stranger's");
  const cross = await fetch(`${base}/api/v1/libraries/stranger/${slug}/tree`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (cross.status !== 404) problems.push(`dev's token on the stranger's ${slug}: ${cross.status}`);

  // Sharing (tempra-dev: v2/sharing): the dev invites the stranger to write; they accept, open
  // it, connect their own agent over OAuth to it, and the agent writes as theirs.
  const lib = `/api/v1/libraries/${owner}/${slug}`;
  const invited = await apiAs(devCookie, `${lib}/invitations`, "POST", {
    to: "@stranger",
    role: "write",
  });
  if (invited.status !== 202) problems.push(`dev invites the stranger: ${invited.status}`);
  const inbox = (await (await apiAs(cookie, "/api/v1/invitations")).json()) as {
    invitations?: { id: string; owner: string }[];
  };
  const invitation = inbox.invitations?.find((i) => i.owner === owner);
  if (!invitation) return [...problems, "the stranger has no invitation"];
  const accepted = await apiAs(cookie, `/api/v1/invitations/${invitation.id}/accept`, "POST");
  if (accepted.status !== 200) problems.push(`the stranger accepts: ${accepted.status}`);
  for (const p of ["", "a.md"]) {
    const page = await ui(`${base}/${owner}/${slug}/${p}`, {}, cookie);
    if (page.status !== 200) problems.push(`the member opens ${slug}/${p}: ${page.status}`);
  }
  const connected = await oauthConnect(cookie, {
    library: `${owner}/${slug}`,
    libraries: "selected",
    new_library: "",
    access: "write",
    prefix: "",
    actor: "claude-ai/connector",
    tiers: "all",
  });
  if ("error" in connected) return [...problems, `the member connects: ${connected.error}`];
  if (!(await mcpSmoke({ url: base, token: connected.token, log: () => {} }))) {
    problems.push("the member's agent works in the shared library over MCP");
  }
  const who = (await (await apiAs(devCookie, `${lib}/agents`)).json()) as {
    contributors?: { person: string | null; agent: { platform: string | null } | null }[];
  };
  if (
    !who.contributors?.some((c) => c.person === "stranger" && c.agent?.platform === "claude.ai")
  ) {
    problems.push(`the member's agent is not among the library's agents: ${JSON.stringify(who)}`);
  }
  // Removed: the member and their agent are out at once.
  const removed = await apiAs(devCookie, `${lib}/members/stranger`, "DELETE");
  if (removed.status !== 204) problems.push(`dev removes the member: ${removed.status}`);
  const after = await ui(`${base}/${owner}/${slug}/`, {}, cookie);
  if (after.status !== 404) problems.push(`a removed member opens ${slug}: ${after.status}`);
  return problems;
}

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/**
 * Connects an MCP client over OAuth with PKCE, as Claude would, as the signed-in person with
 * this cookie, approving consent with these fields; the access token, or what went wrong.
 */
async function oauthConnect(
  cookie: string,
  fields: Record<string, string>,
): Promise<{ token: string } | { error: string }> {
  const redirect = "https://claude.ai/api/mcp/auth_callback";
  const reg = await fetch(`${base}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Gate",
      redirect_uris: [redirect],
      token_endpoint_auth_method: "none",
    }),
  });
  const { client_id } = (await reg.json()) as { client_id: string };
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))),
  );
  const authorize = `${base}/authorize?${new URLSearchParams({
    response_type: "code",
    client_id,
    redirect_uri: redirect,
    scope: "okf:read okf:write",
    state: "gate",
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: `${base}/mcp`,
  })}`;
  // Consent stays a server page (TEMPRA-14): posted as a person's browser would.
  const consent = await ui(authorize, {}, cookie);
  const html = await consent.text();
  const handle = /name="handle" value="([^"]+)"/.exec(html)?.[1];
  if (!handle) return { error: `consent page: ${consent.status} ${html.slice(0, 200)}` };
  const consentCookies = consent.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const approved = await ui(
    authorize,
    {
      method: "POST",
      headers: { Origin: base },
      body: new URLSearchParams({ handle, decision: "approve", ...fields }),
    },
    `${cookie}; ${consentCookies}`,
  );
  const code = new URL(approved.headers.get("Location") ?? redirect).searchParams.get("code");
  if (!code) return { error: `consent: ${approved.status}` };
  const tok = await fetch(`${base}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirect,
      client_id,
      code_verifier: verifier,
    }),
  });
  const { access_token } = (await tok.json()) as { access_token?: string };
  return access_token ? { token: access_token } : { error: `token: ${tok.status}` };
}

/**
 * A fresh account's first run (v2 spec: Phases and gates, A2), in the browser: sign up, the
 * welcome page, then connect an MCP client through OAuth with PKCE, as Claude Code would, and
 * write through MCP; the open Connect page turns to the agent's write live. Then the account's
 * pages (connected apps, tokens, account, work queue, import and export, recovery) work, and
 * the library is deleted from its Delete tab, which ends the connection.
 */
async function freshAccountConnects(): Promise<string[]> {
  const b = await openBrowser();
  if (typeof b === "string") return [b];
  const { page, step, problems } = b;
  try {
    await b.signInAs("newcomer@localhost", "/");
    await page.waitForURL(`${base}/welcome`);
    await page.getByRole("heading", { level: 1, name: "Welcome" }).waitFor({ timeout: 15_000 });
    await page.locator('input[name="handle"]').fill("newcomer");
    await page.locator('input[name="library"]').fill("notes");
    await page.getByRole("button", { name: "Create" }).click();
    const lib = `${base}/newcomer/notes`;
    await page.waitForURL(`${lib}/-/connect`);
    await page.getByText("No agent has written yet").waitFor({ timeout: 15_000 });
    const cookie = await b.cookie();

    const connected = await oauthConnect(cookie, {
      library: "notes",
      new_library: "",
      access: "write",
      prefix: "",
      actor: "claude-code/gate",
      tiers: "all",
    });
    if ("error" in connected) return [connected.error];
    const access_token = connected.token;
    if (!(await mcpSmoke({ url: base, token: access_token }))) return ["MCP over OAuth"];

    await step("the open Connect page shows the agent's write, live", () =>
      page.getByText("Last agent write: claude-code/gate").waitFor({ timeout: 5000 }),
    );
    /** A link in the avatar's menu (take 2: the account's pages live there). */
    const accountLink = async (name: string) => {
      await page.getByRole("button", { name: "Account menu" }).click();
      await page.locator(".menu-list").getByRole("link", { name, exact: true }).click();
    };
    /** A library view: Work queue in the sidebar, the settings in the library's menu. */
    const libraryLink = async (name: string) => {
      if (name === "Work queue") {
        await page
          .locator(".ws-sidebar")
          .getByRole("link", { name: /^Work queue/ })
          .click();
        return;
      }
      await page.getByRole("button", { name: /^Library / }).click();
      await page.locator(".menu-list").getByRole("link", { name, exact: true }).click();
    };
    await step("connected apps lists the app, from the header", async () => {
      await accountLink("Connected apps");
      await page.waitForURL(`${base}/apps`);
      await page.getByRole("cell", { name: /Gate/ }).waitFor({ timeout: 15_000 });
    });
    await step("tokens: create one, see it once, revoke it", async () => {
      await accountLink("Tokens");
      await page.locator('input[name="actor"]').fill("process:gate");
      await page.getByRole("button", { name: "Create token" }).click();
      await page.locator("#token-secret").waitFor({ timeout: 15_000 });
      await page.getByRole("button", { name: "Back to tokens" }).click();
      await page.getByRole("button", { name: "Revoke" }).click();
      await page.getByText("revoked").waitFor({ timeout: 15_000 });
    });
    await step("account page", async () => {
      await accountLink("Account");
      await page.getByText("this device").waitFor({ timeout: 15_000 });
    });
    for (const [tab, text] of [
      ["Work queue", "Work queue"],
      ["Import & export", "Nightly exports"],
      ["Recovery", "Past restores"],
    ] as const) {
      await step(`library tab ${tab}`, async () => {
        await page.goto(`${lib}/`);
        await libraryLink(tab);
        await page.getByText(text).first().waitFor({ timeout: 15_000 });
      });
    }
    await step("export now, from Import & export", async () => {
      await libraryLink("Import & export");
      await page.getByRole("button", { name: "Export now" }).click();
      await page.getByText("Exported to R2").waitFor({ timeout: 15_000 });
    });

    // Sharing in the app (tempra-dev: v2/sharing): invite from the Members tab; the invitee
    // accepts from Invitations; as a reader there is no Verify, at write there is.
    await step("a note to share", async () => {
      const put = await ui(
        `${base}/api/v1/libraries/newcomer/notes/files/shared.md`,
        {
          method: "PUT",
          headers: { Origin: base, "Content-Type": "text/markdown" },
          body: "---\ntype: Note\ntitle: Shared note\ndescription: For the invited reader.\n---\nRead me.\n",
        },
        cookie,
      );
      if (put.status !== 200) throw new Error(`PUT shared.md: ${put.status}`);
    });
    await step("invite a person from the Members tab", async () => {
      await page.goto(`${lib}/`);
      await libraryLink("Members");
      await page.locator('input[name="to"]').fill("@stranger");
      await page.getByRole("button", { name: "Invite" }).click();
      await page.getByText("Invited @stranger").waitFor({ timeout: 15_000 });
    });
    // The invitee is the same tab under their own session, the cookies swapped: one browser,
    // one context, as for everything else here.
    const { context } = b;
    const asOwner = await context.cookies();
    const switchTo = async (cookies: typeof asOwner) => {
      await context.clearCookies();
      await context.addCookies(cookies);
    };
    let asInvitee: typeof asOwner = [];
    await step("the invitee accepts from Invitations", async () => {
      await context.clearCookies();
      await b.signInAs("stranger@localhost", "/invitations");
      await page.getByRole("button", { name: "Accept" }).click();
      await page.waitForURL(`${lib}/`, { timeout: 15_000 });
      asInvitee = await context.cookies();
    });
    /** Opens the Review panel of the open concept, unless it is open. */
    const review = async () => {
      const button = page.locator(".cluster").getByRole("button", { name: "Review", exact: true });
      await button.waitFor({ timeout: 15_000 });
      if ((await button.getAttribute("aria-pressed")) !== "true") await button.click();
    };
    await step("a reader sees the note and no Verify", async () => {
      await page.goto(`${lib}/shared.md`);
      await page.getByText("Read me.").waitFor({ timeout: 15_000 });
      await review();
      await page.getByText("No human has verified this concept.").waitFor({ timeout: 15_000 });
      // The role loads with the library list; give it the moment it takes.
      await page.waitForTimeout(500);
      const verify = await page.getByRole("button", { name: "Verify this version" }).count();
      if (verify !== 0) throw new Error("a read member is offered Verify");
    });
    await step("the owner gives the member write access", async () => {
      await switchTo(asOwner);
      await page.goto(`${lib}/-/members`);
      await page.getByLabel("Access for @stranger").selectOption("write");
      await page.getByText("@stranger now has write access").waitFor({ timeout: 15_000 });
    });
    await step("a writer is offered Verify", async () => {
      await switchTo(asInvitee);
      await page.goto(`${lib}/shared.md`);
      await review();
      await page.getByRole("button", { name: "Verify this version" }).waitFor({ timeout: 15_000 });
    });
    // Deleting the library wipes its Durable Object and ends the connection.
    await step("delete the library from its Delete tab", async () => {
      await switchTo(asOwner);
      await page.goto(`${lib}/`);
      await libraryLink("Delete");
      await page.locator('input[name="confirm"]').fill("notes");
      await page.getByRole("button", { name: "Delete library" }).click();
      // The last library gone: first run again.
      await page.waitForURL(`${base}/welcome`, { timeout: 15_000 });
    });
    await step("the deleted library's page is gone", async () => {
      const gone = await ui(`${lib}/`, {}, cookie);
      if (gone.status !== 404) throw new Error(`deleted library page: ${gone.status}`);
    });
    await step("the connection ends with the library", async () => {
      const mcp = await fetch(`${base}/mcp`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${access_token}`,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      if (mcp.status !== 401) throw new Error(`MCP after delete: ${mcp.status}`);
    });
    return problems;
  } finally {
    await b.close();
  }
}

let failed = false;
try {
  await waitForHealth();
  devCookie = await signIn("dev@localhost");
  for (const t of tokens) {
    const headers = { Authorization: `Bearer ${t.token}` };
    const lib = `${base}/api/v1/libraries/${t.owner}/${t.slug}`;
    const original = loadBundle(t.bundle);
    const imp = await fetch(`${lib}/import?source=fixtures/${t.bundle}`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/x-tar" },
      body: writeTar(original),
    });
    if (!imp.ok) throw new Error(`import ${t.bundle}: ${imp.status} ${await imp.text()}`);
    const res = (await imp.json()) as { files: number; seq: number; warnings: unknown[] };

    const exp = await fetch(`${lib}/export`, { headers });
    if (!exp.ok) throw new Error(`export ${t.bundle}: ${exp.status} ${await exp.text()}`);
    const exported = new Map(
      readTar(new Uint8Array(await exp.arrayBuffer())).map((f) => [f.path, f.bytes]),
    );
    const problems = compareBundle(original, exported);
    const concepts = original.filter(
      (f) => f.path.endsWith(".md") && !/(^|\/)(index|log)\.md$/.test(f.path),
    ).length;
    const attachments = original.filter((f) => !f.path.endsWith(".md")).length;
    const status = problems.length === 0 ? "PASS" : "FAIL";
    console.log(
      `${status} ${t.bundle}: ${concepts} concepts, ${attachments} attachments, ${res.seq} events, ${res.warnings.length} files with lint`,
    );
    for (const p of problems) console.log(`  - ${p}`);
    if (problems.length > 0) failed = true;

    const uiProblems = await uiPages(
      t.owner,
      t.slug,
      original.map((f) => f.path),
    );
    console.log(`${uiProblems.length === 0 ? "PASS" : "FAIL"} ${t.bundle}: UI pages render`);
    for (const p of uiProblems) console.log(`  - ${p}`);
    if (uiProblems.length > 0) failed = true;

    if (t === tokens[0]) {
      const concepts = original
        .map((f) => f.path)
        .filter((p) => p.endsWith(".md") && !/(^|\/)(index|log)\.md$/.test(p));
      const browser = await browserRenders(t.owner, t.slug, concepts, t.token).catch((e) => [
        String(e),
      ]);
      console.log(`${browser.length === 0 ? "PASS" : "FAIL"} ${t.bundle}: the app in a browser`);
      for (const p of browser) console.log(`  - ${p}`);
      if (browser.length > 0) failed = true;
    }
    const exportProblems = await nightlyExport(t.owner, t.slug, original.length);
    console.log(
      `${exportProblems.length === 0 ? "PASS" : "FAIL"} ${t.bundle}: nightly export to R2 via the Durable Object`,
    );
    for (const p of exportProblems) console.log(`  - ${p}`);
    if (exportProblems.length > 0) failed = true;
    const restoreProblems = await restoreUnavailable(t.owner, t.slug);
    console.log(
      `${restoreProblems.length === 0 ? "PASS" : "FAIL"} ${t.bundle}: restore refused cleanly without point-in-time recovery`,
    );
    for (const p of restoreProblems) console.log(`  - ${p}`);
    if (restoreProblems.length > 0) failed = true;
  }
  const first = tokens[0];
  const tenancy = first ? await strangers(first.owner, first.slug, first.token) : ["no library"];
  console.log(
    `${tenancy.length === 0 ? "PASS" : "FAIL"} a second account sees nothing of the first, until invited; then it and its agent work there`,
  );
  for (const p of tenancy) console.log(`  - ${p}`);
  if (tenancy.length > 0) failed = true;
  // A failure outside a step (signing up, the OAuth connection) is the flow's failure, not the
  // gate's: the checks after it still run.
  const fresh = await freshAccountConnects().catch((e) => [String(e)]);
  console.log(
    `${fresh.length === 0 ? "PASS" : "FAIL"} a fresh account signs up, connects over OAuth, writes, uses its pages, deletes`,
  );
  for (const p of fresh) console.log(`  - ${p}`);
  if (fresh.length > 0) failed = true;
  // The daily blob sweep and digest (v2 spec: A3), run through cf dev's scheduled handler.
  const cron = await fetch(`${base}/cdn-cgi/handler/scheduled?cron=30+4+*+*+*`);
  const cronOk = cron.ok;
  console.log(`${cronOk ? "PASS" : "FAIL"} the daily sweep runs (${cron.status})`);
  if (!cronOk) failed = true;
  const mcpOk = await mcpSmoke({ url: base, token: mcpToken });
  console.log(`${mcpOk ? "PASS" : "FAIL"} MCP smoke on an empty library`);
  if (!mcpOk) failed = true;
  // Several agents at once over MCP: a stale edit refused, turns on one concept, parallel
  // writes; every write must reach the change feed. Patient, since the gate's earlier steps
  // spend much of the account's write limit.
  const a = agentTokens[0];
  const agents = await runAgents({
    url: base,
    owner: a?.owner ?? "",
    slug: a?.slug ?? "",
    tokens: agentTokens.map((t) => t.token),
    patient: true,
    log: () => {},
  });
  console.log(formatReport(agents).replace(/^(PASS|FAIL)/, "$1 scripted agents:"));
  if (!agents.ok) failed = true;
} catch (e) {
  failed = true;
  console.error(e);
  // cf dev's streams end only when it does: stop it first, or this waits forever.
  stopDev();
  await within(10_000, "cf dev's output", drained).catch(() => {});
  console.error(devTail.stderr.slice(-4000));
} finally {
  stopDev();
  await dev.exited;
  if (!values.keep) rmSync(project, { recursive: true, force: true });
}
console.log(failed ? "Gate FAILED" : "Gate passed");
process.exit(failed ? 1 : 0);
