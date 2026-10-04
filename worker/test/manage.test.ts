import { describe, expect, test } from "bun:test";
import { readTar, writeTar } from "../src/util/tar";
import { API, ORIGIN, setup } from "./harness";

type S = ReturnType<typeof setup>;
const LIB = "/owner/demo";

async function page(s: S, path: string) {
  const r = await s.app.request(path);
  return { status: r.status, html: await r.text(), headers: r.headers };
}

function post(s: S, path: string, body: URLSearchParams | FormData, origin = ORIGIN) {
  return s.app.request(path, {
    method: "POST",
    headers: { Origin: origin },
    body,
    redirect: "manual",
  });
}

async function put(s: S, path: string, content: string) {
  const r = await s.req(`/files/${path}`, {
    method: "PUT",
    headers: { "Content-Type": "text/markdown" },
    body: content,
  });
  expect(r.status).toBeLessThan(300);
}

describe("verify, work queue, import and export (Phase 3, slice 3)", () => {
  test("verify the current version, from the app or the old form post", async () => {
    const s = setup();
    await put(s, "a.md", "---\ntype: Note\n---\nChecked content.\n");
    const concept = async () =>
      (await (
        await s.app.request(`${API}/files/a.md`, { headers: { Accept: "application/json" } })
      ).json()) as {
        trust_tier: string;
        hash: string;
        frontmatter: { verified?: { by: string }[] };
      };
    expect((await concept()).trust_tier).toBe("unverified");

    const forged = await post(
      s,
      `${LIB}/-/verify/a.md`,
      new URLSearchParams(),
      "https://evil.example",
    );
    expect(forged.status).toBe(403);
    const forgedApi = await s.app.request(`${API}/verify/a.md`, {
      method: "POST",
      headers: { Origin: "https://evil.example" },
    });
    expect(forgedApi.status).toBe(403);

    // The app verifies through the API, with the note in X-Note.
    const done = await s.app.request(`${API}/verify/a.md`, {
      method: "POST",
      headers: { Origin: ORIGIN, "X-Note": "read it" },
    });
    expect(done.status).toBe(200);
    const after = await concept();
    expect(after.trust_tier).toBe("human-reviewed");
    expect(after.frontmatter.verified?.at(-1)?.by).toBe("human:owner");
    const requests = (await (await s.app.request(`${API}/requests?limit=1`)).json()) as {
      requests: { note: string; events: { op: string }[] }[];
    };
    expect(requests.requests[0]).toMatchObject({ note: "read it", events: [{ op: "verify" }] });

    // The next edit lapses it.
    await s.req("/files/a.md", {
      method: "PUT",
      headers: { "Content-Type": "text/markdown", "If-Match": `"${after.hash}"` },
      body: "---\ntype: Note\n---\nChanged.\n",
    });
    expect((await concept()).trust_tier).toBe("unverified");

    // The server's form post still works and lands back on the concept.
    await put(s, "b.md", "---\ntype: Note\n---\nB.\n");
    const form = await post(s, `${LIB}/-/verify/b.md`, new URLSearchParams({ note: "b too" }));
    expect(form.status).toBe(303);
    expect(form.headers.get("Location")).toBe(`${LIB}/b.md?done=verify`);
    expect(s.store().read("b.md")).toMatchObject({ trust_tier: "human-reviewed" });
  });

  test("the work queue page lists and filters items", async () => {
    const s = setup();
    await put(s, "a.md", "---\ntype: Note\n---\nSee [gone](/gone.md).\n");
    await put(s, "b.md", "---\ntitle: No type\n---\nx\n");
    const all = await page(s, `${LIB}/-/work`);
    expect(all.html).toContain("broken link");
    expect(all.html).toContain("links to missing /gone.md");
    expect(all.html).toContain(`href="${LIB}/b.md"`);
    const lint = await page(s, `${LIB}/-/work?kind=lint`);
    expect(lint.html).toContain("b.md");
    expect(lint.html).not.toContain("gone.md");
    await put(s, "gone.md", "---\ntype: Note\n---\nhere\n");
    expect((await page(s, `${LIB}/-/work?kind=broken_link`)).html).toContain("nothing to do");
  });

  test("export downloads the bundle; import adds files as one request by the human", async () => {
    const s = setup();
    await put(s, "a.md", "---\ntype: Note\n---\nA\n");
    const exp = await s.app.request(`${LIB}/-/export`, { redirect: "manual" });
    expect(exp.status).toBe(302);
    const tar = await s.app.request(exp.headers.get("Location") ?? "");
    expect(tar.headers.get("Content-Disposition")).toContain("demo");
    const paths = readTar(new Uint8Array(await tar.arrayBuffer())).map((f) => f.path);
    expect(paths).toContain("a.md");

    const enc = new TextEncoder();
    const bundle = writeTar([
      { path: "pack/notes/x.md", bytes: enc.encode("---\ntype: Note\n---\nX\n") },
      { path: "pack/notes/y.md", bytes: enc.encode("---\ntitle: lint me\n---\nY\n") },
      { path: "pack/index.md", bytes: enc.encode("# ignored\n") },
    ]);
    const form = new FormData();
    form.set("bundle", new File([bundle], "pack.tar"));
    form.set("strip", "1");
    form.set("note", "bring in the pack");
    const r = await post(s, `${LIB}/-/import`, form);
    const html = await r.text();
    expect(r.status).toBe(200);
    expect(html).toContain("Imported 2 files from pack.tar");
    expect(html).toContain("1 file with lint");
    expect(s.store().read("notes/x.md").kind).toBe("concept");
    const ledger = await (await s.app.request(`${API}/requests?limit=1`)).text();
    expect(ledger).toContain("bring in the pack");
    expect(ledger).toContain("human:owner");

    const junk = new FormData();
    junk.set("bundle", new File([enc.encode("not a tar at all")], "x.tar"));
    const bad = await post(s, `${LIB}/-/import`, junk);
    expect(bad.status).toBe(400);
  });
});

