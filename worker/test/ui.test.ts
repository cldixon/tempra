import { describe, expect, test } from "bun:test";
import * as app from "@tempra/app";
import * as design from "@tempra/design";
import { linkTarget, renderBody } from "../src/ui/markdown";
import { API, setup } from "./harness";

type S = ReturnType<typeof setup>;

async function put(s: S, path: string, content: string, note = "test") {
  const r = await s.req(`/files/${path}`, {
    method: "PUT",
    headers: { "Content-Type": "text/markdown", "X-Note": note },
    body: content,
  });
  expect(r.status).toBeLessThan(300);
  return r;
}

async function page(s: S, path: string) {
  const r = await s.app.request(path);
  return { status: r.status, html: await r.text(), headers: r.headers };
}

const LIB = "/owner/demo";

describe("markdown rendering for the UI", () => {
  const opts = {
    url: (t: string) => {
      const l = linkTarget("a/b.md", t);
      if (!l) return null;
      return l.kind === "internal" ? `/ui/${l.path}${l.anchor ?? ""}` : l.href;
    },
    footnote: (label: string, defined: boolean) => (defined ? `#fn-${label}` : null),
  };

  test("never renders raw HTML or unsafe URLs", () => {
    const { html } = renderBody(
      [
        "<script>alert(1)</script>",
        "",
        'Hi <img src=x onerror="alert(1)"> [bad](javascript:alert(1)) [data](data:text/html,x)',
        "",
        "[ok](https://e.com) [rel](../c.md#h) ![pic](p.png)",
      ].join("\n"),
      opts,
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain('<img src="x"');
    expect(html).toContain("&#x3C;script>");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("data:text");
    expect(html).toContain('href="https://e.com" rel="noopener noreferrer nofollow"');
    expect(html).toContain('href="/ui/c.md#h"');
    expect(html).toContain('src="/ui/a/p.png"');
  });

  test("tables, heading anchors and footnotes", () => {
    const r = renderBody(
      "# Schema\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n# Schema\n\nClaim.[^s] Loose.[^x]\n\n[^s]: The **standard**\n",
      opts,
    );
    expect(r.html).toContain('<h1 id="schema">');
    expect(r.html).toContain('<h1 id="schema-1">');
    expect(r.html).toContain("<table>");
    expect(r.html).toContain('<sup class="fnref"><a href="#fn-s">[s]</a></sup>');
    // Without a definition GFM keeps it as text, as any renderer would; lint flags it.
    expect(r.html).toContain("Loose.[^x]");
    expect(r.footnotes.get("s")).toContain("<strong>standard</strong>");
  });
});

/** The JSON the app reads, as the signed-in owner (session cookie). */
async function get<T>(s: S, path: string): Promise<T> {
  const r = await s.app.request(`${API}${path}`, { headers: { Accept: "application/json" } });
  expect(r.status).toBe(200);
  return (await r.json()) as T;
}

type Rendered = {
  kind: string;
  path: string;
  head: number;
  html: string;
  footnotes: Record<string, string>;
  sources: { sources: { id?: string; cited?: number; title?: string }[] };
  media?: string;
};

describe("the app's pages (TEMPRA-9)", () => {
  test("every rebuilt page is the app's shell, at its old URL", async () => {
    const s = setup();
    await put(s, "notes/a.md", "---\ntype: Note\n---\nA.\n");
    for (const path of [
      "/",
      `${LIB}/`,
      `${LIB}/notes/`,
      `${LIB}/-/tree/notes/`,
      `${LIB}/notes/a.md`,
      `${LIB}/-/files/notes/a.md`,
      `${LIB}/-/ledger?actor=x`,
      `${LIB}/-/diff/notes/a.md?from=0`,
    ]) {
      const r = await page(s, path);
      expect(r.status).toBe(200);
      expect(r.html).toContain(`<script type="module" src="${app.href}"></script>`);
      expect(r.html).toContain(`<link rel="stylesheet" href="${design.href}">`);
      expect(r.html).toContain('<div id="root"></div>');
      const csp = r.headers.get("Content-Security-Policy") ?? "";
      expect(csp).toContain("script-src 'self';");
      expect(csp).toMatch(/style-src 'self' 'nonce-[A-Za-z0-9+/=]+';/);
      expect(csp).toContain("connect-src 'self'");
      expect(r.headers.get("Cache-Control")).toBe("no-store");
    }
    // No inline scripts, and a fresh nonce on every response.
    const one = await page(s, "/");
    expect(one.html).not.toMatch(/<script(?![^>]*\bsrc=)/);
    const two = await page(s, "/");
    expect(one.headers.get("Content-Security-Policy")).not.toBe(
      two.headers.get("Content-Security-Policy"),
    );
    // Server pages not rebuilt yet stay as they were.
    expect((await page(s, `${LIB}/-/work`)).html).toContain("<h1>Work queue</h1>");
  });

  test("the bundle is served at its hashed path, immutable; any other name is a 404", async () => {
    const s = setup();
    const r = await s.anon.request(app.href);
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type")).toContain("text/javascript");
    expect(r.headers.get("Cache-Control")).toContain("immutable");
    expect(await r.text()).toBe(app.js);
    expect((await s.anon.request("/_app/app.000000000000.js")).status).toBe(404);
  });

  test("pages require sign-in, and a library the person cannot open is a 404", async () => {
    const s = setup();
    const r = await s.anon.request(`${LIB}/a.md?at=1`);
    expect(r.status).toBe(302);
    expect(r.headers.get("Location")).toBe(
      `/sign-in?next=${encodeURIComponent(`${LIB}/a.md?at=1`)}`,
    );
    const post = await s.anon.request(`${LIB}/-/verify/a.md`, {
      method: "POST",
      headers: { Origin: "http://localhost" },
    });
    expect(post.status).toBe(401);
    expect((await page(s, "/owner/other/")).status).toBe(404);
    expect((await page(s, "/owner/other/a.md")).status).toBe(404);
  });

  test("render: a concept's body with links to UI pages and footnotes to its sources", async () => {
    const s = setup();
    await put(s, "policies/margin.md", "---\ntype: Policy\ntitle: Margin Standard\n---\nRules.\n");
    await put(
      s,
      "metrics/gross-margin.md",
      [
        "---",
        "type: Metric",
        "title: Gross <Margin>",
        "sources:",
        "  - { id: std, resource: /policies/margin.md, title: Margin Standard }",
        "  - { id: web, resource: https://e.com/doc }",
        "---",
        "Uses [the policy](/policies/margin.md) and [missing](/nope.md).[^std] Also [^web] and [^x].",
        "",
        "[^std]: FY2026 standard",
        "",
        "[^x]: An aside",
        "",
      ].join("\n"),
    );
    const c = await get<Rendered>(s, "/render/metrics/gross-margin.md");
    expect(c.kind).toBe("concept");
    expect(c.html).toContain(`href="${LIB}/policies/margin.md"`);
    expect(c.html).toContain('<a href="#src-std">[std]</a>');
    expect(c.html).toContain('<a href="#fn-x">[x]</a>');
    expect(c.footnotes).toEqual({ std: "<p>FY2026 standard</p>", x: "<p>An aside</p>" });
    expect(c.sources.sources.find((x) => x.id === "std")).toMatchObject({ cited: 1 });
    expect(c.html).not.toContain("<script");

    const links = await get<{ broken: { raw: string }[] }>(s, "/links/metrics/gross-margin.md");
    expect(links.broken.map((b) => b.raw)).toContain("/nope.md");
    const policy = await get<{ inbound: { path: string; kind: string }[] }>(
      s,
      "/links/policies/margin.md",
    );
    expect(policy.inbound).toContainEqual(
      expect.objectContaining({ path: "metrics/gross-margin.md", kind: "source" }),
    );
  });

  test("render: a leading heading that repeats the title is not shown twice", async () => {
    const s = setup();
    await put(
      s,
      "a.md",
      "---\ntype: Note\ntitle: Alpha\n---\n# Alpha\n\nBody text.\n\n# Alpha again\n",
    );
    const c = await get<Rendered>(s, "/render/a.md");
    expect(c.html).not.toContain('<h1 id="alpha">');
    expect(c.html).toContain("Alpha again");
    expect(c.html).toContain("Body text.");
  });

  test("render: time travel with ?at, links on a pinned page stay pinned", async () => {
    const s = setup();
    await put(s, "a.md", "---\ntype: Note\n---\nFirst [b](/b.md).\n");
    const { hash, seq } = await get<{ hash: string; seq: number }>(s, "/files/a.md");
    await s.req("/files/a.md", {
      method: "PUT",
      headers: { "Content-Type": "text/markdown", "If-Match": `"${hash}"` },
      body: "---\ntype: Note\n---\nSecond words.\n",
    });
    const now = await get<Rendered>(s, "/render/a.md");
    expect(now.html).toContain("Second words.");
    const then = await get<Rendered>(s, `/render/a.md?at=${seq}`);
    expect(then.html).toContain("First");
    expect(then.html).toContain(`href="${LIB}/b.md?at=${seq}"`);
    expect(then.head).toBeGreaterThan(seq);
    const raw = await s.app.request(`${LIB}/-/raw/a.md?at=${seq}`);
    expect(raw.headers.get("Content-Type")).toContain("text/plain");
    expect(await raw.text()).toContain("First");
  });

  test("render: attachments, synthesized files and missing files", async () => {
    const s = setup();
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const up = await s.req("/files/img/logo.png", {
      method: "PUT",
      headers: { "Content-Type": "image/png" },
      body: png,
    });
    expect(up.status).toBeLessThan(300);
    expect(await get<Rendered>(s, "/render/img/logo.png")).toMatchObject({
      kind: "attachment",
      media: "image/png",
      size: 8,
    });
    const dl = await s.app.request(`${LIB}/-/download/img/logo.png`, { redirect: "manual" });
    expect(dl.status).toBe(302);
    const bytes = await s.app.request(dl.headers.get("Location") ?? "");
    expect(new Uint8Array(await bytes.arrayBuffer())).toEqual(png);

    const index = await s.app.request(`${LIB}/img/index.md`, { redirect: "manual" });
    expect(index.headers.get("Location")).toBe(`${LIB}/img/`);
    expect((await get<Rendered>(s, "/render/log.md")).kind).toBe("derived");
    expect((await s.app.request(`${API}/render/nope.md`)).status).toBe(404);
  });
});

async function json<T>(r: Response): Promise<T> {
  return (await r.json()) as T;
}

async function hashOf(s: S, path: string) {
  const r = await s.req(`/files/${path}`, { headers: { Accept: "application/json" } });
  return (await json<{ hash: string; seq: number }>(r)).hash;
}

async function submit(
  s: S,
  path: string,
  fields: Record<string, string>,
  origin = "http://localhost",
) {
  return s.app.request(path, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
    redirect: "manual",
  });
}

