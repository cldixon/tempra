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
import { deflateSync } from "node:zlib";
import { type Browser, chromium } from "playwright-core";
import { SESSION_REQUESTS_PER_MINUTE } from "../cloudflare.config";
import { FEED_FULL, FEED_SOCKETS_PER_ACCOUNT, FEED_SOCKETS_PER_LIBRARY } from "../src/feed";
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
    ...["work", "activity", "transfer", "recovery", "connect", "delete"].map(
      (p) => `${lib}/-/${p}`,
    ),
    ...[...dirs].map((d) => `${lib}/${enc(d)}/`),
    ...concepts.map((p) => `${lib}/${enc(p)}`),
  ];
  const problems: string[] = [];
  // Needs you retired into the Inbox (TEMPRA-116): its URL lands on the Inbox for the library.
  const needs = await ui(`${lib}/-/needs`);
  if (needs.status !== 308 || needs.headers.get("Location") !== `/inbox?library=${owner}/${slug}`) {
    problems.push(`-/needs: ${needs.status} ${needs.headers.get("Location")}`);
  }
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
  /**
   * When each request that counts against the browser session's limit was sent (TEMPRA-80):
   * pages, API calls and feed upgrades to the app; not the static files.
   */
  const counted: { at: number; what: string }[] = [];
  const countsAgainstSession = (url: string) => {
    const u = new URL(url);
    return u.origin === base && !/^\/(_app|_design)\/|^\/(favicon\.svg|healthz)$/.test(u.pathname);
  };
  // Failed requests are reported by URL below; the console only repeats them.
  page.on("console", (m) => {
    note(`console.${m.type()}: ${m.text()}`);
    if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) {
      problems.push(`console: ${m.text()}`);
    }
  });
  page.on("request", (r) => {
    pending.set(r, { what: `${r.method()} ${r.url().replace(base, "")}`, since: Date.now() });
    if (countsAgainstSession(r.url())) {
      const path = new URL(r.url()).pathname.replace(/^\/api\/v1\/libraries\/[^/]+\/[^/]+/, "…");
      counted.push({
        at: Date.now(),
        what: `${r.method()} ${path.replace(/\/files\/.*/, "/files/*")}`,
      });
    }
  });
  page.on("requestfinished", (r) => pending.delete(r));
  page.on("requestfailed", (r) => {
    pending.delete(r);
    note(`request failed: ${r.method()} ${r.url().replace(base, "")} ${r.failure()?.errorText}`);
  });
  page.on("websocket", (ws) => {
    sockets.set(ws, { url: ws.url(), since: Date.now() });
    counted.push({ at: Date.now(), what: "feed socket" });
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
  /** Paths a step means to find missing (a Not found page): their 404s are not problems. */
  const missing = new Set<string>();
  const expect404 = (path: string) => missing.add(path);
  page.on("response", (r) => {
    const url = new URL(r.url());
    const path = url.pathname;
    const meant = [...missing].some(
      (m) =>
        path.replace(/^\/api\/v1\/libraries\/[^/]+\/[^/]+\/[a-z]+\//, "") === m ||
        url.searchParams.get("path") === m,
    );
    if (r.status() === 404 && meant) return;
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
  /**
   * The most counted requests in any 60 seconds so far (from `since`), when that minute began,
   * and what they were (the commonest first).
   */
  const busiestMinute = (since = 0) => {
    let peak = 0;
    let first = 0;
    for (let i = 0, j = 0; j < counted.length; j++) {
      if ((counted[j]?.at ?? 0) < since) {
        i = j + 1;
        continue;
      }
      while ((counted[j]?.at ?? 0) - (counted[i]?.at ?? 0) >= 60_000) i++;
      if (j - i + 1 > peak) {
        peak = j - i + 1;
        first = i;
      }
    }
    const kinds = new Map<string, number>();
    for (const c of counted.slice(first, first + peak)) {
      kinds.set(c.what, (kinds.get(c.what) ?? 0) + 1);
    }
    const what = [...kinds].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${k}`);
    return { peak, from: counted[first]?.at ?? 0, what };
  };
  return {
    browser,
    context,
    page,
    problems,
    step,
    close,
    signInAs,
    cookie,
    busiestMinute,
    expect404,
  };
}

/** A folder's name as the app shows it (app/src/urls.ts folderName): dashes as spaces, capitalised. */
function folderName(path: string): string {
  const name = (path.split("/").pop() ?? "").replace(/[-_]+/g, " ").trim();
  return name ? (name[0]?.toUpperCase() ?? "") + name.slice(1) : path;
}

/** `s` as a literal in a regular expression. */
const literal = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

/** A plain grey PNG, `width` by `height` (8-bit greyscale), for the gate's figures. */
function greyPng(width: number, height: number, shade: number): Uint8Array {
  const crc = (bytes: Uint8Array) => {
    let c = 0xffffffff;
    for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    out.set(new TextEncoder().encode(type), 4);
    out.set(data, 8);
    view.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)));
    return out;
  };
  const header = new Uint8Array(13);
  const h = new DataView(header.buffer);
  h.setUint32(0, width);
  h.setUint32(4, height);
  header.set([8, 0, 0, 0, 0], 8); // 8-bit greyscale, no interlace
  const raw = new Uint8Array(height * (width + 1));
  for (let y = 0; y < height; y++) raw.fill(shade, y * (width + 1) + 1, (y + 1) * (width + 1));
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", new Uint8Array(deflateSync(raw))),
    chunk("IEND", new Uint8Array(0)),
  ];
  const png = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    png.set(p, at);
    at += p.length;
  }
  return png;
}

/**
 * The app in a real browser, signed in as the seeded user (layout take 4, TEMPRA-113 to 118):
 * the library's home (no sections, the agents' line, For you here), the workspace (the tree,
 * the quick switcher, the hidden sidebar; at phone width the top bar naming the page, the
 * drawer with the switcher, search, the views, the tree, Settings and the Inbox, the home
 * stacked, a settings page's drawer with its tabs), a folder's address revealing it, Not found for a moved
 * path, an attachment's page, every concept in the reader (drawn from the stored
 * tree, with no Edit, a footnote card on hover), the concept's panels (Comments, History,
 * Properties: opened from the top bar, closed by ×, Escape and the control, the contents back,
 * `?panel=`), Copy page, the byline while an agent edits, History's versions, checking a page
 * (Mark as checked, the Checked line, review mode), comments in the panel, a concept on a
 * phone (its top bar with Copy page under ⋯,
 * On this page, every panel as a bottom sheet), the Markdown view,
 * figures in the full-screen view, the Inbox (a reply waiting, a page to check, the bell, Done,
 * filtered to the library from the home's For you here and from Needs you's old URL), and
 * Activity with its two views (Summary and
 * Every event), all drawn from the API; links move within the app without reloading the page, and
 * nothing is refused by the CSP or throws. GATE_SCREENSHOTS=<dir> saves screenshots of them.
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
    const main = page.locator("main.ws-main");
    /** The top bar (take 4): the page's tools on the right; no crumbs (TEMPRA-139). */
    const sheetBar = page.locator("header.ws-topbar");
    /** Someone else's write: the top bar's glyph, then Show new version in its menu. */
    const newVersion = () => sheetBar.getByRole("button", { name: "New version" });
    const showNewVersion = async () => {
      await newVersion().click();
      await page.getByRole("button", { name: "Show new version" }).click();
    };
    /** The concept's comments toggle ("Comments" or "Comments n open"). */
    const commentsToggle = () => sheetBar.getByRole("button", { name: /^Comments( \d+ open)?$/ });
    /** The concept's panels (take 4): one at a time, in place of the contents. */
    const comments = page.locator("aside#panel-comments.concept-panel");
    const historyPanel = page.locator("aside#panel-history.concept-panel");
    const properties = () => page.locator("aside#panel-properties.concept-panel");
    /** The contents on the right, while no panel is open and there is room. */
    const contentsNav = main.locator("nav.concept-contents");
    /** An item of the concept's ⋯ menu. */
    const more = async (item: string) => {
      await sheetBar.getByRole("button", { name: "More", exact: true }).click();
      await page.locator(".menu-list").getByRole("button", { name: item, exact: true }).click();
    };
    const byline = main.locator(".byline");
    /** Properties' Check section (TEMPRA-122): Mark as checked, or the changes since a check. */
    const check = () => properties().getByRole("region", { name: "Check" });
    /** The quiet line under the byline once a person has checked the page. */
    const checkedLine = main.locator("p.doc-checked");
    /** A width with room for the contents (or a panel) beside the text. */
    const wide = () => page.setViewportSize({ width: 1600, height: 900 });
    const usual = () => page.setViewportSize({ width: 1280, height: 720 });

    await step("sign in", async () => {
      await b.signInAs("dev@localhost", `/${owner}/${slug}/`);
      await page.waitForURL(`${base}/${owner}/${slug}/`);
    });
    const shots = process.env.GATE_SCREENSHOTS;
    const home = async () => {
      await main
        .getByRole("heading", { level: 1, name: slug, exact: true })
        .waitFor({ timeout: 15_000 });
    };
    // The workspace (TEMPRA-19): the tree stays while files open in the main pane.
    const nested = concepts.find((c) => c.includes("/")) ?? concepts[0] ?? "";
    const folder = nested.split("/").slice(0, -1).join("/");
    const sidebar = page.locator("section.ws-sidebar");
    const lib = `${base}/${owner}/${slug}`;
    /**
     * At phone width (TEMPRA-140): the top bar shows Tempra, not the page's name; the page's own
     * title names it.
     */
    const phoneNamed = async (name: string) => {
      const exact = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
      await main.locator("h1").filter({ hasText: exact }).first().waitFor({ timeout: 10_000 });
      // The mark's tile ("T", hidden from screen readers) and the wordmark.
      await sheetBar
        .locator("a.ws-topbar-place")
        .filter({ hasText: /Tempra$/ })
        .waitFor({ timeout: 5000 });
      // (The desktop's library switcher is in the bar too, hidden at this width.)
      const named = sheetBar.getByText(name, { exact: true }).filter({ visible: true });
      if (name !== "Tempra" && (await named.count()) > 0) {
        throw new Error(`the phone's top bar names "${name}" above the page's own title`);
      }
    };
    /**
     * The phone's drawer, open (TEMPRA-141): its head is Tempra, as the top bar it covers is, and
     * not the frame's own name (the library's, "Library settings", "Settings").
     */
    const drawerHeadIsTempra = async (not: string) => {
      const head = sidebar.locator(".drawer-head");
      await head
        .locator("a.drawer-mark")
        .filter({ hasText: /Tempra$/ })
        .waitFor({ timeout: 5000 });
      if ((await head.getByText(not, { exact: true }).count()) > 0) {
        throw new Error(`the drawer's head names "${not}" where the top bar shows Tempra`);
      }
    };
    await step("the library's root is its home: no sections, the agents' line", async () => {
      await home();
      // No sections: the tree beside it lists the folders (TEMPRA-138).
      await main.locator(".home-section").first().waitFor({ timeout: 15_000 });
      if ((await main.getByRole("heading", { level: 2, name: "Sections" }).count()) > 0) {
        throw new Error("the home still lists sections");
      }
      // The foot: the agents' housekeeping, linking the work queue, when there is any.
      const { housekeeping } = (await (
        await apiAs(devCookie, `/api/v1/libraries/${owner}/${slug}/needs`)
      ).json()) as { housekeeping: { total: number } };
      if (housekeeping.total > 0) {
        const foot = main.locator(`.home-foot a[href="/${owner}/${slug}/-/work"]`);
        await foot.waitFor({ timeout: 10_000 });
        const text = await foot.innerText();
        if (!text.includes(`${housekeeping.total} housekeeping item`)) {
          throw new Error(`the foot line reads "${text}" for ${housekeeping.total} items`);
        }
      }
      if (shots) await page.screenshot({ path: `${shots}/home.png` });
    });
    const bearer = { Authorization: `Bearer ${token}` };
    const libApi = `${base}/api/v1/libraries/${owner}/${slug}`;
    /** An agent deletes a file the gate wrote (a delete names the version it removes). */
    const agentDeletes = async (path: string) => {
      const now = await fetch(`${libApi}/files/${enc(path)}`, { headers: bearer });
      await now.arrayBuffer();
      const gone = await fetch(`${libApi}/files/${enc(path)}`, {
        method: "DELETE",
        headers: { ...bearer, "If-Match": now.headers.get("ETag") ?? "", "X-Note": "gate: tidy" },
      });
      if (!gone.ok) throw new Error(`delete ${path}: ${gone.status} ${await gone.text()}`);
    };
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
        // Folders read as names ("Computations"), with their count beside them. A folder is a
        // group, not a page (TEMPRA-138): its whole row opens and closes it, in place.
        const files = sidebar.getByRole("navigation", { name: "Files" });
        const row = files.locator(`button.tree-name[title="${folderName(folder)}"]`).first();
        const at = page.url();
        const open = (await row.getAttribute("aria-expanded")) === "true";
        if (open) await row.click();
        await sidebar
          .locator(`a[data-path="${nested}"]`)
          .waitFor({ state: "detached", timeout: 1000 });
        await markStay();
        await row.click();
        await sidebar.locator(`a[data-path="${nested}"]`).waitFor({ timeout: 1000 });
        if ((await row.getAttribute("aria-expanded")) !== "true") {
          throw new Error("the folder's row does not say it is open");
        }
        if (page.url() !== at) throw new Error(`opening a folder moved the page to ${page.url()}`);
        if (!(await stayed())) throw new Error("opening a folder reloaded the page");
        // Only pages and files are ever the current row.
        if ((await files.locator(".tree-row.dir [aria-current]").count()) > 0) {
          throw new Error("a folder is the current row");
        }
        page.off("request", count);
        if (asked > 0) throw new Error(`opening a folder made ${asked} request(s)`);
        // Files come after the pages in each folder, with a file icon; at the root after the
        // folders and the root pages.
        const file = `${folder}/gate-tree-file.png`;
        const put = await fetch(`${libApi}/files/${enc(file)}`, {
          method: "PUT",
          headers: { ...bearer, "Content-Type": "image/png", "X-Note": "gate: a file in the tree" },
          body: greyPng(8, 8, 0x99),
        });
        if (!put.ok) throw new Error(`upload ${file}: ${put.status} ${await put.text()}`);
        const fileRow = sidebar.locator(`.tree-row.file:has(a[data-path="${file}"])`);
        await fileRow.waitFor({ timeout: 10_000 });
        if ((await fileRow.locator("svg").count()) !== 1)
          throw new Error("no icon on a file's row");
        const misplaced = await page.evaluate<string[]>(`(() => {
          const bad = [];
          for (const ul of document.querySelectorAll('nav[aria-label="Files"] ul')) {
            let rank = 0;
            for (const li of ul.children) {
              const row = li.querySelector(":scope > .tree-row");
              if (!row) continue;
              const r = row.classList.contains("dir") ? 0 : row.classList.contains("file") ? 2 : 1;
              if (r < rank) bad.push(row.textContent);
              rank = Math.max(rank, r);
            }
          }
          return bad;
        })()`);
        if (misplaced.length > 0) {
          throw new Error(`rows out of order (folders, pages, files): ${misplaced.join(", ")}`);
        }
        await agentDeletes(file);
        await fileRow.waitFor({ state: "detached", timeout: 10_000 });
      }
      await sidebar.locator(`a[data-path="${nested}"]`).click();
      await page.waitForURL(`${lib}/${enc(nested)}`);
      await page.locator(".body .prose").waitFor({ timeout: 15_000 });
      if ((await sidebar.locator(`a[aria-current="page"][data-path="${nested}"]`).count()) !== 1) {
        throw new Error("the open file is not marked in the tree");
      }
      // ⋯ → History opens the History panel; Escape closes it.
      await more("History");
      await historyPanel.locator("a.version").first().waitFor({ timeout: 10_000 });
      await page.keyboard.press("Escape");
      await historyPanel.waitFor({ state: "detached", timeout: 5000 });
      await page.goBack();
      await page.waitForURL(`${lib}/`);
      await home();
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
        await page.locator(".body .prose").waitFor({ timeout: 15_000 });
        await main.evaluate((el) => {
          el.scrollTop = 300;
        });
        const before = await main.evaluate((el) => el.scrollTop);
        const title = await main.locator("h1").first().innerText();
        const link = sidebar.locator(`a[data-path="${other}"]`);
        await link.hover();
        await page.waitForTimeout(1500); // the hover's prefetch lands in the cache
        await link.click();
        await page.waitForURL(`${lib}/${enc(other)}`);
        // The URL changes before React draws the new page: wait for the page itself (on a
        // slow runner the old one can still be on screen, scrolled, when the URL has moved).
        // (A locator, not waitForFunction: the app's CSP refuses string evaluation.)
        const exact = new RegExp(`^${literal(title)}$`);
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
    await step("no crumbs; a folder is not a page, its address reveals it", async () => {
      if (!folder) throw new Error("no concept in a folder");
      await page.locator(".body .prose").waitFor({ timeout: 15_000 });
      // The top bar names no path (TEMPRA-139): the tree beside the page shows where it is, so
      // the page's own line of folders stays hidden too.
      if ((await sheetBar.getByRole("navigation", { name: "Path" }).count()) > 0) {
        throw new Error("the top bar still has crumbs");
      }
      const folders = main.getByRole("navigation", { name: "Folders" });
      if (await folders.isVisible()) throw new Error("the page's folders show beside the tree");
      // A folder's address (an old link, a link to it in a page's body) opens the home, with the
      // folder open in the tree, and the address becomes the home's.
      await page.goto(`${lib}/${enc(folder)}/`);
      await page.waitForURL(`${lib}/`);
      await home();
      const row = sidebar.locator(`button.tree-name[title="${folderName(folder)}"]`);
      if ((await row.first().getAttribute("aria-expanded")) !== "true") {
        throw new Error("a folder's address did not open it in the tree");
      }
      await sidebar.locator(`a[data-path="${nested}"]`).waitFor({ timeout: 10_000 });
      if (shots) await page.screenshot({ path: `${shots}/folder.png` });
      await markStay();
      await sidebar.locator(`a[data-path="${nested}"]`).click();
      await page.waitForURL(`${lib}/${enc(nested)}`);
      await page.locator(".body .prose").waitFor({ timeout: 15_000 });
      if (!(await stayed())) throw new Error("the tree's row reloaded the page");
    });
    await step("workspace: the tree follows an agent's write and move, live", async () => {
      // The person has seen everything so far: no solid dot until an agent writes.
      const libPath = `/api/v1/libraries/${owner}/${slug}`;
      const { seq: head } = (await (await apiAs(devCookie, `${libPath}/summary`)).json()) as {
        seq: number;
      };
      const seen = await apiAs(devCookie, `${libPath}/seen`, "PUT", { seq: head });
      if (!seen.ok) throw new Error(`PUT …/seen: ${seen.status}`);
      await page.reload();
      await sidebar.locator(".tree a").first().waitFor({ timeout: 15_000 });
      const put = await fetch(`${libApi}/files/gate-live.md`, {
        method: "PUT",
        headers: { ...bearer, "Content-Type": "text/markdown", "X-Note": "gate: tree" },
        body: "---\ntype: Note\ntitle: Gate live\ndescription: Written while the tree was open.\n---\nLive.\n",
      });
      if (!put.ok) throw new Error(`write: ${put.status}`);
      const row = sidebar.locator('a[data-path="gate-live.md"]');
      await row.waitFor({ timeout: 5000 });
      // The change dot (take 4, TEMPRA-129): pulsing while the agent writes, named for its
      // person, not by the raw actor (TEMPRA-77): "… for @dev is editing this now".
      await sidebar
        .locator(".tree-row", { has: page.locator(`a[data-path="gate-live.md"]`) })
        .locator('.tree-mark[title*=" for @"][title$="is editing this now"] .change-dot.live')
        .waitFor({ timeout: 5000 });
      // After it (a fresh look, the write no longer live): solid, changed since the person
      // looked; take 3's grey is gone.
      await page.reload();
      await sidebar
        .locator(".tree-row", { has: page.locator(`a[data-path="gate-live.md"]`) })
        .locator('.tree-mark[title="Changed since you last looked"] .change-dot:not(.live)')
        .waitFor({ timeout: 15_000 });
      if ((await sidebar.locator(".change-dot.cool, .change-dot.warm").count()) > 0) {
        throw new Error("the tree still draws take 3's warm or grey dot");
      }
      if (shots) await page.screenshot({ path: `${shots}/tree-dot.png` });
      const target = folder ? `${folder}/gate-live.md` : "moved/gate-live.md";
      const moved = await fetch(`${libApi}/files/gate-live.md/move`, {
        method: "POST",
        headers: { ...bearer, "Content-Type": "application/json" },
        body: JSON.stringify({ to: target, note: "gate: tree move" }),
      });
      if (!moved.ok) throw new Error(`move: ${moved.status}`);
      await row.waitFor({ state: "detached", timeout: 5000 });
      if (folder) await sidebar.locator(`a[data-path="${target}"]`).waitFor({ timeout: 5000 });
      // Not found (take 4, board 32): the old path says where the file moved, with Open, then
      // Home and Search (the quick switcher).
      b.expect404("gate-live.md");
      await page.goto(`${lib}/gate-live.md`);
      await main
        .getByRole("heading", { level: 1, name: "This page isn't here", exact: true })
        .waitFor({ timeout: 15_000 });
      const fate = main.locator(".not-found-fate");
      // Named by its title and folder, not its path (TEMPRA-131).
      await fate
        .filter({ hasText: /Moved to (Gate live|gate-live) \(.+\) by / })
        .waitFor({ timeout: 10_000 });
      const open = await fate.getByRole("link", { name: "Open", exact: true }).getAttribute("href");
      if (open !== `/${owner}/${slug}/${enc(target)}`) throw new Error(`Open: ${open}`);
      await main.getByRole("link", { name: "Home", exact: true }).waitFor();
      if (shots) await page.screenshot({ path: `${shots}/not-found.png` });
      await main.getByRole("button", { name: "Search", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: /^Search / });
      await dialog.waitFor({ timeout: 5000 });
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden", timeout: 5000 });
      await agentDeletes(target);
    });
    // TEMPRA-121: what changed since the person last looked, on the home's one line and in
    // Recently changed; Activity marks only what is new, under one divider, and moves the cursor:
    // back on the home (no reload) the line, the section's dot and the tree's dot are gone.
    await step("home: since you last looked, Recently changed, and a second look", async () => {
      const libPath = `/api/v1/libraries/${owner}/${slug}`;
      const { seq: head } = (await (await apiAs(devCookie, `${libPath}/summary`)).json()) as {
        seq: number;
      };
      const put = await apiAs(devCookie, `${libPath}/seen`, "PUT", { seq: head });
      if (!put.ok) throw new Error(`PUT …/seen: ${put.status}`);
      const path = folder ? `${folder}/gate-since.md` : "gate-since.md";
      const wrote = await fetch(`${libApi}/files/${enc(path)}`, {
        method: "PUT",
        headers: { ...bearer, "Content-Type": "text/markdown", "X-Note": "gate: since" },
        body: "---\ntype: Note\ntitle: Gate since\ndescription: Written after the last look.\n---\nNew.\n",
      });
      if (!wrote.ok) throw new Error(`write: ${wrote.status}`);
      // A fresh load: the write is past the cursor, and no longer arriving live.
      await page.goto(`${lib}/`);
      await home();
      const since = main.locator(".home-since");
      await since
        .filter({ hasText: /^Since earlier today: .+ changed 1 page · See Activity$/ })
        .waitFor({ timeout: 15_000 });
      const recent = main.getByRole("region", { name: "Recently changed" });
      await recent
        .locator(".home-recent-row")
        .first()
        .getByRole("link", { name: "Gate since", exact: true })
        .waitFor({ timeout: 10_000 });
      const meta = await recent.locator(".home-recent-meta").first().innerText();
      if (!/ · just now$/.test(meta)) throw new Error(`Recently changed says "${meta}"`);
      // The tree's solid dot: on the file, or rolled up on a closed folder that holds it.
      const treeDot = sidebar.locator('nav[aria-label="Files"] .change-dot');
      await treeDot.first().waitFor({ timeout: 5000 });
      if (shots) await page.screenshot({ path: `${shots}/home-since.png` });
      await markStay();
      await sidebar
        .getByRole("navigation", { name: "Views" })
        .getByRole("link", { name: /^Activity/ })
        .click();
      await page.waitForURL(`${lib}/-/activity`);
      // One divider under the new entry (older entries follow it); no dot on every row.
      const divider = main.locator(".entry-divider");
      await divider.waitFor({ timeout: 15_000 });
      if ((await divider.count()) !== 1) throw new Error(`${await divider.count()} dividers`);
      const above = await main.locator(".activity-day .entry").first().innerText();
      if (!above.includes("Gate since")) throw new Error(`the newest entry reads "${above}"`);
      if ((await main.locator(".activity-day .entry-side .change-dot").count()) > 0) {
        throw new Error("Activity still draws a dot on each new entry");
      }
      if (shots) await page.screenshot({ path: `${shots}/activity-new.png` });
      // The cursor moves (the server has it) ...
      const deadline = Date.now() + 10_000;
      for (;;) {
        const { seq } = (await (await apiAs(devCookie, `${libPath}/seen`)).json()) as {
          seq: number | null;
        };
        if (seq !== null && seq > head) break;
        if (Date.now() > deadline) throw new Error(`the cursor stayed at ${seq}`);
        await page.waitForTimeout(200);
      }
      // ... and the home, a second look in the same page load, has nothing new to say.
      await sidebar
        .getByRole("navigation", { name: "Views" })
        .getByRole("link", { name: "Home", exact: true })
        .click();
      await page.waitForURL(`${lib}/`);
      await home();
      await since.waitFor({ state: "detached", timeout: 10_000 });
      await treeDot.first().waitFor({ state: "detached", timeout: 10_000 });
      if (!(await stayed())) throw new Error("moving between home and Activity reloaded the page");
      await agentDeletes(path);
    });
    await step("workspace: the quick switcher opens a concept", async () => {
      const first = concepts[0] ?? "";
      const meta = (await (
        await fetch(`${libApi}/files/${enc(first)}`, {
          headers: { ...bearer, Accept: "application/json" },
        })
      ).json()) as { frontmatter?: { title?: string } };
      const word = String(meta.frontmatter?.title ?? "").split(/\s+/)[0] ?? "";
      const dialog = page.getByRole("dialog", { name: /^Search / });
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
      // Nothing matches: "No results", once search inside pages has answered (F-12).
      await page.keyboard.press("Control+k");
      await box.waitFor({ timeout: 5000 });
      await box.fill("zqxjvw");
      await dialog.locator(".switcher-status", { hasText: /^No results$/ }).waitFor({
        timeout: 10_000,
      });
      if ((await dialog.locator('[role="option"]').count()) > 0) {
        throw new Error("options for a query that matches nothing");
      }
      if (shots) await page.screenshot({ path: `${shots}/search-none.png` });
      await box.press("Escape");
      await dialog.waitFor({ state: "hidden", timeout: 5000 });
      // The sidebar's Search row opens it too: "Search" alone, its keys after it (TEMPRA-143).
      await sidebar.getByRole("button", { name: /^Search( |$)/ }).click();
      await box.waitFor({ timeout: 5000 });
      await box.fill(word);
      const option = page.locator('.switcher [role="option"]', { hasText: first }).first();
      await option.waitFor({ timeout: 5000 });
      await box.press("ArrowDown");
      await box.press("ArrowUp");
      // The hit for the first concept, wherever it ranks.
      await option.click();
      await page.waitForURL(`${lib}/${enc(first)}`);
    });
    await step("workspace: hiding the sidebar is remembered", async () => {
      const show = page.getByRole("button", { name: "Show sidebar" });
      if ((await show.count()) > 0) throw new Error("Show sidebar offered while it shows");
      // Ctrl+\ hides it (take 4 has no button for it).
      await page.keyboard.press("Control+\\");
      await sidebar.waitFor({ state: "hidden", timeout: 5000 });
      await show.waitFor({ timeout: 5000 });
      await page.reload();
      await page.locator(".body .prose").waitFor({ timeout: 15_000 });
      await show.waitFor({ timeout: 5000 });
      if (await sidebar.isVisible()) throw new Error("the hidden sidebar came back on reload");
      // With the tree out of sight, a page in a folder names its folders above its title.
      const folders = main.getByRole("navigation", { name: "Folders" });
      const named = (await folders.count()) > 0 && (await folders.innerText()).trim() !== "";
      if (named && !(await folders.isVisible())) {
        throw new Error("the page's folders are hidden with the sidebar hidden");
      }
      if (shots) await page.screenshot({ path: `${shots}/sidebar-hidden.png` });
      await show.click();
      await sidebar.waitFor({ state: "visible", timeout: 5000 });
      await page.reload();
      await sidebar.getByRole("navigation", { name: "Files" }).waitFor({ timeout: 15_000 });
      if ((await show.count()) > 0) throw new Error("Show sidebar offered after showing it");
    });
    // New library, from the switcher's menu: a compose dialog over the library list, its address
    // following the name; Escape closes it and creates nothing.
    await step("New library: the compose dialog", async () => {
      await sidebar.getByRole("button", { name: /, switch library$/ }).click();
      await page
        .locator(".menu-list.libraries")
        .getByRole("link", { name: "New library", exact: true })
        .click();
      const dialog = page.getByRole("dialog", { name: "New library" });
      await dialog.waitFor({ timeout: 15_000 });
      const name = dialog.getByRole("textbox", { name: "Name", exact: true });
      if (!(await name.evaluate((el) => el === el.ownerDocument.activeElement))) {
        throw new Error("New library: the name field does not have the focus");
      }
      await name.fill("Gate Notes & Plans");
      const address = await dialog.getByRole("textbox", { name: "Address" }).inputValue();
      if (address !== "gate-notes-plans") throw new Error(`New library: address ${address}`);
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden", timeout: 5000 });
      await page.goto(lib);
      await main.waitFor();
    });
    // The frame (take 4, TEMPRA-113): the switcher's menu, the library's settings with General
    // (TEMPRA-102), the bell, and the theme, chosen in the avatar's menu and kept on the account.
    await step("the frame: the switcher's menu, General, the bell and the theme", async () => {
      // Over the sidebar Tempra alone, on every page; the library leads the sidebar: its
      // switcher, then Search, then Home (TEMPRA-143).
      const brand = page.locator(".topbar-brand");
      const brandIsTempra = async (where: string) => {
        await brand
          .locator("a.topbar-mark")
          .filter({ hasText: /Tempra$/ })
          .waitFor({ timeout: 5000 });
        const text = (await brand.innerText()).trim();
        if (!/^T\s*Tempra$/.test(text)) {
          throw new Error(`the top bar over the sidebar reads "${text}" on ${where}`);
        }
      };
      await brandIsTempra("a library's page");
      const first = await sidebar
        .locator(".sidebar-switch, .nav-row")
        .evaluateAll((els) =>
          els
            .slice(0, 3)
            .map((el) =>
              (el as unknown as { innerText: string }).innerText.replace(/\s+/g, " ").trim(),
            ),
        );
      if (!first[1]?.startsWith("Search") || first[1].includes(slug) || first[2] !== "Home") {
        throw new Error(`the sidebar starts ${JSON.stringify(first)}`);
      }
      const switcher = () => sidebar.getByRole("button", { name: /, switch library$/ });
      await switcher().click();
      const menu = page.locator(".menu-list.libraries");
      await menu
        .locator('a[aria-current="page"]')
        .filter({ hasText: slug })
        .waitFor({ timeout: 5000 });
      await menu.getByRole("link", { name: "All libraries", exact: true }).waitFor();
      await menu.getByRole("link", { name: "New library", exact: true }).waitFor();
      await menu.getByRole("link", { name: `${slug} settings`, exact: true }).click();
      await page.waitForURL(`${lib}/-/settings`);
      await main
        .getByRole("heading", { level: 1, name: "General", exact: true })
        .waitFor({ timeout: 15_000 });
      await brandIsTempra("the library's settings");
      // The settings' sidebar: a way back, then the tabs.
      for (const tab of ["General", "Members", "Connect", "Import & export", "Recovery"]) {
        await sidebar.getByRole("link", { name: tab, exact: true }).waitFor({ timeout: 5000 });
      }
      await sidebar.getByRole("link", { name: "Delete library", exact: true }).waitFor();
      // A title, saved: the switcher and the home show it; cleared again, they show the slug.
      await page.locator("#library-title").fill("The gate's library");
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await page.getByText("Saved.").waitFor({ timeout: 15_000 });
      await sidebar.getByRole("link", { name: /^Back to / }).click();
      await page.waitForURL(`${lib}/`);
      await main
        .getByRole("heading", { level: 1, name: "The gate's library", exact: true })
        .waitFor({ timeout: 15_000 });
      await switcher().filter({ hasText: "The gate's library" }).waitFor({ timeout: 5000 });
      if (shots) await page.screenshot({ path: `${shots}/home-titled.png` });
      await page.goto(`${lib}/-/settings`);
      await page.locator("#library-title").waitFor({ timeout: 15_000 });
      await page.locator("#library-title").fill("");
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await page.getByText("Saved.").waitFor({ timeout: 15_000 });
      await page.goto(`${lib}/`);
      await home();
      // The bell: the inbox's latest few, and the way to the inbox.
      await page.getByRole("button", { name: /^Inbox/ }).click();
      const bell = page.locator(".menu-list.bell-pop");
      await bell.getByRole("link", { name: "Open inbox", exact: true }).waitFor({ timeout: 5000 });
      await page.keyboard.press("Escape");
      await bell.waitFor({ state: "detached", timeout: 5000 });
      // The theme: applied at once, kept on the account across a reload, back to the system's.
      const account = page.locator(".menu-list.account");
      await page.getByRole("button", { name: "Account menu" }).click();
      await account.getByRole("button", { name: "Dark", exact: true }).click();
      await page.locator('html[data-theme="dark"]').waitFor({ timeout: 5000 });
      await page.keyboard.press("Escape");
      await account.waitFor({ state: "detached", timeout: 5000 });
      await page.reload();
      await page.locator('html[data-theme="dark"]').waitFor({ timeout: 15_000 });
      await home();
      if (shots) await page.screenshot({ path: `${shots}/home-dark.png` });
      await page.getByRole("button", { name: "Account menu" }).click();
      await account.getByRole("button", { name: "System", exact: true }).click();
      await page.locator("html:not([data-theme])").waitFor({ timeout: 5000 });
      await page.keyboard.press("Escape");
      await account.waitFor({ state: "detached", timeout: 5000 });
    });
    // The phone (take 4, TEMPRA-118, boards 34 and 36): a top bar with Tempra (TEMPRA-140), the
    // sidebar as a drawer over it with Tempra at its head (TEMPRA-141), the home stacked.
    await step(
      "workspace: at phone width the top bar shows Tempra, the sidebar is a drawer",
      async () => {
        const topbar = page.locator("header.ws-topbar");
        const menu = topbar.getByRole("button", { name: "Menu", exact: true });
        if (await menu.isVisible()) throw new Error("the phone's menu button shows on a desktop");
        await page.setViewportSize({ width: 390, height: 844 });
        try {
          await menu.waitFor({ state: "visible", timeout: 5000 });
          if (await sidebar.isVisible()) throw new Error("the sidebar shows at phone width");
          // The top bar on the home: the menu, Tempra, the bell, the avatar. No search button:
          // search is the drawer's row, as on the desktop the sidebar's (TEMPRA-143).
          const libraryName = (await main.locator("h1").first().innerText()).trim();
          await phoneNamed(libraryName);
          if (await topbar.getByRole("button", { name: /^Search/ }).isVisible()) {
            throw new Error("the phone's top bar has a search button");
          }
          for (const control of [
            topbar.getByRole("button", { name: /^Inbox/ }),
            topbar.getByRole("button", { name: "Account menu" }),
          ]) {
            if (!(await control.isVisible()))
              throw new Error("the phone's top bar lacks a control");
          }
          const menuBox = await menu.boundingBox();
          if (!menuBox || menuBox.height < 44 || menuBox.width < 44) {
            throw new Error(`the menu button is no touch target: ${JSON.stringify(menuBox)}`);
          }
          // The drawer: over the top bar, about four fifths of the screen, the page dimmed beside
          // it; it takes the focus.
          await menu.click();
          await sidebar.waitFor({ state: "visible" });
          const drawn = await sidebar.boundingBox();
          if (!drawn || drawn.x > 1 || drawn.y > 1 || drawn.width < 280 || drawn.width > 340) {
            throw new Error(
              `the drawer is not four fifths of the screen: ${JSON.stringify(drawn)}`,
            );
          }
          await page.locator(".ws-scrim").waitFor({ timeout: 2000 });
          const focused = await page.evaluate<boolean>(
            'Boolean(document.querySelector("section.ws-sidebar")?.contains(document.activeElement))',
          );
          if (!focused) throw new Error("the drawer did not take the focus");
          // What it holds (board 34): at its head Tempra, as on the bar it covers, and ×
          // (TEMPRA-141); then the desktop's sidebar (TEMPRA-143): the switcher, Search, Home,
          // Activity, the tree, then Settings and the Inbox at its foot.
          await drawerHeadIsTempra(libraryName);
          const views = sidebar.getByRole("navigation", { name: "Views" });
          const searchRow = sidebar.getByRole("button", { name: /^Search( |$)/ });
          for (const part of [
            sidebar.getByRole("button", { name: /, switch library$/ }),
            sidebar.getByRole("button", { name: "Close menu" }),
            searchRow,
            views.getByRole("link", { name: "Home", exact: true }),
            views.getByRole("link", { name: /^Activity/ }),
            sidebar.locator(".tree-row").first(),
            sidebar.locator(".sidebar-foot").getByRole("link", { name: "Settings", exact: true }),
            sidebar.locator(".sidebar-foot").getByRole("link", { name: /^Inbox/ }),
          ]) {
            if (!(await part.isVisible())) throw new Error(`the drawer lacks ${part}`);
          }
          // In the desktop's order, and Search does not repeat the library's name.
          const order = await sidebar
            .locator(".sidebar-switch, .nav-row")
            .evaluateAll((els) =>
              els
                .slice(0, 3)
                .map((el) =>
                  (el as unknown as { innerText: string }).innerText.replace(/\s+/g, " ").trim(),
                ),
            );
          if (order[1] !== "Search" || order[2] !== "Home") {
            throw new Error(`the drawer starts ${JSON.stringify(order)}`);
          }
          if (shots) await page.screenshot({ path: `${shots}/drawer-phone.png` });
          // The switcher, the drawer's first row, opens its menu of libraries there.
          await sidebar.getByRole("button", { name: /, switch library$/ }).click();
          const libraries = page.locator(".menu-list.libraries");
          await libraries
            .getByRole("link", { name: "All libraries", exact: true })
            .waitFor({ timeout: 5000 });
          await page.keyboard.press("Escape");
          await libraries.waitFor({ state: "hidden", timeout: 5000 });
          if (!(await sidebar.isVisible())) {
            throw new Error("closing the switcher's menu closed the drawer");
          }
          // Escape closes it, and the focus goes back to the menu button.
          await page.keyboard.press("Escape");
          await sidebar.waitFor({ state: "hidden" });
          const back = await page.evaluate<boolean>(
            'document.activeElement?.matches("header.ws-topbar .ws-menu") === true',
          );
          if (!back) {
            throw new Error("the focus did not go back to the menu button");
          }
          // So do × and a tap on the dimmed page beside it.
          await menu.click();
          await sidebar.getByRole("button", { name: "Close menu" }).click();
          await sidebar.waitFor({ state: "hidden" });
          await menu.click();
          await sidebar.waitFor({ state: "visible" });
          await page.mouse.click(Math.round(drawn.x + drawn.width + 20), 400);
          await sidebar.waitFor({ state: "hidden" });
          // The drawer's Search row opens the quick switcher.
          await menu.click();
          await searchRow.click();
          const dialog = page.getByRole("dialog", { name: /^Search / });
          await dialog.waitFor({ timeout: 5000 });
          await page.keyboard.press("Escape");
          await dialog.waitFor({ state: "hidden", timeout: 5000 });
          await page.keyboard.press("Escape");
          await sidebar.waitFor({ state: "hidden" });
          // A view chosen in the drawer opens, the drawer closes, and the page's heading names it.
          await menu.click();
          await views.getByRole("link", { name: /^Activity/ }).click();
          await page.waitForURL(`${lib}/-/activity`);
          await sidebar.waitFor({ state: "hidden" });
          await phoneNamed("Activity");
          // Home stacks its parts (board 36), with no sections and no sidebar rows of its own:
          // the drawer is the tree, and a folder opens there, in place (TEMPRA-138).
          await menu.click();
          await views.getByRole("link", { name: "Home", exact: true }).click();
          await page.waitForURL(`${lib}/`);
          await sidebar.waitFor({ state: "hidden" });
          await phoneNamed(libraryName);
          const parts = main.locator(".home-section");
          await parts.first().waitFor({ timeout: 15_000 });
          if (shots) await page.screenshot({ path: `${shots}/home-phone.png` });
          const wide = await page.locator("html").evaluate((el) => el.scrollWidth > el.clientWidth);
          if (wide) throw new Error("the home scrolls sideways at phone width");
          if ((await main.locator(".nav-row, .tree-row").count()) > 0) {
            throw new Error("the phone home draws the sidebar's rows");
          }
          const boxes = await parts.evaluateAll((els) =>
            els.map((el) => el.getBoundingClientRect()).map((r) => ({ x: r.x, w: r.width })),
          );
          if (boxes.some((r) => Math.abs(r.x - (boxes[0]?.x ?? 0)) > 1 || r.w < 300)) {
            throw new Error(`the home's parts are not stacked: ${JSON.stringify(boxes)}`);
          }
          await menu.click();
          await sidebar.waitFor({ state: "visible" });
          const folderRow = sidebar.locator("button.tree-name").first();
          const was = await folderRow.getAttribute("aria-expanded");
          await folderRow.click();
          if ((await folderRow.getAttribute("aria-expanded")) === was) {
            throw new Error("a folder's row in the drawer did not open or close it");
          }
          if (page.url() !== `${lib}/`) throw new Error(`a folder's row moved to ${page.url()}`);
          await sidebar.waitFor({ state: "visible" });
          await folderRow.click();
          await page.keyboard.press("Escape");
          await sidebar.waitFor({ state: "hidden" });
          // A settings page's drawer holds the settings' sidebar: back to the library, the tabs.
          await page.goto(`${lib}/-/settings`);
          await phoneNamed("General");
          await menu.click();
          await sidebar.waitFor({ state: "visible" });
          const tabs = sidebar.getByRole("navigation", { name: "Library settings" });
          for (const tab of [`Back to ${libraryName}`, "General", "Members", "Connect"]) {
            await tabs.getByRole("link", { name: tab, exact: true }).waitFor({ timeout: 5000 });
          }
          await sidebar.getByRole("button", { name: "Close menu" }).waitFor();
          await drawerHeadIsTempra("Library settings");
          if (shots) await page.screenshot({ path: `${shots}/settings-drawer-phone.png` });
          await tabs.getByRole("link", { name: "Members", exact: true }).click();
          await page.waitForURL(`${lib}/-/members`);
          await sidebar.waitFor({ state: "hidden" });
          await phoneNamed("Members");
          // The account's pages too: Tempra on the bar and at the drawer's head, never their own
          // name there.
          await page.goto(`${base}/account`);
          await menu.click();
          await sidebar.waitFor({ state: "visible" });
          await drawerHeadIsTempra("Settings");
          await page.keyboard.press("Escape");
          await sidebar.waitFor({ state: "hidden" });
          // The library list's drawer: Search, Libraries and the Inbox, as on the desktop.
          await page.goto(`${base}/`);
          await menu.click();
          await sidebar.waitFor({ state: "visible" });
          const account = sidebar.getByRole("navigation", { name: "Account" });
          await account.getByRole("button", { name: /^Search( |$)/ }).waitFor({ timeout: 5000 });
          await account.getByRole("link", { name: "Libraries", exact: true }).waitFor();
          await account.getByRole("button", { name: /^Search( |$)/ }).click();
          const found = page.getByRole("dialog", { name: "Search libraries" });
          await found.waitFor({ timeout: 5000 });
          await page.keyboard.press("Escape");
          await found.waitFor({ state: "hidden", timeout: 5000 });
          await page.goto(`${lib}/-/members`);
          await phoneNamed("Members");
        } finally {
          await page.setViewportSize({ width: 1280, height: 720 });
        }
      },
    );

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
        await sheetBar.getByRole("button", { name: "More", exact: true }).waitFor();
        await commentsToggle().waitFor();
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
          // On a desktop the page opens on its contents; a panel only when asked.
          await wide();
          await main.evaluate((el) => {
            el.scrollTop = 0;
          });
          await page.screenshot({ path: `${shots}/reader-${name}.png` });
          await commentsToggle().click();
          await comments.waitFor({ timeout: 5000 });
          await page.screenshot({ path: `${shots}/reader-${name}-comments.png` });
          await commentsToggle().click();
          await comments.waitFor({ state: "detached", timeout: 5000 });
          await page.setViewportSize({ width: 390, height: 844 });
          await page.waitForTimeout(200);
          await page.screenshot({ path: `${shots}/reader-${name}-phone.png` });
          // On a phone the comments are a bottom sheet, opened from the toggle.
          await commentsToggle().click();
          await comments.waitFor({ timeout: 5000 });
          await page.screenshot({ path: `${shots}/reader-${name}-phone-comments.png` });
          await page.getByRole("button", { name: "Close comments" }).click();
          await comments.waitFor({ state: "detached", timeout: 5000 });
          await usual();
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

    // Diagrams (TEMPRA-98): a mermaid fence drawn by Pele, loaded on demand, within the CSP (a
    // violation is a console error, which fails the gate); a broken one as its source with a
    // notice, and as lint in the write result.
    await step("diagrams: drawn, and a broken one shown as its source", async () => {
      const put = await fetch(`${libApi}/files/gate-diagram.md`, {
        method: "PUT",
        headers: { ...bearer, "Content-Type": "text/markdown", "X-Note": "gate: diagrams" },
        body: [
          "---\ntype: Note\ntitle: Gate diagram\ndescription: A diagram and a broken one.\n---",
          "Before.\n",
          "```mermaid\nflowchart LR\n  A[Agent writes] --> B{Parses?}\n  B -->|yes| C[Drawn]\n  B -->|no| D[Source and lint]\n```\n",
          "```mermaid\nflowchart LR\n  X[Never closed --> Y\n```\n",
          "After.\n",
        ].join("\n"),
      });
      if (!put.ok) throw new Error(`write: ${put.status} ${await put.text()}`);
      const lint =
        ((await put.json()) as { lint?: { code: string; message: string }[] }).lint ?? [];
      const bad = lint.filter((l) => l.code === "diagram_invalid");
      if (bad.length !== 1 || !/line 2, column 4 of the fence/.test(bad[0]?.message ?? "")) {
        throw new Error(`diagram lint: ${JSON.stringify(lint)}`);
      }
      await page.goto(`${base}/${owner}/${slug}/gate-diagram.md`);
      const drawn = page.locator(".body figure.diagram[data-opaque]");
      const svg = drawn.locator(".diagram-svg svg");
      await svg.waitFor({ timeout: 15_000 });
      if (!(await svg.locator("text", { hasText: "Agent writes" }).count())) {
        throw new Error("the diagram's labels are missing");
      }
      const notice = page.locator(".body figure.diagram.failed .diagram-notice");
      await notice.waitFor({ timeout: 10_000 });
      const source = await page.locator(".body figure.diagram.failed pre[data-text]").innerText();
      if (!source.includes("Never closed")) throw new Error(`broken diagram: ${source}`);
      await page.getByText("After.", { exact: true }).waitFor();
      // Its frame's Source shows the fence in place of the drawing, and again draws it.
      const sourceButton = drawn.getByRole("button", { name: "Source", exact: true });
      await sourceButton.click();
      const fence = await drawn.locator("pre.diagram-source").innerText();
      if (!fence.includes("Agent writes")) throw new Error(`diagram source: ${fence}`);
      await sourceButton.click();
      await svg.waitFor({ timeout: 15_000 });
      // At phone width it fits the column: the page does not scroll sideways.
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(300);
      const wide = await page.locator("html").evaluate((el) => el.scrollWidth > el.clientWidth);
      if (shots) {
        await page.screenshot({ path: `${shots}/diagram-phone.png` });
        await page.emulateMedia({ colorScheme: "dark" });
        await page.screenshot({ path: `${shots}/diagram-phone-dark.png` });
        await page.emulateMedia({ colorScheme: "light" });
      }
      await page.setViewportSize({ width: 1280, height: 720 });
      if (shots) await page.screenshot({ path: `${shots}/diagram.png` });
      if (wide) throw new Error("the diagram makes the page scroll sideways at phone width");
      await agentDeletes("gate-diagram.md");
    });

    // Figures (tempra-dev: app/reader, Figures): an image alone in its paragraph is a numbered
    // figure that opens the full-screen view, which steps through the concept's figures.
    await step("figures: an image opens the full-screen view, and Escape closes it", async () => {
      for (const [path, shade] of [
        ["gate-figure-1.png", 0x88],
        ["gate-figure-2.png", 0xcc],
      ] as const) {
        const put = await fetch(`${libApi}/files/${path}`, {
          method: "PUT",
          headers: { ...bearer, "Content-Type": "image/png", "X-Note": "gate: a figure" },
          body: greyPng(240, 160, shade),
        });
        if (!put.ok) throw new Error(`upload ${path}: ${put.status} ${await put.text()}`);
      }
      const put = await fetch(`${libApi}/files/gate-figures.md`, {
        method: "PUT",
        headers: { ...bearer, "Content-Type": "text/markdown", "X-Note": "gate: figures" },
        body: [
          "---\ntype: Note\ntitle: Gate figures\ndescription: Two images, each a figure.\n---",
          "Before.\n",
          '![A grey block](/gate-figure-1.png "The first block")\n',
          "![A lighter block](/gate-figure-2.png)\n",
          "After.\n",
        ].join("\n"),
      });
      if (!put.ok) throw new Error(`write: ${put.status} ${await put.text()}`);
      await page.goto(`${lib}/gate-figures.md`);
      const figures = page.locator(".body figure.figure");
      await figures.nth(1).waitFor({ timeout: 15_000 });
      const caption = await figures.first().locator("figcaption").innerText();
      if (!/^Figure 1\.\s*The first block$/.test(caption.trim())) {
        throw new Error(`caption: ${caption}`);
      }
      await page.getByRole("button", { name: "Enlarge image: A grey block" }).click();
      const view = page.locator("dialog.lightbox");
      await view.waitFor({ state: "visible", timeout: 5000 });
      await view.getByText("fig. 1 of 2", { exact: true }).waitFor({ timeout: 5000 });
      await view.getByRole("button", { name: "Next figure" }).click();
      await view.getByText("fig. 2 of 2", { exact: true }).waitFor({ timeout: 5000 });
      if (!(await view.getByRole("link", { name: "Download" }).count())) {
        throw new Error("no Download");
      }
      // Open file: the image's attachment page.
      const open = await view.getByRole("link", { name: "Open file" }).getAttribute("href");
      if (open !== `/${owner}/${slug}/gate-figure-2.png`) throw new Error(`Open file: ${open}`);
      if (shots) await page.screenshot({ path: `${shots}/lightbox.png` });
      await page.keyboard.press("Escape");
      await view.waitFor({ state: "hidden", timeout: 5000 });
      // The attachment's page (take 4, board 28): the image on its frame, Download, Copy link,
      // Type, Size, Added and Used in (the concept that shows it).
      await page.goto(`${lib}/gate-figure-2.png`);
      const side = main.locator(".attachment-side");
      await side
        .getByRole("heading", { level: 1, name: "gate-figure-2.png", exact: true })
        .waitFor({ timeout: 15_000 });
      await main.locator(".attachment-frame img").waitFor({ timeout: 10_000 });
      const download = await side.getByRole("link", { name: "Download" }).getAttribute("href");
      if (download !== `/${owner}/${slug}/-/download/gate-figure-2.png`) {
        throw new Error(`Download: ${download}`);
      }
      await side.getByRole("button", { name: "Copy link", exact: true }).waitFor();
      const facts = side.locator(".attachment-facts");
      await facts.locator("dd", { hasText: /^PNG image$/ }).waitFor({ timeout: 5000 });
      await facts.locator("div", { has: page.locator("dt", { hasText: "Size" }) }).waitFor();
      await facts.locator("div", { has: page.locator("dt", { hasText: "Added" }) }).waitFor();
      await facts
        .locator("dd")
        .getByRole("link", { name: "Gate figures", exact: true })
        .waitFor({ timeout: 10_000 });
      if (shots) await page.screenshot({ path: `${shots}/attachment.png` });
      for (const path of ["gate-figures.md", "gate-figure-1.png", "gate-figure-2.png"]) {
        await agentDeletes(path);
      }
    });

    // Verify a concept as a person, let an agent change it, and see the change over the text.
    const concept = concepts[0] ?? "";
    const url = `${base}/${owner}/${slug}/${enc(concept)}`;
    const api = `${base}/api/v1/libraries/${owner}/${slug}/files/${enc(concept)}`;
    const auth = { Authorization: `Bearer ${token}` };
    /** An agent appends a sentence (which also lapses any human verification). */
    const agentAppends = async (sentence: string, note = "gate: an agent edits") => {
      const now = await fetch(api, { headers: auth });
      const md = await now.text();
      const put = await fetch(api, {
        method: "PUT",
        headers: {
          ...auth,
          "Content-Type": "text/markdown",
          "If-Match": now.headers.get("ETag") ?? "",
          "X-Note": note,
        },
        body: `${md.trimEnd()}\n\n${sentence}\n`,
      });
      if (!put.ok) throw new Error(`edit: ${put.status} ${await put.text()}`);
    };
    function markStay() {
      return page.evaluate(() => {
        (globalThis as unknown as { stayed: boolean }).stayed = true;
      });
    }
    function stayed() {
      return page.evaluate(() => (globalThis as unknown as { stayed?: boolean }).stayed === true);
    }

    // The change feed (TEMPRA-12): an agent's write reaches an open page without a reload.
    await step("an agent's write appears on the open page", async () => {
      await page.goto(url);
      await page.locator(".body .prose").waitFor({ timeout: 15_000 });
      await page.waitForTimeout(500); // the feed's socket opens after the page's data
      await markStay();
      const started = Date.now();
      await agentAppends("A sentence written while the page was open.");
      // A newer version shows as the sheet bar's glyph, saying who and why.
      await newVersion().waitFor({ timeout: 10_000 });
      const ms = Date.now() - started;
      console.log(`  (the change reached the page in ${ms} ms)`);
      if (ms > 3000) throw new Error(`the new-version glyph took ${ms} ms`);
      if (shots) await page.screenshot({ path: `${shots}/live.png` });
      // The open file prefetched again (a hover on its own row) must not hide the new version.
      await page.locator(`.ws-sidebar a[data-path="${concept}"]`).hover();
      await page.waitForTimeout(500);
      await newVersion().click();
      await page
        .locator(".new-version")
        .getByText(/changed this/)
        .waitFor();
      // Said once to a screen reader too, in the page's polite live region (C-27).
      await main
        .getByRole("status")
        .filter({ hasText: /^New version: .*changed this/ })
        .waitFor();
      await page.getByRole("button", { name: "Show new version" }).click();
      await page
        .locator(".body")
        .getByText("A sentence written while the page was open.")
        .waitFor();
      if (!(await stayed())) throw new Error("the page reloaded");
    });

    await step(
      "checking a page: Mark as checked, an agent's edit, the changes since, review mode",
      async () => {
        // From here on, a desktop with room for a panel beside the text (at 1280px the contents give way to it).
        await wide();
        await agentAppends("A sentence before the check.");
        await page.goto(url);
        // A page nobody checked says nothing about it (TEMPRA-122): no line under the byline,
        // and Properties offers only Mark as checked (no "not yet verified", no Show changes).
        await byline.waitFor({ timeout: 15_000 });
        if ((await byline.getByText(/verif|review|check/i).count()) > 0) {
          throw new Error("the byline shows verification");
        }
        if ((await checkedLine.count()) > 0) throw new Error("a never-checked page says checked");
        await more("Properties");
        const mark = check().getByRole("button", { name: "Mark as checked" });
        await mark.waitFor({ timeout: 10_000 });
        const said = (await check().innerText()).trim();
        if ((await check().getByRole("link").count()) > 0 || said !== "Mark as checked") {
          throw new Error(`a never-checked page's Check says: ${said}`);
        }
        if ((await properties().getByText(/verif/i).count()) > 0) {
          throw new Error("Properties says verify");
        }
        await mark.click();
        await page.waitForURL(`${url}?done=verify`, { timeout: 10_000 });
        await page
          .getByText("Checked. It stays checked until the next edit.")
          .waitFor({ timeout: 10_000 });
        // Checked: the line under the byline, and nothing to do in Properties.
        await checkedLine.getByText(/^Checked by you, /).waitFor({ timeout: 10_000 });
        if ((await checkedLine.getByText("changed since").count()) > 0) {
          throw new Error("a page checked just now says changed since");
        }
        if (!(await properties().isVisible())) await more("Properties");
        await properties().getByText("Linked from").waitFor({ timeout: 10_000 });
        await check().waitFor({ state: "detached", timeout: 10_000 });
        await page.keyboard.press("Escape");
        await properties().waitFor({ state: "detached", timeout: 5000 });
        // An agent edits it: "· changed since", which opens review mode.
        await agentAppends("A sentence the gate added.");
        await page.goto(url);
        await checkedLine.getByRole("link", { name: "changed since" }).click();
        await page.waitForURL(`${url}?review=1`);
        const bar = page.getByRole("region", { name: "Review" });
        await bar.getByText(/^Changes since you checked on /).waitFor({ timeout: 10_000 });
        // The changes since the person checked, drawn in the text.
        const added = page.locator(".body ins.diff-added").last();
        await added.waitFor({ timeout: 10_000 });
        if (!(await added.innerText()).includes("A sentence the gate added.")) {
          throw new Error(`added: ${await added.innerText()}`);
        }
        if (shots) await page.screenshot({ path: `${shots}/changes.png`, fullPage: true });
        // Properties says how much changed, with no second way out (Done is the bar's).
        await more("Properties");
        await check()
          .getByText(/^1 change since you checked$/)
          .waitFor({ timeout: 10_000 });
        if ((await check().getByRole("link").count()) > 0) {
          throw new Error("Properties offers a second way out of review mode");
        }
        if ((await page.getByRole("button", { name: "Mark as checked" }).count()) !== 1) {
          throw new Error("Mark as checked is offered twice in review mode");
        }
        if (shots) await page.screenshot({ path: `${shots}/review.png` });
        // Each changed block has the rule beside it.
        // (A script string: this file has no DOM types.)
        const rule = await page.evaluate<string>(`(() => {
          const added = [...document.querySelectorAll(".body ins.diff-added")].pop();
          return getComputedStyle(added.closest(".prose > *")).borderLeftWidth;
        })()`);
        if (rule !== "1px") throw new Error(`no rule beside the changed block: ${rule}`);
        // Done, the one way out, leaves review mode: the plain text again.
        if ((await page.getByRole("link", { name: "Hide changes" }).count()) > 0) {
          throw new Error("review mode has two exits");
        }
        await bar.getByRole("link", { name: "Done" }).click();
        await page.waitForURL(url);
        await bar.waitFor({ state: "detached", timeout: 5000 });
        if ((await page.locator(".body ins.diff-added").count()) > 0) {
          throw new Error("the changes are still drawn after Done");
        }
        await page.getByRole("button", { name: "Close properties" }).click();
        await properties().waitFor({ state: "detached", timeout: 5000 });
      },
    );
    // The Inbox's verify items (TEMPRA-116): the person verified the concept and an agent edited
    // it since, so it waits in their Inbox and on the bell; Review opens review mode, Dismiss
    // moves it to Done.
    await step("Inbox: a page the person verified, edited by an agent, to verify", async () => {
      const reviewHref = `/${owner}/${slug}/${enc(concept)}?review=1`;
      const row = page
        .locator("main.ws-main li.inbox-row")
        .filter({ has: page.locator(`a[href="${reviewHref}"]`) });
      await page.goto(`${base}/inbox`);
      await page
        .locator("main.ws-main")
        .getByRole("heading", { level: 1, name: "Inbox", exact: true })
        .waitFor({ timeout: 15_000 });
      await row.waitFor({ timeout: 10_000 });
      await row.getByText("To check").waitFor({ timeout: 5000 });
      await row.getByText(/^1 edit by .+ since you checked$/).waitFor({ timeout: 5000 });
      // The bell lists it; Mark all read clears the badge.
      const bellButton = page.getByRole("button", { name: /^Inbox, \d+ unread$/ });
      await bellButton.waitFor({ timeout: 10_000 });
      await bellButton.click();
      const bell = page.locator(".menu-list.bell-pop");
      await bell.locator(`a.bell-item[href="${reviewHref}"]`).waitFor({ timeout: 5000 });
      // In the Inbox row's words (F-14): the page, then the detail line.
      await bell
        .getByText(/^1 edit by .+ since you checked$/)
        .first()
        .waitFor({ timeout: 5000 });
      if (shots) await page.screenshot({ path: `${shots}/bell.png` });
      await bell.getByRole("button", { name: "Mark all read" }).click();
      await page.getByRole("button", { name: "Inbox", exact: true }).waitFor({ timeout: 10_000 });
      if ((await page.locator(".bell .badge").count()) > 0) throw new Error("the badge stayed");
      await page.keyboard.press("Escape");
      await bell.waitFor({ state: "detached", timeout: 5000 });
      // Review opens the page in review mode.
      await row.getByRole("link", { name: "Review", exact: true }).click();
      await page.waitForURL(`${url}?review=1`);
      await page.getByRole("region", { name: "Review" }).waitFor({ timeout: 15_000 });
      // The home's For you here draws the same open items (TEMPRA-130, H-5).
      const card = main.locator(`a.home-card[href="${reviewHref}"]`);
      await page.goto(`${lib}/`);
      await home();
      await card.waitFor({ timeout: 15_000 });
      // Dismiss marks it done: gone from Open, listed under Done.
      await page.goto(`${base}/inbox`);
      await row.waitFor({ timeout: 15_000 });
      await row.getByRole("button", { name: "Dismiss", exact: true }).click();
      await row.waitFor({ state: "detached", timeout: 10_000 });
      // Done in the Inbox, gone from the home.
      await page.goto(`${lib}/`);
      await home();
      await card.waitFor({ state: "detached", timeout: 15_000 });
      await page.goto(`${base}/inbox`);
      await main
        .getByRole("heading", { level: 1, name: "Inbox", exact: true })
        .waitFor({ timeout: 15_000 });
      await page
        .locator("main.ws-main .inbox-filters")
        .getByRole("button", { name: "Done", exact: true })
        .click();
      await page.waitForURL(`${base}/inbox?done=1`);
      // Newest first: the one just dismissed (an earlier one, closed by verifying, is below).
      await row
        .first()
        .getByText(/^1 edit by .+ since you checked$/)
        .waitFor({ timeout: 10_000 });
      if (shots) await page.screenshot({ path: `${shots}/inbox-done.png` });
      // Checking from review mode's bar, with a note, clears "changed since" (TEMPRA-122).
      await page.goto(`${url}?review=1`);
      const bar = page.getByRole("region", { name: "Review" });
      await bar.getByLabel("Note").fill("Gate: read it through.");
      await bar.getByRole("button", { name: "Mark as checked" }).click();
      await page.waitForURL(`${url}?done=verify`, { timeout: 10_000 });
      await checkedLine.getByText(/^Checked by you, /).waitFor({ timeout: 10_000 });
      await checkedLine
        .getByText("changed since")
        .waitFor({ state: "detached", timeout: 10_000 })
        .catch(() => {
          throw new Error("checking did not clear changed since");
        });
      await page.goto(url);
      await byline.waitFor({ timeout: 15_000 });
    });
    await step("History: a version's changes in the text, and back to the latest", async () => {
      await page.locator(".body .prose").waitFor({ timeout: 15_000 });
      await more("History");
      // A version opens as it was, with what it changed from the one before (TEMPRA-128, C-1):
      // an earlier one at ?at=<it>&since=<the one before>, the latest at ?since=<the one before>.
      const changed = historyPanel.locator('a.version[href*="since="]');
      await changed.first().waitFor({ timeout: 10_000 });
      if ((await historyPanel.getByText(/verif/i).count()) > 0) {
        throw new Error("History shows verification");
      }
      if (shots) await page.screenshot({ path: `${shots}/history.png` });
      const older = historyPanel.locator('a.version[href*="at="][href*="since="]');
      const pick = (await older.count()) > 0 ? older.first() : changed.first();
      const label = (await pick.locator(".version-n").textContent())?.trim() ?? "";
      const href = (await pick.getAttribute("href")) ?? "";
      const asked = new URL(href, base).searchParams;
      await pick.click();
      await page.waitForURL((u) => u.search.includes(`since=${asked.get("since")}`));
      // The slim bar names the version on screen, the one chosen; History stays open on it.
      const bar = page.getByRole("region", { name: "Changes" });
      await bar
        .locator(".review-lead")
        .filter({ hasText: new RegExp(`^Changes in ${label}$`) })
        .waitFor({ timeout: 15_000 });
      await page
        .locator(".body ins.diff-added, .body del.diff-removed")
        .first()
        .waitFor({ timeout: 10_000 });
      await historyPanel
        .locator('a.version[aria-current="true"] .version-n')
        .filter({ hasText: label })
        .waitFor({ timeout: 10_000 });
      // No sequence numbers for people on the way (the old "Viewing as of sequence …").
      if ((await page.getByText(/as of sequence/).count()) > 0) {
        throw new Error("a version shows its sequence number");
      }
      if (shots) await page.screenshot({ path: `${shots}/version.png` });
      // An earlier version: "v3 as it was" shows it alone, its byline its own (never "editing
      // now"), History marking it, and "Changes in v3" draws them again (TEMPRA-134, C-14).
      if (asked.has("at")) {
        await bar.getByRole("link", { name: `${label} as it was` }).click();
        await page.waitForURL((u) => u.searchParams.has("at") && !u.searchParams.has("since"));
        const alone = page.getByRole("region", { name: "Version" });
        await alone
          .locator(".review-lead")
          .filter({ hasText: new RegExp(`^${label} as it was$`) })
          .waitFor({ timeout: 15_000 });
        if ((await page.locator(".body ins.diff-added, .body del.diff-removed").count()) > 0) {
          throw new Error("a version as it was draws changes");
        }
        if ((await byline.getByText(/editing now/).count()) > 0) {
          throw new Error("an earlier version's byline says editing now");
        }
        await historyPanel
          .locator('a.version[aria-current="true"] .version-n')
          .filter({ hasText: label })
          .waitFor({ timeout: 10_000 });
        await alone.getByRole("link", { name: `Changes in ${label}` }).click();
        await page.waitForURL((u) => u.search.includes(`since=${asked.get("since")}`));
        await bar.waitFor({ timeout: 15_000 });
      }
      await bar.getByRole("link", { name: "Back to latest" }).click();
      await page.waitForURL(url);
      await bar.waitFor({ state: "detached", timeout: 5000 });
      if ((await historyPanel.count()) > 0) {
        await page.getByRole("button", { name: "Close history" }).click();
      }
      await historyPanel.waitFor({ state: "detached", timeout: 5000 });
    });
    await step("an internal link's tooltip", async () => {
      await page.goto(url);
      await page.locator(".body .prose").waitFor({ timeout: 15_000 });
      const link = page.locator(".body a.internal:not(.broken)").first();
      if ((await link.count()) === 0) return;
      await link.hover();
      await page.locator(".tooltip strong").first().waitFor({ timeout: 10_000 });
      if (shots) await page.screenshot({ path: `${shots}/link.png` });
    });
    // Comments (TEMPRA-13): a person comments on selected text; an agent answers and resolves,
    // and the open page follows without reloading, in the Comments panel (take 4).
    await step(
      "comments: comment on a selection, an agent replies and resolves, live",
      async () => {
        await page.goto(url);
        await page.locator(".body .prose").waitFor({ timeout: 15_000 });
        // The page opens on its contents: no panel until the person asks for one.
        await page.waitForTimeout(300);
        if ((await comments.count()) > 0) throw new Error("the comments opened by themselves");
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
        /** Where a person would click on a highlight's first range, in the viewport. */
        const pointOn = (name: string) =>
          page.evaluate<{ x: number; y: number } | null>(`(() => {
          const range = [...(CSS.highlights.get(${JSON.stringify(name)}) ?? [])][0];
          // In view first, as a person would scroll to it.
          range?.startContainer.parentElement?.scrollIntoView({ block: "center" });
          const box = range?.getClientRects()[0];
          return box ? { x: box.left + Math.min(6, box.width / 2), y: box.top + box.height / 2 } : null;
        })()`);
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
          throw new Error("a quote was held for a comment after the selection went");
        }
        // Comment on the toolbar opens the Comments panel with a draft at the top: filled in
        // the body, the box focused. Escape drops it (the panel stays); a second is posted.
        await select();
        await tools.getByRole("button", { name: "Comment" }).click();
        const drafted = await highlight("tempra-comment-draft", false, 5_000);
        if (drafted.join("") !== quote) {
          throw new Error(
            `the draft covers ${JSON.stringify(drafted)}, not ${JSON.stringify(quote)}`,
          );
        }
        // The draft is at the top of the panel, with its quote.
        await comments.waitFor({ timeout: 5000 });
        await comments
          .locator(".comments-list > form.comment-form:first-of-type .quote")
          .waitFor({ timeout: 5000 });
        const box = comments.getByPlaceholder("Comment on the selection");
        if (!(await box.evaluate((el) => el === el.ownerDocument.activeElement))) {
          throw new Error("the comment box did not take the focus");
        }
        await page.keyboard.press("Escape");
        await highlight("tempra-comment-draft", true, 5_000);
        await comments.locator("form.comment-form").waitFor({ state: "detached", timeout: 5000 });
        if (!(await comments.isVisible())) throw new Error("Escape on a draft closed the panel");
        await select();
        await tools.getByRole("button", { name: "Comment" }).click();
        await tools.waitFor({ state: "detached", timeout: 5_000 });
        await box.fill("Gate: please check this sentence.");
        if (shots) await page.screenshot({ path: `${shots}/comment-draft.png` });
        // An agent writes while the comment is being written (TEMPRA-128, C-4): the new version
        // waits beside the tools and never swaps in under the draft, past the reader's idle
        // time (15 s), so nothing typed is lost.
        await agentAppends("A sentence written under a draft.", "gate: a write under a draft");
        await newVersion().waitFor({ timeout: 10_000 });
        await page.waitForTimeout(17_000);
        if ((await box.inputValue()) !== "Gate: please check this sentence.") {
          throw new Error("the draft was lost when a new version arrived");
        }
        if ((await highlight("tempra-comment-draft", false, 1000)).join("") !== quote) {
          throw new Error("the draft's quote was lost when a new version arrived");
        }
        if ((await page.getByText("A sentence written under a draft.").count()) > 0) {
          throw new Error("the new version swapped in under the draft");
        }
        await comments
          .locator("form.comment-form")
          .getByRole("button", { name: "Comment", exact: true })
          .click();
        await highlight("tempra-comment-draft", true);
        // Posted: the new version comes in when asked, the comment staying on its quote.
        await showNewVersion();
        await page
          .locator(".body .prose")
          .getByText("A sentence written under a draft.")
          .waitFor({ timeout: 10_000 });
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
        const card = comments.getByRole("region", { name: "Comment thread" });
        await card.getByText("Gate: please check this sentence.").waitFor();
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
        const threadEl = comments.locator(`[id="panel-thread-${thread}"]`);
        // A click elsewhere in the text lets the thread go (compact in the panel); a click on
        // its quote makes it the active thread again.
        await page
          .locator(".body .prose")
          .getByText("A sentence the gate added.", { exact: true })
          .click();
        await comments.locator(`button.thread.collapsed[id="panel-thread-${thread}"]`).waitFor({
          timeout: 5000,
        });
        await highlight("tempra-comment-active", true, 5000);
        const at = await pointOn("tempra-comment");
        if (!at) throw new Error("the thread's quote is not drawn");
        await page.mouse.click(at.x, at.y);
        await comments.locator(`section.thread.open[id="panel-thread-${thread}"]`).waitFor({
          timeout: 5000,
        });
        await highlight("tempra-comment-active", false, 5000);
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
        // The agent answers: the reply shows in the thread's card in the panel, live.
        const reply = await fetch(`${libApi}/comments/${thread}`, {
          method: "POST",
          headers: { ...bearer, "Content-Type": "application/json" },
          body: JSON.stringify({ body: "Checked it; it holds." }),
        });
        if (!reply.ok) throw new Error(`agent reply: ${reply.status} ${await reply.text()}`);
        await threadEl.getByText("Checked it; it holds.").waitFor({ timeout: 10_000 });
        // Notifications (TEMPRA-72, TEMPRA-74): the agent's reply on the person's thread is in
        // their inbox, its count shows on the open page's bell (take 4) without a reload, and
        // the batched mail lands in the dev outbox.
        await sheetBar
          .getByRole("button", { name: /^Inbox, \d+ unread$/ })
          .waitFor({ timeout: 10_000 });
        const inbox = (await (await apiAs(devCookie, "/api/v1/inbox")).json()) as {
          items: { id: string; kind: string; excerpt: string; href: string }[];
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
        const resolve = await fetch(`${libApi}/comments/${thread}/resolve`, {
          method: "POST",
          headers: { ...bearer, "Content-Type": "application/json" },
          body: "{}",
        });
        if (!resolve.ok)
          throw new Error(`agent resolve: ${resolve.status} ${await resolve.text()}`);
        await comments.getByRole("button", { name: "Resolved 1" }).waitFor({ timeout: 10_000 });
        await highlight("tempra-comment", true);
        await highlight("tempra-comment-active", true);
        if ((await commentsToggle().innerText()).trim() !== "Comments") {
          throw new Error(
            `the toggle still counts open threads: ${await commentsToggle().innerText()}`,
          );
        }
        // Under Resolved it is there, with Reopen.
        await comments.getByRole("button", { name: "Resolved 1" }).click();
        await threadEl.waitFor({ timeout: 5000 });
        if ((await threadEl.evaluate((el) => el.tagName)) === "BUTTON") await threadEl.click();
        await threadEl.getByRole("button", { name: "Reopen" }).waitFor({ timeout: 5000 });
        if (!(await stayed())) throw new Error("the page reloaded");
        // Resolving the thread closed its item (TEMPRA-116): it is under Done, no longer open.
        const closed = (await (await apiAs(devCookie, "/api/v1/inbox?all=1")).json()) as {
          items: { id: string; done_at: string | null }[];
        };
        if (!closed.items.find((i) => i.id === item.id)?.done_at) {
          throw new Error("resolving the thread left its inbox item open");
        }
      },
    );
    // The Inbox (take 4, TEMPRA-116) and the home's For you here (TEMPRA-117): an agent's reply
    // on a thread the person opened waits on them on the home, as a card from GET …/needs, and
    // in the Inbox, filtered to the library from the home's "All n in Inbox" and from Needs
    // you's old URL.
    await step("Inbox: an agent's reply waits on the home and in the Inbox", async () => {
      const target = concepts.find((c) => c !== concept) ?? concept;
      const posted = await apiAs(devCookie, `/api/v1/libraries/${owner}/${slug}/comments`, "POST", {
        path: target,
        body: "Gate: is this still current?",
        anchor: null,
      });
      if (!posted.ok) throw new Error(`the person comments: ${posted.status}`);
      const id = ((await posted.json()) as { thread: { id: string } }).thread.id;
      const answered = await fetch(`${libApi}/comments/${id}`, {
        method: "POST",
        headers: { ...bearer, "Content-Type": "application/json" },
        body: JSON.stringify({ body: "Gate: yes, it is still current." }),
      });
      if (!answered.ok) throw new Error(`agent reply: ${answered.status}`);
      const filtered = `${base}/inbox?library=${owner}/${slug}`;
      const inboxHeading = main.getByRole("heading", { level: 1, name: "Inbox", exact: true });
      const row = main
        .locator("li.inbox-row")
        .filter({ hasText: "Gate: yes, it is still current." });
      // The home's For you here: the reply as a card, and "All n in Inbox" to the Inbox
      // filtered to this library.
      await page.goto(`${lib}/`);
      await home();
      await markStay();
      const forYou = main.getByRole("region", { name: "For you here" });
      await forYou
        .locator("a.home-card")
        .filter({ hasText: "Gate: yes, it is still current." })
        .waitFor({ timeout: 15_000 });
      if (shots) await page.screenshot({ path: `${shots}/home-for-you.png` });
      const all = forYou.getByRole("link", { name: /^All \d+ in Inbox$/ });
      const allHref = await all.getAttribute("href");
      if (allHref !== `/inbox?library=${owner}/${slug}`) throw new Error(`All n: ${allHref}`);
      await all.click();
      await page.waitForURL(filtered);
      await inboxHeading.waitFor({ timeout: 15_000 });
      await row.waitFor({ timeout: 10_000 });
      await row.getByText("replied to your thread").waitFor({ timeout: 5000 });
      // One library filter (TEMPRA-130, A-12): the select, set to this library.
      const filter = main.getByRole("combobox", { name: "Library" });
      if ((await filter.inputValue({ timeout: 5000 })) !== `${owner}/${slug}`) {
        throw new Error(`the library filter: ${await filter.inputValue()}`);
      }
      // The reply's row names the page by its title, never its slug (A-4).
      const meta = (await (
        await fetch(`${libApi}/files/${enc(target)}`, {
          headers: { ...bearer, Accept: "application/json" },
        })
      ).json()) as { frontmatter: { title?: string } };
      const title = meta.frontmatter.title;
      if (title) {
        await row
          .locator(".inbox-title a")
          .filter({ hasText: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) })
          .waitFor({ timeout: 10_000 });
      }
      if (!(await stayed())) throw new Error("the link reloaded the page");
      // Mark all read on the filtered list marks this library's items only (A-1).
      const marked = page.waitForRequest(
        (r) => r.url().endsWith("/api/v1/inbox/read") && r.method() === "POST",
      );
      await main.getByRole("button", { name: "Mark all read", exact: true }).click();
      const sent = (await marked).postDataJSON() as { library?: string };
      if (sent.library !== `${owner}/${slug}`) {
        throw new Error(`Mark all read sent ${JSON.stringify(sent)}`);
      }
      await main
        .getByRole("button", { name: "Mark all read", exact: true })
        .waitFor({ state: "detached", timeout: 10_000 });
      const { count } = (await (
        await apiAs(devCookie, `/api/v1/libraries/${owner}/${slug}/needs`)
      ).json()) as { count: number };
      if (count < 1) throw new Error(`GET …/needs counts ${count} with a reply waiting`);
      if (shots) await page.screenshot({ path: `${shots}/inbox.png` });
      // Needs you's old URL lands on the same filtered Inbox.
      await page.goto(`${lib}/-/needs`);
      await page.waitForURL(filtered);
      await row.waitFor({ timeout: 15_000 });
      // Reply opens the concept with that thread open in the Comments panel.
      await markStay();
      await row.getByRole("link", { name: "Reply", exact: true }).click();
      await page.waitForURL(`${lib}/${enc(target)}#thread-${encodeURIComponent(id)}`);
      await comments
        .locator(`section.thread.open[id="panel-thread-${id}"]`)
        .waitFor({ timeout: 15_000 });
      if (!(await stayed())) throw new Error("Reply reloaded the page");
      const resolved = await fetch(`${libApi}/comments/${id}/resolve`, {
        method: "POST",
        headers: { ...bearer, "Content-Type": "application/json" },
        body: "{}",
      });
      if (!resolved.ok) throw new Error(`agent resolve: ${resolved.status}`);
    });
    // A concept at phone width (take 4, TEMPRA-118, boards 33 and 35): the top bar with Tempra,
    // Comments n and ⋯ (Copy page under ⋯), the folders above the title, "On this page" closed
    // until opened; Comments, History and Properties are one bottom sheet, opened only when
    // asked, closed by × or Escape.
    await step(
      "a concept at phone width: its top bar, On this page, the panels as a bottom sheet",
      async () => {
        await page.setViewportSize({ width: 390, height: 844 });
        try {
          await page.goto(url);
          await page.locator(".body .prose").waitFor({ timeout: 15_000 });
          const title = (await main.locator("h1.doc-title").innerText()).trim();
          await phoneNamed(title);
          const toggle = commentsToggle();
          await toggle.waitFor({ timeout: 5000 });
          const moreButton = sheetBar.getByRole("button", { name: "More", exact: true });
          if (!(await moreButton.isVisible())) throw new Error("no ⋯ in the phone's top bar");
          for (const gone of [
            sheetBar.getByRole("button", { name: "Search", exact: true }),
            sheetBar.getByRole("button", { name: /^Inbox/ }),
            sheetBar.getByRole("button", { name: /^Copy page$/ }),
          ]) {
            if (await gone.isVisible()) throw new Error(`the concept's phone bar shows ${gone}`);
          }
          if (concept.includes("/")) {
            const crumbs = main.getByRole("navigation", { name: "Folders" });
            if (!(await crumbs.isVisible())) throw new Error("no crumbs under the phone's top bar");
          }
          await page.waitForTimeout(500);
          if ((await comments.count()) > 0) throw new Error("the comments opened by themselves");
          if ((await toggle.getAttribute("aria-pressed")) !== "false") {
            throw new Error("the comments toggle is pressed with the comments closed");
          }
          // On this page: a closed disclosure under the byline; it opens, and a heading closes it.
          const inline = main.locator("details.toc-inline");
          if ((await inline.count()) > 0) {
            const isOpen = () =>
              page.evaluate<boolean>('document.querySelector("details.toc-inline").open');
            if (await isOpen()) {
              throw new Error("On this page is open by itself");
            }
            await inline.locator("summary").click();
            const entry = inline.locator(".toc a").first();
            await entry.waitFor({ state: "visible", timeout: 5000 });
            await entry.click();
            await page.waitForFunction(
              '!document.querySelector("details.toc-inline").open',
              undefined,
              {
                timeout: 5000,
              },
            );
            if (await isOpen()) throw new Error("On this page stayed open after a heading");
          }
          if (shots) await page.screenshot({ path: `${shots}/concept-phone.png` });
          const sideways = await page
            .locator("html")
            .evaluate((el) => el.scrollWidth > el.clientWidth);
          if (sideways) throw new Error("the concept scrolls sideways at phone width");
          // Copy page heads ⋯ on a phone.
          await b.context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
          await moreButton.click();
          await page.locator(".menu-list").getByRole("button", { name: "Copy page" }).click();
          await page.locator(".menu-list").getByRole("button", { name: "Copied" }).waitFor();
          const copied = await page.evaluate<string>("navigator.clipboard.readText()");
          if (!copied.startsWith("---\n"))
            throw new Error(`Copy page copied: ${copied.slice(0, 60)}`);
          await page.keyboard.press("Escape");
          // A sheet from the bottom: as wide as the screen, its foot at the screen's, about two
          // thirds of it high, with a drag handle.
          const isSheet = async (sheet: typeof comments, what: string) => {
            await sheet.waitFor({ timeout: 5000 });
            const box = await sheet.boundingBox();
            if (
              !box ||
              box.x > 1 ||
              Math.abs(box.y + box.height - 844) > 2 ||
              box.width < 380 ||
              box.height < 0.55 * 844 ||
              box.height > 0.75 * 844
            ) {
              throw new Error(`${what} is not a bottom sheet: ${JSON.stringify(box)}`);
            }
            if (!(await sheet.locator(".panel-grip").isVisible())) {
              throw new Error(`${what} has no drag handle`);
            }
          };
          await toggle.click();
          await isSheet(comments, "Comments");
          await comments.getByRole("button", { name: "Comment on the page" }).waitFor();
          if (shots) await page.screenshot({ path: `${shots}/comments-phone.png` });
          await comments.getByRole("button", { name: "Close comments" }).click();
          await comments.waitFor({ state: "detached", timeout: 5000 });
          await more("History");
          await isSheet(historyPanel, "History");
          if (shots) await page.screenshot({ path: `${shots}/history-phone.png` });
          await page.keyboard.press("Escape");
          await historyPanel.waitFor({ state: "detached", timeout: 5000 });
          await more("Properties");
          await isSheet(properties(), "Properties");
          await properties().getByRole("button", { name: "Close properties" }).click();
          await properties().waitFor({ state: "detached", timeout: 5000 });
        } finally {
          await wide();
        }
      },
    );
    // Keyboard only (TEMPRA-133): a panel opened from its control takes the focus to its heading
    // and gives it back on close (⋯ for History); the menus move by arrow keys and close when the
    // focus leaves; a footnote's card describes its marker and closes on Escape; selected text is
    // commented on with Ctrl+Alt+M and posted from the keyboard. At phone width the drawer and a
    // panel's sheet are modal (what they dim is inert), and a tap on the dimmed page closes the
    // sheet.
    await step("keyboard: panels, menus, a card, a comment, the drawer and the sheet", async () => {
      const path = "gate-keys.md";
      const put = await fetch(`${libApi}/files/${path}`, {
        method: "PUT",
        headers: { ...bearer, "Content-Type": "text/markdown", "X-Note": "gate: keys" },
        body: [
          "---\ntype: Note\ntitle: Gate keys\ndescription: A page read from the keyboard.\n---",
          "A sentence long enough to select from the keyboard, with a note.[^n]\n",
          "[^n]: The note itself.\n",
        ].join("\n"),
      });
      if (!put.ok) throw new Error(`write: ${put.status} ${await put.text()}`);
      await page.goto(`${lib}/${path}`);
      const prose = page.locator(".body .prose");
      await prose.waitFor({ timeout: 15_000 });
      const focusIs = (selector: string) =>
        page.evaluate<boolean>(`!!document.activeElement?.matches(${JSON.stringify(selector)})`);
      const focused = () =>
        page.evaluate<string>(`(() => {
          const el = document.activeElement;
          if (!el) return "nothing";
          return el.tagName + " " + (el.textContent ?? "").trim().slice(0, 60);
        })()`);
      const expectFocus = async (selector: string, what: string) => {
        const until = Date.now() + 3000;
        while (!(await focusIs(selector))) {
          if (Date.now() > until) throw new Error(`${what}: the focus is on ${await focused()}`);
          await page.waitForTimeout(50);
        }
      };
      // Comments from its control: the focus to the panel's heading, and back on Escape.
      await commentsToggle().focus();
      await page.keyboard.press("Enter");
      await comments.waitFor({ timeout: 5000 });
      await expectFocus("aside#panel-comments h2", "opening Comments");
      await page.keyboard.press("Escape");
      await comments.waitFor({ state: "detached", timeout: 5000 });
      await expectFocus(".comments-toggle", "closing Comments");
      // ⋯ by its keys: Down opens it at History, Down, End, Home move; Enter opens History, whose
      // heading takes the focus; Escape gives it back to ⋯.
      const moreButton = sheetBar.getByRole("button", { name: "More", exact: true });
      const list = page.locator(".menu-list");
      await moreButton.focus();
      await page.keyboard.press("ArrowDown");
      await list.waitFor({ timeout: 5000 });
      await expectFocus(".menu-list button.menu-item:first-of-type", "Down on ⋯");
      if (!(await focused()).includes("History")) throw new Error(`Down: ${await focused()}`);
      await page.keyboard.press("ArrowDown");
      if (!(await focused()).includes("Properties")) throw new Error(`Down: ${await focused()}`);
      await page.keyboard.press("End");
      if (!(await focused()).includes("Download")) throw new Error(`End: ${await focused()}`);
      await page.keyboard.press("Home");
      if (!(await focused()).includes("History")) throw new Error(`Home: ${await focused()}`);
      await page.keyboard.press("Enter");
      await historyPanel.waitFor({ timeout: 5000 });
      await expectFocus("aside#panel-history h2", "opening History from ⋯");
      await page.keyboard.press("Escape");
      await historyPanel.waitFor({ state: "detached", timeout: 5000 });
      await expectFocus('[aria-label="More"]', "closing History");
      // A menu closes when the focus leaves it.
      await page.keyboard.press("Enter");
      await list.waitFor({ timeout: 5000 });
      await page.keyboard.press("Shift+Tab");
      await list.waitFor({ state: "detached", timeout: 5000 });
      // A footnote marker's card: its description while shown, gone on Escape.
      const marker = prose.locator(".fnref a").first();
      await marker.focus();
      const card = page.locator(".tooltip[role=tooltip]");
      await card.waitFor({ timeout: 5000 });
      const described = await marker.getAttribute("aria-describedby");
      if (!described || described !== (await card.getAttribute("id"))) {
        throw new Error(`the card does not describe its marker: ${described}`);
      }
      if ((await marker.getAttribute("aria-label")) !== "footnote 1") {
        throw new Error(`the marker says "${await marker.getAttribute("aria-label")}"`);
      }
      await page.keyboard.press("Escape");
      await card.waitFor({ state: "detached", timeout: 5000 });
      // Selected text, then Ctrl+Alt+M: the draft's box takes the focus; Tab to Comment, Enter.
      await page.evaluate(`(() => {
        const text = document.querySelector(".body .prose p").firstChild;
        const range = document.createRange();
        range.setStart(text, 0);
        range.setEnd(text, 18);
        const sel = document.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      })()`);
      await page.keyboard.press("Control+Alt+KeyM");
      await comments.waitFor({ timeout: 5000 });
      const box = comments.getByPlaceholder("Comment on the selection");
      await expectFocus("aside#panel-comments textarea", "Ctrl+Alt+M");
      await page.keyboard.type("Gate: from the keyboard.");
      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");
      await expectFocus('form.comment-form button[type="submit"]', "Tab to Comment");
      await page.keyboard.press("Enter");
      await box.waitFor({ state: "detached", timeout: 10_000 });
      await comments
        .getByRole("region", { name: "Comment thread" })
        .getByText("Gate: from the keyboard.")
        .waitFor({ timeout: 10_000 });
      await page.keyboard.press("Escape");
      await comments.waitFor({ state: "detached", timeout: 5000 });
      // The focus goes back where it was before Ctrl+Alt+M: the marker, focused for its card.
      await expectFocus(".body .fnref a", "closing Comments after commenting");
      // At phone width: the drawer from its button, modal, closed by Escape, the focus back.
      await page.setViewportSize({ width: 390, height: 844 });
      try {
        const inert = (selector: string) =>
          page.evaluate<boolean>(`!!document.querySelector(${JSON.stringify(selector)})?.inert`);
        const menuButton = page.locator("button.ws-menu");
        await menuButton.waitFor({ timeout: 5000 });
        await menuButton.focus();
        await page.keyboard.press("Enter");
        await page.locator("section.ws-sidebar.open").waitFor({ timeout: 5000 });
        await expectFocus("section.ws-sidebar, section.ws-sidebar *", "opening the drawer");
        if (!(await inert("header.ws-topbar")) || !(await inert("main.ws-main"))) {
          throw new Error("the page behind the drawer is not inert");
        }
        for (let i = 0; i < 4; i++) await page.keyboard.press("Tab");
        await expectFocus("section.ws-sidebar *", "Tab in the drawer");
        await page.keyboard.press("Escape");
        await page.locator("section.ws-sidebar.open").waitFor({ state: "detached" });
        await expectFocus("button.ws-menu", "closing the drawer");
        if ((await inert("header.ws-topbar")) || (await inert("main.ws-main"))) {
          throw new Error("the page stayed inert after the drawer closed");
        }
        // A panel's sheet: modal, its heading focused, closed by a tap on the dimmed page.
        await commentsToggle().focus();
        await page.keyboard.press("Enter");
        await comments.waitFor({ timeout: 5000 });
        await expectFocus("aside#panel-comments h2", "opening the sheet");
        if (!(await inert("main article.doc")) || !(await inert("header.ws-topbar"))) {
          throw new Error("the page behind the sheet is not inert");
        }
        await page.mouse.click(195, 120);
        await comments.waitFor({ state: "detached", timeout: 5000 });
        if ((await inert("main article.doc")) || (await inert("header.ws-topbar"))) {
          throw new Error("the page stayed inert after the sheet closed");
        }
      } finally {
        await wide();
      }
    });
    // View Markdown, in ⋯, shows the file as stored, frontmatter first, with line numbers, in
    // place of the page; Back to page returns.
    await step("the Markdown view shows the file as stored", async () => {
      await page.goto(url);
      const body = page.locator(".body .prose");
      await body.waitFor({ timeout: 15_000 });
      await more("View Markdown");
      // In the URL (TEMPRA-134, C-16), with no contents beside it.
      await page.waitForURL((u) => u.searchParams.get("view") === "markdown");
      const stored = page.locator(".raw-markdown pre");
      await stored.waitFor({ timeout: 10_000 });
      const text = await stored.innerText();
      if (!text.startsWith("---\ntype:")) throw new Error(`markdown view: ${text.slice(0, 60)}`);
      if (await body.isVisible()) throw new Error("the reader still shows beside the markdown");
      if (await main.locator("h1.doc-title").isVisible()) {
        throw new Error("the page's title shows over the markdown");
      }
      const numbers = await page.locator(".raw-markdown .raw-line").count();
      if (numbers !== text.replace(/\n$/, "").split("\n").length) {
        throw new Error(`${numbers} line numbers for ${text.split("\n").length} lines`);
      }
      await page.locator(".raw-markdown").getByText(concept, { exact: true }).waitFor();
      if ((await contentsNav.count()) > 0) throw new Error("the contents show beside the markdown");
      // Download's glyph sits beside its word, not over it.
      const download = await page
        .locator(".raw-head")
        .getByRole("link", { name: "Download" })
        .boundingBox();
      if (!download || download.height > 40) {
        throw new Error(`Download stacks its glyph: ${JSON.stringify(download)}`);
      }
      if (shots) await page.screenshot({ path: `${shots}/markdown.png` });
      // Wrap lines: long lines wrap instead of scrolling.
      const wrap = page.getByRole("button", { name: "Wrap lines" });
      await wrap.click();
      if ((await wrap.getAttribute("aria-pressed")) !== "true") throw new Error("Wrap not pressed");
      const scrolls = await page.evaluate<boolean>(
        `(() => { const pre = document.querySelector(".raw-markdown pre"); return pre.scrollWidth > pre.clientWidth + 1; })()`,
      );
      if (scrolls) throw new Error("wrapped lines still scroll sideways");
      await wrap.click();
      // Reloaded, the view is still the Markdown; Back to page leaves it.
      await page.reload();
      await stored.waitFor({ timeout: 15_000 });
      await page.getByRole("button", { name: "Back to page" }).click();
      await body.waitFor({ state: "visible" });
      if (new URL(page.url()).searchParams.has("view"))
        throw new Error("the view stayed in the URL");
    });
    // The panels (take 4, tempra-dev: decisions/one-panel-from-the-top-bar): one at a time in
    // place of the contents, opened from the top bar, closed by ×, Escape or the same control,
    // the contents back; a link with ?panel= opens one; none is remembered. Under 1100px a panel
    // takes the contents' column, and under 960px overlays the page. Copy page copies the stored file; the byline says an agent is editing.
    await step("panels: open and close, the contents come back, ?panel=, Copy page", async () => {
      const path = "gate-panels.md";
      const put = await fetch(`${libApi}/files/${path}`, {
        method: "PUT",
        headers: { ...bearer, "Content-Type": "text/markdown", "X-Note": "gate: panels" },
        body: [
          "---\ntype: Note\ntitle: Gate panels\ndescription: A page with contents.\n---",
          "## First\n\nOne.\n",
          "### Inside\n\nTwo.\n",
          "## Second\n\nThree.\n",
        ].join("\n"),
      });
      if (!put.ok) throw new Error(`write: ${put.status} ${await put.text()}`);
      const here = `${lib}/${path}`;
      await page.goto(here);
      await contentsNav.waitFor({ timeout: 15_000 });
      // Just written by an agent: the byline names it once, then "editing now" with the pulsing
      // dot (TEMPRA-131).
      await byline.getByText(/editing now$/).waitFor({ timeout: 5000 });
      await byline.locator(".change-dot.live").waitFor();
      if (shots) await page.screenshot({ path: `${shots}/page.png` });
      const entries = await contentsNav.locator("a").allInnerTexts();
      if (entries.join("|") !== "First|Inside|Second") throw new Error(`contents: ${entries}`);
      const back = async (what: string) => {
        await contentsNav.waitFor({ timeout: 5000 });
        if ((await page.locator("aside.concept-panel").count()) > 0) {
          throw new Error(`a panel is still open after ${what}`);
        }
      };
      // The control reads its word (TEMPRA-134, C-10), then opens and closes the panel; the text
      // stays where it was (the panel takes the contents' space, C-17).
      const toggle = commentsToggle();
      if ((await toggle.innerText()).trim() !== "Comments") {
        throw new Error(`the comments control reads "${await toggle.innerText()}"`);
      }
      const textX = async () => (await main.locator("article.doc").boundingBox())?.x ?? -1;
      const before = await textX();
      await toggle.click();
      await comments.waitFor({ timeout: 5000 });
      if ((await toggle.getAttribute("aria-pressed")) !== "true") throw new Error("not pressed");
      if ((await contentsNav.count()) > 0) throw new Error("the contents show beside a panel");
      const after = await textX();
      if (Math.abs(after - before) > 1) {
        throw new Error(`opening a panel moved the text from ${before} to ${after}`);
      }
      await comments.getByText("No open threads. Select text to comment on it.").waitFor();
      await toggle.click();
      await back("the control again");
      // ⋯ → History, closed by ×; ⋯ → Properties, closed by Escape; one at a time.
      await more("History");
      await historyPanel.waitFor({ timeout: 5000 });
      await more("Properties");
      await properties().waitFor({ timeout: 5000 });
      if ((await page.locator("aside.concept-panel").count()) !== 1) {
        throw new Error("two panels at once");
      }
      // Properties in people's words (TEMPRA-134, C-12, C-13): Status "not set", no lint codes,
      // suggested actions or path until For agents is opened.
      await properties()
        .locator("dd", { hasText: /^not set$/ })
        .first()
        .waitFor();
      const said = await properties().innerText();
      if (/\b[a-z]+_[a-z_]+\b|→|suggested|trust|human-reviewed|unverified/.test(said)) {
        throw new Error(`Properties shows agents' words: ${said}`);
      }
      if (await properties().getByText(path, { exact: true }).isVisible()) {
        throw new Error("Properties shows the path before For agents is opened");
      }
      if (shots) await page.screenshot({ path: `${shots}/properties.png` });
      await properties().locator("details.for-agents summary").click();
      await properties().getByText(path, { exact: true }).waitFor();
      await page.getByRole("button", { name: "Close properties" }).click();
      await back("×");
      await more("History");
      await historyPanel.waitFor({ timeout: 5000 });
      await page.keyboard.press("Escape");
      await back("Escape");
      // A link asks for a panel; a page opened plainly has none (nothing is remembered).
      await commentsToggle().click();
      await comments.waitFor({ timeout: 5000 });
      await page.goto(`${here}?panel=history`);
      await historyPanel.waitFor({ timeout: 15_000 });
      await page.goto(here);
      await contentsNav.waitFor({ timeout: 15_000 });
      await page.waitForTimeout(300);
      await back("a plain reload");
      // Under 1100px the contents hide (On this page under the byline). At 1280px a panel takes
      // their column and the text moves over for it: nothing runs under it (TEMPRA-128, C-5).
      await usual();
      try {
        await contentsNav.waitFor({ state: "hidden", timeout: 5000 });
        const inline = main.locator(".toc-inline");
        await inline.locator("summary").waitFor({ timeout: 5000 });
        await commentsToggle().click();
        await comments.waitFor({ timeout: 5000 });
        const position = () =>
          page.evaluate<string>(
            `getComputedStyle(document.querySelector("aside#panel-comments")).position`,
          );
        if ((await position()) === "fixed") throw new Error("the panel overlays at 1280px");
        await page.waitForTimeout(200);
        const box = await inline.boundingBox();
        const side = await comments.boundingBox();
        if (!box || !side || box.x + box.width > side.x + 1) {
          throw new Error(`On this page runs under the panel: ${JSON.stringify({ box, side })}`);
        }
        if (shots) await page.screenshot({ path: `${shots}/panel-1280.png` });
        // Narrower still, the panel overlays the page.
        await page.setViewportSize({ width: 1180, height: 720 });
        await page.waitForFunction(
          `getComputedStyle(document.querySelector("aside#panel-comments")).position === "fixed"`,
          undefined,
          { timeout: 5000 },
        );
        if (shots) await page.screenshot({ path: `${shots}/panel-narrow.png` });
        await page.keyboard.press("Escape");
        await comments.waitFor({ state: "detached", timeout: 5000 });
      } finally {
        await wide();
      }
      // Copy page: the stored file, frontmatter and body, on the clipboard.
      await b.context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
      const copy = sheetBar.getByRole("button", { name: /^Copy page$/ });
      await copy.click();
      await sheetBar.getByRole("button", { name: "Copied" }).waitFor({ timeout: 5000 });
      const copied = await page.evaluate<string>("navigator.clipboard.readText()");
      if (!copied.startsWith("---\ntype: Note\ntitle: Gate panels")) {
        throw new Error(`Copy page copied: ${copied.slice(0, 80)}`);
      }
      // ⋯ holds Copy link and Download .md too.
      await sheetBar.getByRole("button", { name: "More", exact: true }).click();
      const download = page.locator(".menu-list").getByRole("link", { name: "Download .md" });
      if ((await download.getAttribute("download")) !== path) throw new Error("no Download .md");
      await page.locator(".menu-list").getByRole("button", { name: "Copy link" }).click();
      // The copy lands a moment after the click.
      let link = "";
      for (const until = Date.now() + 5000; link !== here && Date.now() < until; ) {
        await page.waitForTimeout(100);
        link = await page.evaluate<string>("navigator.clipboard.readText()");
      }
      if (link !== here) throw new Error(`Copy link copied: ${link.slice(0, 80)}`);
      await agentDeletes(path);
    });
    await step(
      "Activity: the Summary follows an agent's write live with its live entry, Every event lists it by seq and tails live, -/ledger opens it, Download is the ledger as JSON lines",
      async () => {
        await markStay();
        await sidebar
          .getByRole("navigation", { name: "Views" })
          .getByRole("link", { name: /^Activity/ })
          .click();
        await page.waitForURL(`${lib}/-/activity`);
        await main
          .getByRole("heading", { level: 1, name: "Activity", exact: true })
          .waitFor({ timeout: 15_000 });
        await main.locator("article.entry").first().waitFor({ timeout: 10_000 });
        if (shots) await page.screenshot({ path: `${shots}/activity.png` });
        await page.waitForTimeout(500);
        await agentAppends(
          "A sentence for Activity.",
          "gate: an agent writes while Activity is open",
        );
        await main
          .locator("article.entry", { hasText: "gate: an agent writes while Activity is open" })
          .first()
          .waitFor({ timeout: 10_000 });
        // The agent is writing now: the live entry heads the Summary with the pulsing dot.
        const liveEntry = main.locator("article.entry.live");
        await liveEntry.waitFor({ timeout: 10_000 });
        if (!/is editing/.test(await liveEntry.innerText())) {
          throw new Error(`live entry: ${await liveEntry.innerText()}`);
        }
        if (!(await liveEntry.locator(".change-dot.live").count())) {
          throw new Error("the live entry has no pulsing dot");
        }
        if (shots) await page.screenshot({ path: `${shots}/activity-live.png` });
        if (!(await stayed())) throw new Error("the page reloaded");

        // Every event: the switch keeps the page, the table lists the agent's write by its seq,
        // the newest row pulses, and a new write joins the top live.
        await main.getByRole("button", { name: "Every event", exact: true }).click();
        await page.waitForURL(`${lib}/-/activity?view=events`);
        const rows = main.locator("table.events-table tbody tr");
        await rows.first().waitFor({ timeout: 15_000 });
        if (!(await stayed())) throw new Error("the switch reloaded the page");
        const stats = await fetch(`${base}/api/v1/libraries/${owner}/${slug}/stats`, {
          headers: auth,
        });
        const head = (await stats.json()) as { seq: number };
        const firstSeq = (await rows.first().locator(".events-seq").innerText()).replace(/\D/g, "");
        if (Number(firstSeq) !== head.seq) {
          throw new Error(`Every event starts at seq ${firstSeq}, the ledger is at ${head.seq}`);
        }
        if (!(await rows.first().innerText()).includes(concept)) {
          throw new Error(
            `the newest row is not the agent's write: ${await rows.first().innerText()}`,
          );
        }
        if (shots) await page.screenshot({ path: `${shots}/activity-events.png` });
        // Focus rings (TEMPRA-132): a field, then a button reached from it, show the 2px ring.
        const ringOn = async (what: string) => {
          const ring = await page.evaluate<string>(`(() => {
            const el = document.activeElement;
            // The filter field draws its ring on its pill (:focus-within), the rest on themselves.
            const s = getComputedStyle(el.closest(".activity-find") || el);
            return el.matches(":focus-visible") + " " + s.outlineStyle + " " + s.outlineWidth;
          })()`);
          if (ring !== "true solid 2px") throw new Error(`${what}'s focus ring: ${ring}`);
        };
        await main.getByLabel("Filter by path or note").focus();
        await ringOn("a text field");
        if (shots) await page.screenshot({ path: `${shots}/focus-field.png` });
        // By keyboard (a click or a script does not show the ring): Tab on to the next pill.
        for (let i = 0; i < 6; i++) {
          await page.keyboard.press("Tab");
          const pill = await page.evaluate<boolean>(
            `!!document.activeElement?.matches("button, a.button")`,
          );
          if (pill) break;
        }
        await ringOn("a button");
        if (shots) await page.screenshot({ path: `${shots}/focus-button.png` });
        await page.evaluate("document.activeElement?.blur()");
        await page.waitForTimeout(500);
        await agentAppends(
          "A sentence for the live ledger.",
          "gate: a write while the ledger is open",
        );
        await main
          .locator("table.events-table tbody tr", {
            hasText: "gate: a write while the ledger is open",
          })
          .first()
          .waitFor({ timeout: 10_000 });
        if (!(await rows.first().locator(".change-dot.live").count())) {
          throw new Error("the newest row does not pulse");
        }
        // The filters: a kind that matches nothing empties the table; Any kind brings it back.
        await main.getByRole("combobox", { name: "Kind" }).selectOption("revert");
        await page.waitForURL(`${lib}/-/activity?view=events&kind=revert`);
        await main
          .getByText(/^No events match( in the latest \d+ requests?)?\.$/)
          .waitFor({ timeout: 5000 });
        await main.getByRole("combobox", { name: "Kind" }).selectOption("");
        await rows.first().waitFor({ timeout: 5000 });
        if (!(await stayed())) throw new Error("the page reloaded");

        // Download: the ledger as JSON lines, every event, the newest included.
        const download = main.getByRole("link", { name: "Download" });
        const href = await download.getAttribute("href");
        if (href !== `/${owner}/${slug}/-/ledger.jsonl`) throw new Error(`Download: ${href}`);
        const jsonl = await ui(`${base}${href}`);
        const lines = (await jsonl.text()).trimEnd().split("\n");
        if (jsonl.status !== 200 || lines.length < head.seq) {
          throw new Error(`ledger.jsonl: ${jsonl.status}, ${lines.length} lines`);
        }
        const last = JSON.parse(lines.at(-1) ?? "{}") as { t?: string; seq?: number };
        if (last.t !== "event" || (last.seq ?? 0) <= head.seq) {
          throw new Error(`ledger.jsonl ends with ${lines.at(-1)}`);
        }

        // The ledger's address opens Every event; the switch goes back to the Summary.
        await page.goto(`${lib}/-/ledger`);
        await rows.first().waitFor({ timeout: 15_000 });
        const pressed = main.getByRole("button", { name: "Every event", exact: true });
        if ((await pressed.getAttribute("aria-pressed")) !== "true") {
          throw new Error("-/ledger does not open Every event");
        }
        await markStay();
        await main.getByRole("button", { name: "Summary", exact: true }).click();
        await page.waitForURL(`${lib}/-/activity`);
        await main.locator("article.entry").first().waitFor({ timeout: 10_000 });
        if (!(await stayed())) throw new Error("the switch reloaded the page");
      },
    );
    // TEMPRA-80: normal use never comes near the session's limit. A minute of someone skimming
    // within the app: every folder opened, every file hovered (a prefetch each), file after file
    // opened with a glance at each, Activity and back, while an agent writes (the tree's refresh,
    // the feed's catch-up, the open page's reloads). That minute must stay under a quarter of the
    // limit. The busiest minute of the whole run is reported too, and must stay under half: it is
    // the gate's own full page loads, one after another, which nobody does by hand.
    await step(
      "a busy minute of browsing stays under a quarter of the session's limit",
      async () => {
        const t0 = Date.now();
        for (let pass = 0; pass < 4; pass++) {
          // Folders in the tree (not the library's or the person's menus).
          const closed = sidebar
            .getByRole("navigation", { name: "Files" })
            .locator('button[aria-expanded="false"]');
          const n = await closed.count();
          if (n === 0) break;
          for (let i = n - 1; i >= 0; i--) await closed.nth(i).click();
        }
        const files = sidebar.locator("a[data-path$='.md']");
        const titles = await files.evaluateAll((els) =>
          els.map((e) => e.getAttribute("data-path")),
        );
        let opened = 0;
        while (Date.now() - t0 < 60_000) {
          for (const title of titles) {
            await sidebar.locator(`a[data-path="${title}"]`).hover();
            await page.waitForTimeout(80);
          }
          for (const title of titles) {
            if (Date.now() - t0 >= 60_000) break;
            await sidebar.locator(`a[data-path="${title}"]`).click();
            await page.locator(".body .prose").first().waitFor({ timeout: 15_000 });
            // Skimming: a glance at each (someone reading opens one every several seconds).
            await page.waitForTimeout(1500);
            if (++opened % 4 === 0) await agentAppends(`A busy reader's sentence ${opened}.`);
          }
          await sidebar
            .getByRole("navigation", { name: "Views" })
            .getByRole("link", { name: /^Activity/ })
            .click();
          await main.locator("article.entry").first().waitFor({ timeout: 15_000 });
          await page.goBack();
        }
        await page.waitForTimeout(2000); // the feed's catch-up and the tree's refresh settle
        const busy = b.busiestMinute(t0);
        const run = b.busiestMinute();
        const pct = (n: number) => Math.round((100 * n) / SESSION_REQUESTS_PER_MINUTE);
        console.log(
          `  a busy minute of browsing (${opened} files opened): ${busy.peak} requests, ${pct(busy.peak)}% of the session limit (${SESSION_REQUESTS_PER_MINUTE}/min)\n    ${busy.what.slice(0, 12).join(", ")}\n  the run's busiest minute (full page loads): ${run.peak} requests, ${pct(run.peak)}%\n    ${run.what.slice(0, 12).join(", ")}`,
        );
        if (busy.peak * 4 > SESSION_REQUESTS_PER_MINUTE) {
          throw new Error(
            `${busy.peak} requests in a minute of browsing is over a quarter of the session limit (${SESSION_REQUESTS_PER_MINUTE})`,
          );
        }
        if (run.peak * 2 > SESSION_REQUESTS_PER_MINUTE) {
          throw new Error(
            `${run.peak} requests in the run's busiest minute is over half the session limit (${SESSION_REQUESTS_PER_MINUTE})`,
          );
        }
      },
    );
    // axe (TEMPRA-133): the gate's pages, light and dark, a concept with its Comments panel, and
    // the phone's drawer and sheet, with no serious or critical issue. After the busy minute, so
    // its loads are not counted there.
    await step("axe: no serious or critical issues on the app's pages", async () => {
      const found = await axePages(page, [
        { name: "home", url: `${lib}/`, ready: () => home() },
        {
          name: "page",
          url: `${lib}/gate-keys.md`,
          ready: () => main.locator(".body .prose").waitFor({ timeout: 15_000 }),
        },
        {
          name: "page, Comments",
          url: `${lib}/gate-keys.md?panel=comments`,
          ready: () => comments.getByText("Gate: from the keyboard.").waitFor({ timeout: 15_000 }),
        },
        {
          name: "page, Properties",
          url: `${lib}/gate-keys.md?panel=properties`,
          ready: () => properties().waitFor({ timeout: 15_000 }),
        },
        {
          name: "Activity",
          url: `${lib}/-/activity`,
          ready: () => main.locator("article.entry").first().waitFor({ timeout: 15_000 }),
        },
        {
          name: "Every event",
          url: `${lib}/-/ledger`,
          ready: () => main.locator("table").first().waitFor({ timeout: 15_000 }),
        },
        {
          name: "Members",
          url: `${lib}/-/members`,
          ready: () => main.locator("h1").first().waitFor({ timeout: 15_000 }),
        },
        {
          name: "libraries",
          url: `${base}/`,
          ready: () => main.locator("h1").first().waitFor({ timeout: 15_000 }),
        },
        {
          name: "Inbox",
          url: `${base}/inbox`,
          ready: () => main.locator("h1").first().waitFor({ timeout: 15_000 }),
        },
        {
          name: "Account",
          url: `${base}/account`,
          ready: () => main.locator("h1").first().waitFor({ timeout: 15_000 }),
        },
        {
          name: "Agents",
          url: `${base}/agents`,
          ready: () => main.locator("h1").first().waitFor({ timeout: 15_000 }),
        },
        {
          name: "page, dark",
          url: `${lib}/gate-keys.md`,
          dark: true,
          ready: () => main.locator(".body .prose").waitFor({ timeout: 15_000 }),
        },
        {
          name: "home, phone drawer",
          url: `${lib}/`,
          phone: true,
          ready: async () => {
            await home();
            await page.locator("button.ws-menu").click();
            await page.locator("section.ws-sidebar.open").waitFor({ timeout: 5000 });
          },
        },
        {
          name: "page, phone sheet",
          url: `${lib}/gate-keys.md`,
          phone: true,
          ready: async () => {
            await main.locator(".body .prose").waitFor({ timeout: 15_000 });
            await commentsToggle().click();
            await comments.waitFor({ timeout: 5000 });
          },
        },
      ]);
      await wide();
      if (found.length > 0) throw new Error(`axe: ${found.join("; ")}`);
    });
  } finally {
    await b.close();
  }
  return problems;
}

