import { describe, expect, test } from "bun:test";
import * as app from "@tempra/app";
import * as design from "@tempra/design";
import { API, setup } from "./harness";

/** A one-paragraph body as the API returns it, for toMatchObject (block IDs aside). */
const says = (text: string) => ({
  doc: {
    type: "root",
    children: [{ type: "paragraph", children: [{ type: "text", value: text }] }],
  },
});

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
      `${LIB}/-/work?kind=stale`,
      `${LIB}/-/needs`,
      `${LIB}/-/activity`,
      `${LIB}/-/revert/some-request`,
      `${LIB}/-/restore/notes/a.md?to=1`,
      `${LIB}/-/transfer`,
      `${LIB}/-/recovery`,
      `${LIB}/-/connect`,
      `${LIB}/-/delete`,
      "/welcome",
      "/connect",
      "/tokens",
      "/apps",
      "/account",
      "/inbox",
    ]) {
      const r = await page(s, path);
      expect(r.status).toBe(200);
      expect(r.html).toContain(`<script type="module" src="${app.href}"></script>`);
      expect(r.html).toContain(`<link rel="stylesheet" href="${design.href}">`);
      expect(r.html).toContain('<div id="root"></div>');
      const csp = r.headers.get("Content-Security-Policy") ?? "";
      expect(csp).toContain("script-src 'self';");
      // Styles from this origin only: no nonce, no inline styles (TEMPRA-99).
      expect(csp).toContain("style-src 'self';");
      expect(csp).not.toContain("nonce");
      expect(csp).toContain("connect-src 'self'");
      expect(r.headers.get("Cache-Control")).toBe("no-store");
    }
    // No inline scripts or styles.
    const one = await page(s, "/");
    expect(one.html).not.toMatch(/<script(?![^>]*\bsrc=)/);
    expect(one.html).not.toMatch(/<style|\sstyle=/);
  });

  test("the bundle is served at its hashed path, immutable; any other name is a 404", async () => {
    const s = setup();
    const r = await s.anon.request(app.href);
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type")).toContain("text/javascript");
    expect(r.headers.get("Cache-Control")).toContain("immutable");
    expect(await r.text()).toBe(app.js);
    expect((await s.anon.request("/_app/app.000000000000.js")).status).toBe(404);
    // The chunks it imports on demand (Pele, for diagrams) sit beside it, immutable too.
    const [name, js] = Object.entries(app.chunks).find(([n]) => n.startsWith("pele-")) ?? [];
    expect(app.js).toContain(`./${name}`);
    const c = await s.anon.request(`/_app/${name}`);
    expect(c.status).toBe(200);
    expect(c.headers.get("Cache-Control")).toContain("immutable");
    expect(await c.text()).toBe(js ?? "");
    expect((await s.anon.request("/_app/toString")).status).toBe(404);
    expect((await s.anon.request("/_app/pele-000000.js")).status).toBe(404);
  });

  test("pages require sign-in, and a library the person cannot open is a 404", async () => {
    const s = setup();
    const r = await s.anon.request(`${LIB}/a.md?at=1`);
    expect(r.status).toBe(302);
    expect(r.headers.get("Location")).toBe(
      `/sign-in?next=${encodeURIComponent(`${LIB}/a.md?at=1`)}`,
    );
    // The actions are the API's: no session, no write.
    const post = await s.anon.request(`${API}/verify/a.md`, {
      method: "POST",
      headers: { Origin: "http://localhost" },
    });
    expect(post.status).toBe(401);
    // The old form posts are gone.
    expect(
      (
        await s.app.request(`${LIB}/-/verify/a.md`, {
          method: "POST",
          headers: { Origin: "http://localhost" },
        })
      ).status,
    ).toBe(404);
    expect((await page(s, "/owner/other/")).status).toBe(404);
    expect((await page(s, "/owner/other/a.md")).status).toBe(404);
    expect((await page(s, "/owner/other/-/work")).status).toBe(404);
    const stranger = await s.stranger();
    for (const path of [`${LIB}/`, `${LIB}/-/delete`, `${LIB}/-/recovery`, `${LIB}/-/revert/x`]) {
      expect((await stranger.app.request(path)).status).toBe(404);
    }
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
    // A concept: frontmatter and the body as a tree, at any sequence.
    expect(await get(s, "/files/a.md")).toMatchObject({
      kind: "concept",
      ...says("Second words."),
    });
    expect(await get(s, `/files/a.md?at=${seq}`)).toMatchObject(says("First words."));
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

describe("Activity's Download (TEMPRA-115)", () => {
  test("the ledger as JSON lines, every event in order, as a download", async () => {
    const s = setup();
    for (let i = 0; i < 3; i++) {
      await put(s, `d${i}.md`, `---\ntype: Note\ntitle: D${i}\n---\nWords ${i}.\n`, `note ${i}`);
    }
    const r = await s.app.request(`${LIB}/-/ledger.jsonl`);
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type")).toBe("application/x-ndjson");
    expect(r.headers.get("Content-Disposition")).toContain("attachment");
    const lines = (await r.text()).trimEnd().split("\n");
    const events = lines.map((l) => JSON.parse(l) as { t: string; seq: number; path: string });
    expect(events.every((e) => e.t === "event")).toBe(true);
    const seqs = events.map((e) => e.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(events.map((e) => e.path)).toEqual(expect.arrayContaining(["d0.md", "d1.md", "d2.md"]));
    // Signed out, it is a sign-in page or a 404, never the ledger.
    const anon = await s.anon.request(`${LIB}/-/ledger.jsonl`, { redirect: "manual" });
    expect(anon.status).not.toBe(200);
  });
});

async function json<T>(r: Response): Promise<T> {
  return (await r.json()) as T;
}

async function hashOf(s: S, path: string) {
  const r = await s.req(`/files/${path}`, { headers: { Accept: "application/json" } });
  return (await json<{ hash: string; seq: number }>(r)).hash;
}

/** A write through the API as the signed-in owner, from this site's pages unless `origin` says. */
async function send(s: S, path: string, body: unknown, origin = "http://localhost") {
  return s.app.request(`${API}${path}`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
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
    expect(bad?.note).toBe("bad edit");
    // The confirmation page is the app's; it reads the request and its diff from the API.
    expect((await page(s, `${LIB}/-/revert/${bad?.request_id}`)).html).toContain(
      '<div id="root"></div>',
    );
    const ids = (await get<Requests>(s, "/requests")).requests.map((r) => r.request_id);
    expect(ids).toContain(bad?.request_id as string);

    const target = { request_id: bad?.request_id, note: "x" };
    const forged = await send(s, "/revert", target, "https://evil.example");
    expect(forged.status).toBe(403);
    expect(await s.store().read("a.md")).toMatchObject(says("Bad."));

    const done = await send(s, "/revert", {
      request_id: bad?.request_id,
      note: "undo the bad edit",
    });
    expect(done.status).toBe(200);
    expect(s.store().read("a.md")).toMatchObject(says("Good."));
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
    expect((await page(s, `${LIB}/-/restore/a.md?to=${first}`)).status).toBe(200);
    const d = await get<{ diff: string }>(s, `/diff?path=a.md&from=${first}`);
    expect(d.diff).toContain("+Second.");
    const done = await send(s, "/revert", { path: "a.md", to_seq: first, note: "back to first" });
    expect(done.status).toBe(200);
    expect(s.store().read("a.md")).toMatchObject(says("First."));
    expect((await get<Requests>(s, "/requests")).requests[0]).toMatchObject({
      actor: "human:owner",
      note: "back to first",
    });
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

  test("every page links it and its CSP allows it: the shell and the server's own pages", async () => {
    const s = setup();
    // An app asking for consent, so /authorize draws its page.
    const reg = await s.anon.request("/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "Claude",
        redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      }),
    });
    const { client_id } = (await reg.json()) as { client_id: string };
    const consent = `/authorize?${new URLSearchParams({
      response_type: "code",
      client_id,
      redirect_uri: "https://claude.ai/api/mcp/auth_callback",
      scope: "okf:read",
      state: "st4te",
      code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
      code_challenge_method: "S256",
      resource: "http://localhost/mcp",
    })}`;
    for (const [client, path] of [
      [s.app, "/"],
      [s.app, "/account"],
      [s.anon, "/sign-in"],
      [s.app, consent],
      [s.app, "/account/email/confirm?t=x"],
    ] as const) {
      const r = await client.request(path);
      expect(r.status).toBe(200);
      expect(await r.text()).toContain(`<link rel="stylesheet" href="${design.href}">`);
      expect(r.headers.get("Content-Security-Policy")).toContain("style-src 'self'");
    }
  });
});