type Requests = { requests: { request_id: string; actor: string; note: string | null }[] };

describe("history, ledger and revert (Phase 3, slice 2)", () => {
  test("diffs between versions", async () => {
    const s = setup();
    await put(s, "a.md", "---\ntype: Note\n---\nOne.\n", "first");
    await s.req("/files/a.md", {
      method: "PUT",
      headers: { "Content-Type": "text/markdown", "If-Match": `"${await hashOf(s, "a.md")}"` },
      body: "---\ntype: Note\n---\nTwo.\n",
    });
    const d = await get<{ diff: string }>(s, "/diff?path=a.md");
    expect(d.diff).toContain("-One.");
    expect(d.diff).toContain("+Two.");
  });

  test("the ledger lists requests with filters", async () => {
    const s = setup();
    await put(s, "notes/a.md", "---\ntype: Note\n---\nA\n", "add a");
    await put(s, "other/b.md", "---\ntype: Note\n---\nB\n", "add b");
    const notes = async (q: string) =>
      (await get<Requests>(s, `/requests${q}`)).requests.map((r) => r.note);
    expect(await notes("")).toEqual(["add b", "add a"]);
    expect(await notes("?prefix=notes")).toEqual(["add a"]);
    expect(await notes("?actor=someone/else")).toEqual([]);
    const today = new Date().toISOString().slice(0, 10);
    expect(await notes(`?from=${today}&to=${today}`)).toContain("add a");
    expect(await notes("?to=2000-01-01")).toEqual([]);
    expect((await s.app.request(`${API}/requests?from=yesterday`)).status).toBe(400);
  });

  test("revert a request from the ledger, attributed to the signed-in human", async () => {
    const s = setup();
    await put(s, "a.md", "---\ntype: Note\n---\nGood.\n", "good version");
    await s.req("/files/a.md", {
      method: "PUT",
      headers: {
        "Content-Type": "text/markdown",
        "If-Match": `"${await hashOf(s, "a.md")}"`,
        "X-Note": "bad edit",
      },
      body: "---\ntype: Note\n---\nBad.\n",
    });
    const bad = (await get<Requests>(s, "/requests")).requests[0];
    const revertUrl = `${LIB}/-/revert/${bad?.request_id}`;
    const confirm = await page(s, revertUrl);
    expect(confirm.html).toContain("Revert this request?");
    expect(confirm.html).toContain("bad edit");
    expect(confirm.html).toContain('<span class="add">+Bad.</span>');

    const forged = await submit(s, revertUrl, { note: "x" }, "https://evil.example");
    expect(forged.status).toBe(403);
    expect(await s.store().read("a.md")).toMatchObject({ body: "Bad.\n" });

    const done = await submit(s, revertUrl, { note: "undo the bad edit" });
    expect(done.status).toBe(303);
    expect(done.headers.get("Location")).toBe(`${LIB}/-/ledger?done=revert&n=1`);
    expect(s.store().read("a.md")).toMatchObject({ body: "Good.\n" });
    expect((await get<Requests>(s, "/requests")).requests[0]).toMatchObject({
      actor: "human:owner",
      note: "undo the bad edit",
    });
  });

  test("restore one file to an earlier version", async () => {
    const s = setup();
    await put(s, "a.md", "---\ntype: Note\n---\nFirst.\n");
    const first = (await get<{ seq: number }>(s, "/files/a.md")).seq;
    await s.req("/files/a.md", {
      method: "PUT",
      headers: { "Content-Type": "text/markdown", "If-Match": `"${await hashOf(s, "a.md")}"` },
      body: "---\ntype: Note\n---\nSecond.\n",
    });
    const confirm = await page(s, `${LIB}/-/restore/a.md?to=${first}`);
    expect(confirm.html).toContain('<span class="add">+First.</span>');
    const done = await submit(s, `${LIB}/-/restore/a.md?to=${first}`, { note: "back to first" });
    expect(done.status).toBe(303);
    expect(done.headers.get("Location")).toBe(`${LIB}/a.md?done=restore`);
    expect(s.store().read("a.md")).toMatchObject({ body: "First.\n" });
  });
});

describe("the shared design stylesheet", () => {
  test("served at its hashed path, immutable; any other name is a 404", async () => {
    const s = setup();
    const r = await s.anon.request(design.href);
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type")).toContain("text/css");
    expect(r.headers.get("Cache-Control")).toContain("immutable");
    expect(await r.text()).toBe(design.css);
    expect((await s.anon.request("/_design/tempra.000000000000.css")).status).toBe(404);
  });

  test("every page links it and its CSP allows it", async () => {
    const s = setup();
    for (const [client, path] of [
      [s.app, "/"],
      [s.anon, "/sign-in"],
      [s.anon, "/privacy"],
    ] as const) {
      const r = await client.request(path);
      expect(r.status).toBe(200);
      expect(await r.text()).toContain(`<link rel="stylesheet" href="${design.href}">`);
      expect(r.headers.get("Content-Security-Policy")).toContain("style-src 'self'");
    }
  });
});