describe("libraries and tokens", () => {
  test("create a library from the list page", async () => {
    const s = setup();
    const r = await post(s, "/new", new URLSearchParams({ slug: "team-notes" }));
    expect(r.status).toBe(303);
    expect(r.headers.get("Location")).toBe("/owner/team-notes/");
    expect((await s.accounts.libraries("user_1")).map((l) => l.slug)).toContain("team-notes");
    const dup = await post(s, "/new", new URLSearchParams({ slug: "team-notes" }));
    expect(dup.status).toBe(400);
    expect(await dup.text()).toContain("You already have a library named team-notes.");
  });

  test("mint a token in the UI, use it, and revoke it", async () => {
    const s = setup();
    const form = (actor: string) =>
      new URLSearchParams({
        library: "demo",
        actor,
        scope: "write",
        prefix: "",
        expires: "",
        tiers: "all",
      });
    const bad = await post(s, "/tokens", form("human:someone-else"));
    expect(bad.status).toBe(400);
    expect(await bad.text()).toContain("your own actor, human:owner");

    const created = await post(s, "/tokens", form("claude-code/laptop"));
    const html = await created.text();
    expect(created.status).toBe(200);
    expect(html).toContain("Shown once.");
    const secret = /<pre class="src wrap">(okf_[^<]+)<\/pre>/.exec(html)?.[1] ?? "";
    expect(html).toContain(`claude mcp add --transport http demo ${ORIGIN}/mcp`);

    const write = await s.req("/files/t.md", {
      method: "PUT",
      token: secret,
      headers: { "Content-Type": "text/markdown" },
      body: "---\ntype: Note\n---\nvia minted token\n",
    });
    expect(write.status).toBeLessThan(300);
    const list = await page(s, "/tokens");
    expect(list.html).toContain("claude-code/laptop");
    expect(list.html).toContain("owner@example.com");

    const id = /action="\/tokens\/([^/]+)\/revoke"/.exec(list.html)?.[1] ?? "";
    const revoked = await post(s, `/tokens/${id}/revoke`, new URLSearchParams());
    expect(revoked.status).toBe(303);
    expect((await s.req("/files/t.md", { token: secret })).status).toBe(401);
    expect((await page(s, "/tokens?done=revoke")).html).toContain("Token revoked.");

    // Your own human: actor is allowed in the UI.
    expect((await post(s, "/tokens", form("human:owner"))).status).toBe(200);
  });

  test("REST management routes need a human: token", async () => {
    const s = setup();
    const call = (path: string, init: RequestInit & { token?: string } = {}) => {
      const headers = new Headers(init.headers);
      headers.set("Authorization", `Bearer ${init.token ?? "human"}`);
      if (init.body) headers.set("Content-Type", "application/json");
      return s.app.request(path, { ...init, headers });
    };
    expect((await call("/api/v1/tokens", { token: "writer" })).status).toBe(403);
    expect((await call("/api/v1/libraries", { token: "process" })).status).toBe(403);

    const lib = await call("/api/v1/libraries", {
      method: "POST",
      body: JSON.stringify({ slug: "api-lib" }),
    });
    expect(lib.status).toBe(201);
    const libs = (await (await call("/api/v1/libraries")).json()) as {
      libraries: { slug: string }[];
    };
    expect(libs.libraries.map((l) => l.slug)).toContain("api-lib");

    const human = await call("/api/v1/tokens", {
      method: "POST",
      body: JSON.stringify({ library: "demo", actor: "human:owner", scope: "write" }),
    });
    expect(human.status).toBe(403);
    const made = await call("/api/v1/tokens", {
      method: "POST",
      body: JSON.stringify({
        library: "demo",
        actor: "process:nightly",
        scope: "read",
        expires: "2099-01-01",
      }),
    });
    expect(made.status).toBe(201);
    const token = (await made.json()) as { id: string; secret: string; expires: string };
    expect(token.expires).toBe("2099-01-01T23:59:59.000Z");
    expect((await s.req("/tree", { token: token.secret })).status).toBe(200);
    const listed = (await (await call("/api/v1/tokens")).json()) as { tokens: { id: string }[] };
    expect(listed.tokens.map((t) => t.id)).toContain(token.id);
    expect((await call(`/api/v1/tokens/${token.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await s.req("/tree", { token: token.secret })).status).toBe(401);
  });
});
