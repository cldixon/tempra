import { describe, expect, test } from "bun:test";
import * as app from "@tempra/app";
import * as design from "@tempra/design";
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

/** The JSON the app reads, as the signed-in owner (session cookie). */
async function get<T = unknown>(s: S, path: string): Promise<T> {
  const r = await s.app.request(`${API}${path}`, { headers: { Accept: "application/json" } });
  expect(r.status).toBe(200);
  return (await r.json()) as T;
}

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

  test("files as JSON describe every kind of file, as the app reads them", async () => {
    const s = setup();
    await put(s, "a.md", "---\ntype: Note\ntitle: A\n---\nFirst words.\n");
    const { hash, seq } = await get<{ hash: string; seq: number }>(s, "/files/a.md");
    await s.req("/files/a.md", {
      method: "PUT",
      headers: { "Content-Type": "text/markdown", "If-Match": `"${hash}"` },
      body: "---\ntype: Note\ntitle: A\n---\nSecond words.\n",
    });
    // A concept: frontmatter and the markdown body the reader parses, at any sequence.
    expect(await get(s, "/files/a.md")).toMatchObject({ kind: "concept", body: "Second words.\n" });
    expect(await get(s, `/files/a.md?at=${seq}`)).toMatchObject({ body: "First words.\n" });
    // An attachment: its description, not its bytes.
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const up = await s.req("/files/img/logo.png", {
      method: "PUT",
      headers: { "Content-Type": "image/png" },
      body: png,
    });
    expect(up.status).toBeLessThan(300);
    expect(await get(s, "/files/img/logo.png")).toMatchObject({
      kind: "attachment",
      path: "img/logo.png",
      media: "image/png",
      size: 8,
    });
    const bytes = await s.app.request(`${API}/files/img/logo.png`);
    expect(new Uint8Array(await bytes.arrayBuffer())).toEqual(png);
    const dl = await s.app.request(`${LIB}/-/download/img/logo.png`, { redirect: "manual" });
    expect(dl.status).toBe(302);
    // A synthesized file: its markdown.
    expect(await get(s, "/files/log.md")).toMatchObject({ kind: "derived", path: "log.md" });
    // index.md is the directory's page; a missing file is a 404.
    const index = await s.app.request(`${LIB}/img/index.md`, { redirect: "manual" });
    expect(index.headers.get("Location")).toBe(`${LIB}/img/`);
    expect(
      (await s.app.request(`${API}/files/nope.md`, { headers: { Accept: "application/json" } }))
        .status,
    ).toBe(404);
    // The raw source, as an export writes it.
    const raw = await s.app.request(`${LIB}/-/raw/a.md?at=${seq}`);
    expect(raw.headers.get("Content-Type")).toContain("text/plain");
    expect(await raw.text()).toContain("First words.");
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