/** A page for axe: where it is, what shows it is ready, and how it is seen. */
interface AxePage {
  name: string;
  url: string;
  ready(): Promise<unknown>;
  dark?: boolean;
  phone?: boolean;
}

/**
 * Runs axe-core over each page and returns its serious and critical violations, one line each
 * (rule, impact, the first elements). axe is evaluated into the page through the DevTools
 * protocol, which the app's CSP (`script-src 'self'`) does not govern; nothing is added to the
 * page's own scripts.
 */
async function axePages(page: import("playwright-core").Page, pages: AxePage[]) {
  const source = await Bun.file(Bun.resolveSync("axe-core/axe.min.js", import.meta.dir)).text();
  const found: string[] = [];
  for (const p of pages) {
    await page.setViewportSize(
      p.phone ? { width: 390, height: 844 } : { width: 1600, height: 900 },
    );
    await page.emulateMedia({ colorScheme: p.dark ? "dark" : "light" });
    await page.goto(p.url);
    await p.ready();
    await page.waitForTimeout(400);
    await page.evaluate(source);
    const violations = await page.evaluate<{ id: string; impact: string; nodes: string[] }[]>(`
      axe
        .run(document, { resultTypes: ["violations"] })
        .then((r) =>
          r.violations
            .filter((v) => v.impact === "serious" || v.impact === "critical")
            .map((v) => ({
              id: v.id,
              impact: v.impact,
              nodes: v.nodes.slice(0, 3).map((n) => n.target.join(" ")),
            })),
        )`);
    for (const v of violations) {
      found.push(`${p.name}: ${v.id} (${v.impact}) at ${v.nodes.join(", ")}`);
    }
  }
  await page.emulateMedia({ colorScheme: null });
  return found;
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
    "-/needs",
    "-/activity",
    "-/transfer",
    "-/recovery",
    "-/connect",
    "-/delete",
    "-/diff/a.md",
    "-/revert/x",
    "-/restore/a.md?to=1",
    "-/export",
    "-/ledger.jsonl",
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
 * pages (Agents: the connected app and tokens, account, work queue, import and export, recovery) work, and
 * the library is deleted from its Delete tab, which ends the connection.
 */
/**
 * The daily cron through cf dev's scheduled handler, run again every few seconds while the queue
 * consumer counts each library (the first run holds deletion until every library has been counted
 * once), until a run reports deletion no longer held and the attachments the gate imported as
 * stored and referenced. Each run logs its result as {"sweep": …} on cf dev's output.
 */
async function blobSweep(): Promise<string[]> {
  type Result = { held?: string; stored: number; referenced: number; recount: string };
  const latest = (): Result | null => {
    const lines = devTail.stdout.split("\n").filter((l) => l.includes('{"sweep":{"libraries"'));
    const line = lines[lines.length - 1];
    if (!line) return null;
    try {
      return (JSON.parse(line.slice(line.indexOf("{"))) as { sweep: Result }).sweep;
    } catch {
      return null;
    }
  };
  let last: Result | null = null;
  for (let i = 0; i < 20; i++) {
    const cron = await fetch(`${base}/cdn-cgi/handler/scheduled?cron=30+4+*+*+*`);
    if (!cron.ok) return [`the scheduled handler answered ${cron.status}`];
    await Bun.sleep(3000);
    last = latest();
    if (last && !last.held && last.referenced > 0) break;
  }
  if (!last) return ["no sweep result in cf dev's output"];
  const problems: string[] = [];
  if (last.held) problems.push(`deletion still held: ${last.held}`);
  if (last.stored === 0 || last.referenced === 0) {
    problems.push(
      `imported attachments not tracked (stored ${last.stored}, referenced ${last.referenced})`,
    );
  }
  return problems;
}

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
    // Both fields say they become the library's address, and how they may be written (H-12).
    for (const id of ["welcome-handle-hint", "welcome-library-hint"]) {
      const hint = await page.locator(`#${id}`).innerText();
      if (!/address/.test(hint) || !/[Ll]owercase/.test(hint)) {
        throw new Error(`the ${id} reads "${hint}"`);
      }
    }
    // No start-here note: the library starts empty, so its home shows how to connect an agent.
    await page.locator('input[name="starter"]').uncheck();
    await page.getByRole("button", { name: "Create" }).click();
    const lib = `${base}/newcomer/notes`;
    const cookie = await b.cookie();
    // First run lands on the new library's home (take 4, board 31; H-12): the steps with the MCP
    // URL, waiting for the first write, Import a bundle. The Connect page waits in a second tab.
    const waiting = page.locator("main.ws-main .empty-library");
    await step(
      "first run lands on the empty library's home, which shows how to connect",
      async () => {
        await page.waitForURL(`${lib}/`);
        await waiting
          .getByRole("heading", { name: "Nothing here yet" })
          .waitFor({ timeout: 15_000 });
        await waiting.locator(".copy-field code", { hasText: `${base}/mcp` }).waitFor();
        await waiting.locator(".empty-wait .change-dot.live").waitFor();
        await waiting.getByText("Waiting for the first write").waitFor();
        const imp = await page
          .getByRole("link", { name: "Import a bundle", exact: true })
          .getAttribute("href");
        if (imp !== "/newcomer/notes/-/transfer") throw new Error(`Import a bundle: ${imp}`);
        await page
          .locator("section.ws-sidebar .tree-note", { hasText: "No pages yet." })
          .waitFor({ timeout: 10_000 });
        if (process.env.GATE_SCREENSHOTS) {
          await page.screenshot({ path: `${process.env.GATE_SCREENSHOTS}/empty.png` });
        }
      },
    );
    const connectTab = await b.context.newPage();
    await connectTab.goto(`${lib}/-/connect`);
    await connectTab.getByText("No agent has written yet").waitFor({ timeout: 15_000 });

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
      connectTab.locator("#status", { hasText: /^Last agent write: / }).waitFor({ timeout: 5000 }),
    );
    await step("the empty library's home fills in live after the first write", async () => {
      // The smoke flow writes and tidies away its note, so the library is empty again: the
      // waiting line has become the agent's last write.
      await waiting.locator(".empty-wait", { hasText: /^Last write by / }).waitFor({
        timeout: 10_000,
      });
      if ((await waiting.locator(".change-dot.live").count()) > 0) {
        throw new Error("the home still waits for the first write");
      }
      await connectTab.close();
    });
    /** A link in the avatar's menu (take 2: the account's pages live there). */
    const accountLink = async (name: string) => {
      await page.getByRole("button", { name: "Account menu" }).click();
      await page.locator(".menu-list").getByRole("link", { name, exact: true }).click();
    };
    /**
     * A library view: For agents by its URL (the home's foot line links it once agents have
     * housekeeping); a settings tab from the settings' sidebar, reached through the switcher's
     * menu (take 4) unless the settings are already open.
     */
    const libraryLink = async (name: string) => {
      if (name === "For agents") {
        await page.goto(`${lib}/-/work`);
        await page.waitForURL(`${lib}/-/work`);
        return;
      }
      const tab = page.locator(".ws-sidebar").getByRole("link", { name, exact: true });
      if ((await tab.count()) === 0) {
        await page.getByRole("button", { name: /, switch library$/ }).click();
        await page
          .locator(".menu-list")
          .getByRole("link", { name: /settings$/ })
          .click();
        await tab.waitFor({ timeout: 15_000 });
      }
      await tab.click();
    };
    // Agents (2026-10-23): the connected app and tokens in one list, New token in the compose
    // dialog, the secret shown once in a dialog after.
    await step("Agents lists the connected app, from the avatar menu", async () => {
      await accountLink("Agents");
      await page.waitForURL(`${base}/agents`);
      await page.getByRole("cell", { name: /Gate/ }).waitFor({ timeout: 15_000 });
      await page
        .getByText(/^App · connected/)
        .first()
        .waitFor();
    });
    await step("tokens: create one from New token, see it once, revoke it", async () => {
      await page.getByRole("button", { name: "New token", exact: true }).click();
      const compose = page.getByRole("dialog", { name: "New token" });
      await compose.getByRole("textbox", { name: "Name", exact: true }).fill("process:gate");
      await compose.getByRole("button", { name: "Create token" }).click();
      const created = page.getByRole("dialog", { name: "Token created" });
      await created.locator("#token-secret").waitFor({ timeout: 15_000 });
      await created.getByRole("button", { name: "Done" }).click();
      await created.waitFor({ state: "hidden", timeout: 5000 });
      // Revoking asks first (S-4).
      const row = page.getByRole("row", { name: /process:gate/ });
      await row.getByRole("button", { name: "Revoke…" }).click();
      await page.locator("dialog").getByRole("button", { name: "Revoke", exact: true }).click();
      await row.getByText("revoked").waitFor({ timeout: 15_000 });
    });
    await step("account page", async () => {
      await accountLink("Account");
      await page.getByText("this device").waitFor({ timeout: 15_000 });
    });
    // Off a library, Ctrl/Cmd+K searches the person's libraries (TEMPRA-127); Ctrl/Cmd+\ leaves
    // the account's sidebar alone (only a library's own sidebar hides).
    await step("account pages: Ctrl+K finds a library, Ctrl+\\ keeps the sidebar", async () => {
      await page.keyboard.press("Control+\\");
      await page.waitForTimeout(200);
      if (!(await page.locator("section.ws-sidebar").isVisible())) {
        throw new Error("Ctrl+\\ hid the account's sidebar");
      }
      await page.keyboard.press("Control+k");
      const dialog = page.getByRole("dialog", { name: "Search libraries" });
      const box = dialog.getByRole("combobox");
      await box.waitFor({ timeout: 5000 });
      await box.fill("notes");
      await dialog.locator('[role="option"]').first().waitFor({ timeout: 5000 });
      await box.press("Enter");
      await page.waitForURL(`${lib}/`);
    });
    for (const [tab, text] of [
      ["For agents", "For agents"],
      ["Import & export", "Nightly exports"],
      ["Recovery", "Past restores"],
    ] as const) {
      await step(`library tab ${tab}`, async () => {
        await page.goto(`${lib}/`);
        await libraryLink(tab);
        // On the page: the phone's top bar (hidden here) names the page too.
        await page.locator(".ws-main").getByText(text).first().waitFor({ timeout: 15_000 });
      });
    }
    await step("export now, from Import & export", async () => {
      await libraryLink("Import & export");
      await page.getByRole("button", { name: "Export now" }).click();
      await page.getByText("Export saved").waitFor({ timeout: 15_000 });
    });

    // Sharing in the app (tempra-dev: v2/sharing): invite from the Members tab; the invitee
    // accepts from Invitations; as a reader there is no Verify, at write there is.
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
    // From the Inbox (TEMPRA-130, A-2): Accept adds the library to the person's list at once
    // (the sidebar, the switcher), and Open goes there, in place (a shared library, F-2).
    await step("the invitee accepts from the Inbox and opens the library", async () => {
      await context.clearCookies();
      await b.signInAs("stranger@localhost", "/inbox");
      const href = new URL(`${lib}/`).pathname;
      const listed = page.locator(`nav[aria-label="Shared with you"] a[href="${href}"]`);
      if ((await listed.count()) > 0) throw new Error("listed before accepting");
      await page
        .locator("main.ws-main li.inbox-row")
        .filter({ hasText: "Invitation" })
        .getByRole("button", { name: "Accept", exact: true })
        .click();
      await listed.waitFor({ timeout: 15_000 });
      await page.evaluate("window.__gateStay = true");
      await page
        .locator("main.ws-main .notice")
        .getByRole("link", { name: "Open", exact: true })
        .click();
      await page.waitForURL(`${lib}/`, { timeout: 15_000 });
      if (!(await page.evaluate("window.__gateStay === true"))) {
        throw new Error("Open reloaded the app");
      }
      await page.getByRole("button", { name: /, switch library$/ }).click();
      await page.locator(`.menu-list a.menu-lib[href="${href}"]`).waitFor({ timeout: 5000 });
      await page.keyboard.press("Escape");
      asInvitee = await context.cookies();
    });
    // H-11: a read member on an empty library is not offered what only writers can do.
    await step("a read member's empty library says only that nothing is here yet", async () => {
      const empty = page.locator("main.ws-main .empty-library");
      await empty.getByRole("heading", { name: "Nothing here yet" }).waitFor({ timeout: 15_000 });
      await empty.getByText("Pages appear here when an agent writes them.").waitFor();
      for (const gone of [".copy-field", ".empty-steps"]) {
        if ((await empty.locator(gone).count()) > 0) throw new Error(`a reader is shown ${gone}`);
      }
      for (const link of ["Import a bundle", "Other ways to connect"]) {
        if ((await page.getByRole("link", { name: link }).count()) > 0) {
          throw new Error(`a reader is offered ${link}`);
        }
      }
      await page
        .locator("section.ws-sidebar .tree-note", { hasText: "No pages yet." })
        .waitFor({ timeout: 10_000 });
      if (process.env.GATE_SCREENSHOTS) {
        await page.screenshot({ path: `${process.env.GATE_SCREENSHOTS}/empty-reader.png` });
      }
    });
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
    /** Opens the open concept's Properties (TEMPRA-122: a page nobody checked shows only Mark
     * as checked there, to a write member). */
    const properties = async () => {
      await page.locator(".byline").waitFor({ timeout: 15_000 });
      await page.getByRole("button", { name: "More", exact: true }).click();
      await page.locator(".menu-list").getByRole("button", { name: "Properties" }).click();
      const panel = page.locator("aside#panel-properties.concept-panel");
      await panel.waitFor({ timeout: 15_000 });
      return panel;
    };
    await step("a reader sees the note and no Mark as checked", async () => {
      await page.goto(`${lib}/shared.md`);
      await page.getByText("Read me.").waitFor({ timeout: 15_000 });
      const panel = await properties();
      await panel.getByText("Linked from").waitFor({ timeout: 15_000 });
      // The role loads with the library list; give it the moment it takes.
      await page.waitForTimeout(500);
      if ((await panel.getByRole("region", { name: "Check" }).count()) !== 0) {
        throw new Error("a read member is offered a check");
      }
      if ((await panel.getByText(/verif/i).count()) !== 0)
        throw new Error("Properties says verify");
      // Review mode says nobody has checked it, and offers a reader nothing but Done.
      await page.goto(`${lib}/shared.md?review=1`);
      await page
        .getByRole("region", { name: "Review" })
        .getByText("Nobody has checked this page yet")
        .waitFor({ timeout: 15_000 });
      await page.waitForTimeout(500);
      const check = await page.getByRole("button", { name: "Mark as checked" }).count();
      if (check !== 0) throw new Error("a read member is offered Mark as checked");
    });
    await step("the owner gives the member write access", async () => {
      await switchTo(asOwner);
      await page.goto(`${lib}/-/members`);
      await page.getByLabel("Access for @stranger").selectOption("write");
      // A change of access asks first (S-4).
      await page.locator("dialog").getByRole("button", { name: "Change access" }).click();
      await page.getByText("@stranger now has write access").waitFor({ timeout: 15_000 });
    });
    await step("a writer is offered Mark as checked", async () => {
      await switchTo(asInvitee);
      await page.goto(`${lib}/shared.md`);
      const panel = await properties();
      await panel
        .getByRole("region", { name: "Check" })
        .getByRole("button", { name: "Mark as checked" })
        .waitFor({ timeout: 15_000 });
    });
    // Deleting the library wipes its Durable Object and ends the connection.
    await step("delete the library from its Delete tab", async () => {
      await switchTo(asOwner);
      await page.goto(`${lib}/`);
      await libraryLink("Delete library");
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

/**
 * The per-account cap on open feed sockets (TEMPRA-80), end to end: one account's token opens
 * sockets until one is refused, which must be with FEED_FULL, at the cap at most (the leases the
 * gate's own browser and agents took in the last minute still count).
 */
async function feedCap(owner: string, slug: string, token: string): Promise<string[]> {
  const url = `${base.replace(/^http/, "ws")}/api/v1/libraries/${owner}/${slug}/feed`;
  const open: WebSocket[] = [];
  const problems: string[] = [];
  try {
    for (let i = 0; i < FEED_SOCKETS_PER_ACCOUNT + 5; i++) {
      const ws = new WebSocket(url, {
        headers: { Authorization: `Bearer ${token}` },
      } as unknown as string[]);
      const outcome = await within(
        10_000,
        `feed socket ${i + 1}`,
        new Promise<"open" | number>((resolve) => {
          ws.onmessage = () => resolve("open");
          ws.onclose = (e) => resolve(e.code);
        }),
      );
      if (outcome === "open") {
        open.push(ws);
        continue;
      }
      if (outcome !== FEED_FULL) problems.push(`socket ${i + 1} closed with ${outcome}`);
      // The scripted agents' sockets of the last minute still hold places, so only the upper
      // bound is exact here; feed-leases.test.ts checks the count itself.
      if (open.length > FEED_SOCKETS_PER_ACCOUNT || open.length === 0) {
        problems.push(
          `refused after ${open.length} sockets; the cap is ${FEED_SOCKETS_PER_ACCOUNT}`,
        );
      }
      console.log(
        `  feed sockets: refused with ${outcome} after ${open.length} (account cap ${FEED_SOCKETS_PER_ACCOUNT}, library cap ${FEED_SOCKETS_PER_LIBRARY})`,
      );
      return problems;
    }
    problems.push(`${open.length} sockets opened and none was refused`);
    return problems;
  } finally {
    for (const ws of open) ws.close(1000, "done");
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
  // The daily blob sweep and digest (v2 spec: A3), run through cf dev's scheduled handler; its
  // recounts go through the local queue (TEMPRA-81) until the sweep is no longer held.
  const sweepProblems = await blobSweep();
  console.log(
    `${sweepProblems.length === 0 ? "PASS" : "FAIL"} the daily sweep runs, its recounts land through the queue, and deletion is no longer held`,
  );
  for (const p of sweepProblems) console.log(`  - ${p}`);
  if (sweepProblems.length > 0) failed = true;
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
  // Last: the leases it takes keep counting for a minute after its sockets close.
  const cap = first ? await feedCap(first.owner, first.slug, first.token) : ["no library"];
  console.log(
    `${cap.length === 0 ? "PASS" : "FAIL"} a socket past the account's feed cap is refused`,
  );
  for (const p of cap) console.log(`  - ${p}`);
  if (cap.length > 0) failed = true;
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
