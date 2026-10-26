import { describe, expect, setSystemTime, test } from "bun:test";
import { type Doc, parseMarkdown, toMarkdown } from "@tempra/editor/doc";
import { imagesService, VARIANT_EDGES } from "../src/images";
import { parseConcept } from "../src/okf/concept";
import { readTar, writeTar } from "../src/util/tar";
import { compareBundle } from "./compare";
import { BUNDLES, loadBundle } from "./fixtures";
import { API, setup, UI } from "./harness";
import { makePng, SVG } from "./images";

const doc = (body: string, extra = "") => `---\ntype: Note\n${extra}---\n${body}`;

describe("auth", () => {
  test("requires a bearer token for the right library", async () => {
    const { req, app } = setup();
    expect((await req("/tree", { token: "" })).status).toBe(401);
    expect((await req("/tree", { token: "nope" })).status).toBe(401);
    // Another library, or the same name under another owner, is answered as if it did not exist.
    for (const path of [
      "/api/v1/libraries/owner/other/tree",
      "/api/v1/libraries/someone/demo/tree",
    ]) {
      const other = await app.request(path, { headers: { Authorization: "Bearer writer" } });
      expect(other.status).toBe(404);
    }
    expect((await req("/tree")).status).toBe(200);
  });

  test("scope and prefix limit writes", async () => {
    const { req } = setup();
    const put = (path: string, token: string) =>
      req(`/files/${path}`, {
        method: "PUT",
        body: doc("x"),
        token,
        headers: { "Content-Type": "text/markdown" },
      });
    expect((await put("a.md", "reader")).status).toBe(403);
    expect((await put("a.md", "scoped")).status).toBe(403);
    expect((await put("notes/a.md", "scoped")).status).toBe(200);
  });
});

describe("files", () => {
  test("PUT, GET with ETag, conditional replace, PATCH, move, DELETE", async () => {
    const { req } = setup();
    let r = await req("/files/notes/a.md", {
      method: "PUT",
      body: doc("Hello [b](b.md)\n"),
      headers: { "If-None-Match": "*", "X-Note": "first write" },
    });
    expect(r.status).toBe(200);
    const created = (await r.json()) as { hash: string; seq: number; lint: { code: string }[] };
    expect(created.seq).toBe(1);
    expect(created.lint.map((l) => l.code)).toContain("broken_link");

    r = await req("/files/notes/a");
    expect(r.headers.get("ETag")).toBe(`"${created.hash}"`);
    expect(r.headers.get("Content-Type")).toContain("text/markdown");
    const md = await r.text();
    expect(parseConcept(md).generated?.by).toBe("claude-code/test");

    r = await req("/files/notes/a.md", { headers: { Accept: "application/json" } });
    const view = (await r.json()) as { frontmatter: { type: string }; trust_tier: string };
    expect(view.frontmatter.type).toBe("Note");
    expect(view.trust_tier).toBe("unverified");

    // Replace needs the right If-Match.
    r = await req("/files/notes/a.md", { method: "PUT", body: doc("v2") });
    expect(r.status).toBe(409);
    expect(((await r.json()) as { current_hash: string }).current_hash).toBe(created.hash);
    r = await req("/files/notes/a.md", {
      method: "PUT",
      body: JSON.stringify({ frontmatter: { type: "Note", title: "A" }, doc: parseMarkdown("v2") }),
      headers: { "Content-Type": "application/json", "If-Match": `"${created.hash}"` },
    });
    expect(r.status).toBe(200);

    r = await req("/files/notes/a.md", {
      method: "PATCH",
      body: JSON.stringify({ edits: [{ old: "v2", new: "v3" }], note: "tweak" }),
    });
    expect(r.status).toBe(200);
    r = await req("/files/notes/a.md", {
      method: "PATCH",
      body: JSON.stringify({ edits: [{ old: "zzz", new: "" }] }),
    });
    expect(r.status).toBe(409);

    r = await req("/files/notes/a.md/move", {
      method: "POST",
      body: JSON.stringify({ to: "notes/c.md" }),
    });
    expect(r.status).toBe(200);
    expect((await req("/files/notes/a.md")).status).toBe(404);
    const moved = (await (
      await req("/files/notes/c.md", { headers: { Accept: "application/json" } })
    ).json()) as {
      hash: string;
      doc: Doc;
    };
    expect(toMarkdown(moved.doc)).toBe("v3\n");

    expect((await req("/files/notes/c.md", { method: "DELETE" })).status).toBe(428);
    r = await req("/files/notes/c.md", { method: "DELETE", headers: { "If-Match": moved.hash } });
    expect(r.status).toBe(200);

    const hist = (await (await req("/history/notes/c.md")).json()) as { events: { op: string }[] };
    expect(hist.events.map((e) => e.op)).toEqual(["put", "put", "put", "move", "delete"]);
    const reqs = (await (await req("/requests")).json()) as { requests: { note: string | null }[] };
    expect(reqs.requests.map((x) => x.note)).toEqual([null, null, "tweak", null, "first write"]);
  });

  test("index.md and log.md are synthesized and read-only", async () => {
    const { req } = setup();
    await req("/files/t/x.md", {
      method: "PUT",
      body: doc("x", "title: X\ndescription: The x.\n"),
    });
    const idx = await (await req("/files/t/index.md")).text();
    expect(idx).toBe("# Concepts\n\n* [X](x.md) - The x.\n");
    const root = await (await req("/files/index.md")).text();
    expect(root).toContain('okf_version: "0.2"');
    const log = await (await req("/files/log.md")).text();
    expect(log).toContain("* **Creation** by `claude-code/test`: [t/x.md](/t/x.md)");
    expect((await req("/files/t/index.md", { method: "PUT", body: "x" })).status).toBe(405);
  });

  test("attachments go through the Worker and read back byte-identical", async () => {
    const { req, blobs } = setup();
    const bytes = new Uint8Array([0, 1, 2, 3, 250]);
    let r = await req("/files/refs/data.bin", { method: "PUT", body: bytes });
    expect(r.status).toBe(200);
    const { hash } = (await r.json()) as { hash: string };
    expect(blobs.map.has(hash)).toBe(true);
    r = await req("/files/refs/data.bin");
    expect(r.headers.get("Content-Disposition")).toContain("attachment");
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(bytes);
  });
});

describe("queries and revert", () => {
  test("GET /outline: every file's path, kind, title and seq in one answer, nothing more", async () => {
    const { req } = setup();
    await req("/files/a.md", { method: "PUT", body: doc("A.", "title: Alpha\n") });
    await req("/files/deep/er/b.md", { method: "PUT", body: doc("B.") });
    const r = await req("/outline");
    expect(r.status).toBe(200);
    const body = (await r.json()) as { seq: number; files: Record<string, unknown>[] };
    expect(body.files).toEqual([
      { path: "a.md", kind: "concept", title: "Alpha", seq: expect.any(Number) },
      { path: "deep/er/b.md", kind: "concept", title: null, seq: expect.any(Number) },
    ]);
    expect(body.seq).toBeGreaterThan(0);
  });

  test("tree, concepts, search, grep, links, events, revert", async () => {
    const { req } = setup();
    const batch = await req("/batch", {
      method: "POST",
      body: JSON.stringify({
        note: "seed",
        ops: [
          {
            op: "write",
            path: "m/rev.md",
            content: doc("Revenue [cost](/m/cost.md)\n", "tags: [finance]\n"),
          },
          { op: "write", path: "m/cost.md", content: doc("Cost\n") },
        ],
      }),
    });
    expect(batch.status).toBe(200);
    const b = (await batch.json()) as { request_id: string; results: unknown[] };
    expect(b.results.length).toBe(2);

    const tree = (await (await req("/tree?prefix=m")).json()) as { entries: { path: string }[] };
    expect(tree.entries.map((e) => e.path)).toEqual(["m/cost.md", "m/rev.md"]);
    const q = (await (await req("/concepts?tag=finance")).json()) as { items: { path: string }[] };
    expect(q.items.map((e) => e.path)).toEqual(["m/rev.md"]);
    const s = (await (await req("/search?q=revenue")).json()) as { results: { path: string }[] };
    expect(s.results.map((e) => e.path)).toEqual(["m/rev.md"]);
    const g = (await (await req("/grep?pattern=Cost")).json()) as {
      matches: { path: string; line: number }[];
    };
    expect(g.matches).toEqual([{ path: "m/cost.md", line: 5, text: "Cost" }] as never);
    const l = (await (await req("/links/m/cost.md")).json()) as { inbound: { path: string }[] };
    expect(l.inbound.map((x) => x.path)).toEqual(["m/rev.md"]);
    const ev = (await (await req("/events?since=1")).json()) as { events: { seq: number }[] };
    expect(ev.events.map((e) => e.seq)).toEqual([2]);

    const rv = await req("/revert", {
      method: "POST",
      body: JSON.stringify({ request_id: b.request_id }),
    });
    expect(rv.status).toBe(200);
    const after = (await (await req("/tree")).json()) as { entries: unknown[] };
    expect(after.entries).toEqual([]);
    // History is kept: reading as of seq 2 still works.
    expect((await req("/files/m/rev.md?at=2")).status).toBe(200);
    expect((await req("/files/m/rev.md?at=abc")).status).toBe(400);
  });
});

describe("tar", () => {
  test("round-trips files, including long paths", () => {
    const enc = new TextEncoder();
    const long = `${"deep/".repeat(30)}file.md`;
    const files = [
      { path: "a.md", bytes: enc.encode("hello") },
      { path: long, bytes: enc.encode("x".repeat(1000)) },
      { path: "empty.txt", bytes: new Uint8Array() },
    ];
    expect(readTar(writeTar(files))).toEqual(files);
  });
});

describe("import and export round-trip the sample bundles (through the API)", () => {
  for (const bundle of BUNDLES) {
    test(bundle, async () => {
      const { req } = setup();
      const original = loadBundle(bundle);
      const r = await req(`/import?source=fixtures/${bundle}`, {
        method: "POST",
        body: writeTar(original) as unknown as BodyInit,
        headers: { "Content-Type": "application/x-tar" },
      });
      expect(r.status).toBe(200);
      const res = (await r.json()) as { files: number };
      expect(res.files).toBe(original.filter((f) => !/(^|\/)(index|log)\.md$/.test(f.path)).length);

      const exp = await req("/export");
      expect(exp.status).toBe(200);
      const out = new Map(
        readTar(new Uint8Array(await exp.arrayBuffer())).map((f) => [f.path, f.bytes]),
      );
      expect(compareBundle(original, out)).toEqual([]);
      // index.md and log.md are synthesized at every level the original had them.
      for (const f of original)
        if (/(^|\/)index\.md$/.test(f.path)) expect(out.has(f.path)).toBe(true);
    });
  }
});

describe("GET /api/v1/libraries (TEMPRA-23)", () => {
  type Row = {
    id: string;
    role: string;
    owner: string;
    slug: string;
    unavailable?: boolean;
    seq?: number;
    health?: unknown;
    tally?: { changes: number; for_you?: number };
  };
  const list = async (s: ReturnType<typeof setup>) => {
    const r = await s.app.request("/api/v1/libraries");
    expect(r.status).toBe(200);
    return ((await r.json()) as { libraries: Row[] }).libraries;
  };

  test("one library that fails is listed as unavailable; the rest are unaffected", async () => {
    const s = setup();
    const made = await s.app.request("/api/v1/libraries", {
      method: "POST",
      headers: { Origin: "http://localhost", "Content-Type": "application/json" },
      body: JSON.stringify({ slug: "broken" }),
    });
    expect(made.status).toBe(201);
    const broken = (await s.accounts.reachable("user_1")).find((l) => l.slug === "broken");
    if (!broken) throw new Error("no broken library");
    const real = s.deps.libraryByDoId;
    s.deps.libraryByDoId = async (doId) => {
      const lib = await real(doId);
      if (doId !== broken.do_id || !lib) return lib;
      return {
        ...lib,
        summary: async () => {
          throw new Error("Library schema version 4 is not 1");
        },
      };
    };
    const libs = await list(s);
    const bad = libs.find((l) => l.slug === "broken");
    const good = libs.find((l) => l.slug === "demo");
    expect(bad).toEqual({
      id: broken.id,
      owner: "owner",
      slug: "broken",
      role: "owner",
      unavailable: true,
    });
    expect(good?.unavailable).toBeUndefined();
    expect(good?.seq).toBeNumber();
    expect(good?.health).toBeDefined();
    expect(good?.tally).toEqual({ changes: 0, for_you: 0 });
  });

  test("a library with no object, or a failing tally, still lists", async () => {
    const s = setup();
    s.deps.libraryByDoId = async () => null;
    expect(await list(s)).toEqual([
      { id: "lib-1", owner: "owner", slug: "demo", role: "owner", unavailable: true },
    ]);
    const s2 = setup();
    const n = s2.deps.notifications;
    if (!n) throw new Error("no notifications");
    n.unread = async () => {
      throw new Error("D1 down");
    };
    const [row] = await list(s2);
    expect(row?.unavailable).toBeUndefined();
    expect(row?.tally).toEqual({ changes: 0 });
  });
});

describe("upload URLs (TEMPRA-158)", () => {
  const PNG = makePng(4, 3);
  const hex = (b: Uint8Array) => new Bun.CryptoHasher("sha256").update(b).digest("hex");
  type S = ReturnType<typeof setup>;
  type Prepared = { url: string; method: string; expires: string; curl: string; code?: string };
  const prepare = async (s: S, body: Record<string, unknown>, token?: string) => {
    const r = await s.req("/uploads", {
      method: "POST",
      token,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: (await r.json()) as Prepared };
  };
  const put = (s: S, url: string, bytes: Uint8Array, type?: string) =>
    s.anon.request(url, {
      method: "PUT",
      body: bytes,
      headers: type ? { "Content-Type": type } : {},
    });
  const code = async (r: Response) => ((await r.json()) as { code: string }).code;

  test("prepare, PUT the bytes: attached as the caller, with its note, answered as a write", async () => {
    const s = setup();
    const p = await prepare(s, {
      path: "figures/chart.png",
      size: PNG.length,
      sha256: hex(PNG),
      note: "The latency chart.",
    });
    expect(p.status).toBe(201);
    expect(p.body.url).toStartWith("http://localhost/ul/lib-1/");
    expect(p.body.curl).toBe(`curl -sS -T chart.png '${p.body.url}'`);
    const r = await put(s, p.body.url, PNG);
    expect(r.status).toBe(200);
    const res = (await r.json()) as { path: string; hash: string; seq: number; lint: unknown[] };
    expect(res.path).toBe("figures/chart.png");
    expect(res.hash).toBe(hex(PNG));
    const back = await s.req("/files/figures/chart.png");
    expect(back.headers.get("Content-Type")).toBe("image/png");
    expect(new Uint8Array(await back.arrayBuffer())).toEqual(PNG);
    const reqs = (await (await s.req("/requests")).json()) as {
      requests: { actor: string; note: string | null }[];
    };
    expect(reqs.requests[0]).toMatchObject({
      actor: "claude-code/test",
      note: "The latency chart.",
    });
    // Recorded for the blob sweep as any attach is.
    expect(s.db.query("SELECT 1 FROM blob_refs WHERE hash = ?").get(hex(PNG))).toBeTruthy();

    // One PUT per link.
    const again = await put(s, p.body.url, PNG);
    expect(again.status).toBe(403);
    expect(await code(again)).toBe("upload_used");
  });

  test("bytes or a type that do not match are refused, and the link is not spent", async () => {
    const s = setup();
    const p = await prepare(s, { path: "a.png", size: PNG.length, sha256: hex(PNG) });
    const short = await put(s, p.body.url, PNG.slice(0, 5));
    expect(short.status).toBe(400);
    expect(await short.json()).toMatchObject({ code: "checksum_mismatch", received_size: 5 });
    const garbled = PNG.slice();
    garbled[10] = 9;
    const bad = await put(s, p.body.url, garbled);
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({
      code: "checksum_mismatch",
      received_sha256: hex(garbled),
    });
    const type = await put(s, p.body.url, PNG, "image/jpeg");
    expect(type.status).toBe(400);
    expect(await code(type)).toBe("media_mismatch");
    expect((await s.req("/files/a.png")).status).toBe(404);
    expect((await put(s, p.body.url, PNG, "image/png")).status).toBe(200);
  });

  test("a truncated image is refused with bad_image and nothing is written", async () => {
    const s = setup();
    const p = await prepare(s, { path: "figures/cut.png", note: "Cut short." });
    const seq = s.store().headSeq();
    const cut = await put(s, p.body.url, PNG.slice(0, PNG.length - 20));
    expect(cut.status).toBe(400);
    expect(await code(cut)).toBe("bad_image");
    expect((await s.req("/files/figures/cut.png")).status).toBe(404);
    expect(s.store().headSeq()).toBe(seq);
    // The link is still good for the whole file, which comes back with its dimensions.
    expect((await put(s, p.body.url, PNG)).status).toBe(200);
    const view = (await (
      await s.req("/files/figures/cut.png", { headers: { Accept: "application/json" } })
    ).json()) as { width?: number; height?: number };
    expect(view).toMatchObject({ width: 4, height: 3 });
  });

  test("expired, tampered or foreign links are refused; download links do not upload", async () => {
    const s = setup();
    const p = await prepare(s, { path: "a.bin" });
    expect((await put(s, `${p.body.url.slice(0, -2)}xx`, PNG)).status).toBe(403);
    expect((await put(s, p.body.url.replace("/ul/lib-1/", "/ul/other/"), PNG)).status).toBe(403);
    // A download token never opens as an upload, nor the other way round.
    const dl = s.store().signDownload({ k: "export", at: 0 });
    expect((await put(s, `/ul/lib-1/${dl}`, PNG)).status).toBe(403);
    const ul = p.body.url.split("/").pop();
    expect((await s.anon.request(`/dl/lib-1/${ul}`)).status).toBe(403);
    setSystemTime(new Date(Date.now() + 16 * 60_000));
    try {
      const late = await put(s, p.body.url, PNG);
      expect(late.status).toBe(403);
      expect(await code(late)).toBe("bad_upload");
    } finally {
      setSystemTime();
    }
  });

  test("read access is refused at prepare, and so are a path outside a prefix and a size over the cap", async () => {
    const s = setup();
    const r = await prepare(s, { path: "a.bin" }, "reader");
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("read_only");
    expect((await prepare(s, { path: "elsewhere/a.bin" }, "scoped")).status).toBe(403);
    expect((await prepare(s, { path: "a.bin", size: 11 * 1024 * 1024 })).status).toBe(413);
    expect((await prepare(s, { path: "a.bin", sha256: "abc" })).status).toBe(400);
  });

  test("a member demoted to read before the PUT lands nothing", async () => {
    const s = setup();
    const friend = await s.stranger("friend@example.com");
    await s.accounts.share("lib-1", friend.user.id, "write", "user_1");
    const r = await friend.app.request("/api/v1/libraries/owner/demo/uploads", {
      method: "POST",
      headers: { Origin: "http://localhost", "Content-Type": "application/json" },
      body: JSON.stringify({ path: "f.bin" }),
    });
    expect(r.status).toBe(201);
    const { url } = (await r.json()) as Prepared;
    await s.accounts.share("lib-1", friend.user.id, "read", "user_1");
    const got = await put(s, url, PNG);
    expect(got.status).toBe(403);
    expect((await s.req("/files/f.bin")).status).toBe(404);
  });

  test("blob first: a link without a path stores the bytes for X-Blob", async () => {
    const s = setup();
    const p = await prepare(s, { sha256: hex(PNG) });
    expect(p.status).toBe(201);
    const r = await put(s, p.body.url, PNG);
    expect(r.status).toBe(201);
    const blob = (await r.json()) as { hash: string; size: number };
    expect(blob).toMatchObject({ hash: hex(PNG), size: PNG.length });
    const w = await s.req("/files/x/pic.png", { method: "PUT", headers: { "X-Blob": blob.hash } });
    expect(w.status).toBe(200);
    expect(new Uint8Array(await (await s.req("/files/x/pic.png")).arrayBuffer())).toEqual(PNG);
  });
});

describe("the reader's image route (TEMPRA-162)", () => {
  type S = ReturnType<typeof setup>;
  const PNG = makePng(1600, 800);
  const hex = (b: Uint8Array) => new Bun.CryptoHasher("sha256").update(b).digest("hex");
  const HASH = hex(PNG);
  const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  const attach = (s: S, path: string, bytes: Uint8Array, type: string, token?: string) =>
    s.req(`/files/${path}`, {
      method: "PUT",
      token,
      headers: { "Content-Type": type },
      body: bytes as unknown as BodyInit,
    });
  const image = (s: S, query = "", headers: Record<string, string> = {}) =>
    s.app.request(`${UI}/-/image/${HASH}${query}`, { headers });
  /** A stand-in for the IMAGES binding that records each transform, or fails every one. */
  const fakeImages = (s: S, opts: { fail?: boolean } = {}) => {
    const calls: { width: number; format: string }[] = [];
    s.deps.images = imagesService({
      blobs: s.blobs,
      transformer: {
        input: (stream) => ({
          transform: (t) => ({
            output: async (o) => {
              await new Response(stream).arrayBuffer();
              calls.push({ width: t.width, format: o.format });
              if (opts.fail) throw new Error("ERROR 9422: not enabled");
              return {
                image: () => new Response(WEBP).body as ReadableStream<Uint8Array>,
                contentType: () => o.format,
              };
            },
          }),
        }),
      },
    });
    return calls;
  };

  test("the original, inline and cached for good, with no redirect", async () => {
    const s = setup();
    await attach(s, "img/wide.png", PNG, "image/png");
    const r = await image(s);
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type")).toBe("image/png");
    expect(r.headers.get("Cache-Control")).toBe("private, max-age=31536000, immutable");
    expect(r.headers.get("Content-Disposition")).toBe("inline");
    expect(r.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(r.headers.get("Content-Length")).toBe(String(PNG.length));
    expect(r.headers.get("Vary")).toBeNull();
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(PNG);
    // Signed in only: no session is the sign-in page, never the bytes.
    const anon = await s.anon.request(`${UI}/-/image/${HASH}`);
    expect(anon.headers.get("Content-Type")).not.toBe("image/png");
  });

  test("a hash grants nothing: another library's, a stranger's, unknown or not an image", async () => {
    const s = setup();
    const other = await s.stranger();
    // The stranger's image is theirs alone, though the bytes are one blob.
    await attach(s, "img/wide.png", PNG, "image/png", other.writer);
    expect((await image(s)).status).toBe(404);
    await attach(s, "img/wide.png", PNG, "image/png");
    expect((await image(s)).status).toBe(200);
    // And the owner's library is not the stranger's to open.
    const theirs = await other.app.request(`${UI}/-/image/${HASH}`);
    expect(theirs.status).toBe(404);
    expect(theirs.headers.get("Content-Type")).not.toBe("image/png");
    expect((await s.app.request(`${UI}/-/image/${"0".repeat(64)}`)).status).toBe(404);
    expect((await s.app.request(`${UI}/-/image/not-a-hash`)).status).toBe(404);
    // A concept's bytes and a file that is not an image are not images.
    const w = (await (
      await s.req("/files/notes/a.md", {
        method: "PUT",
        headers: { "Content-Type": "text/markdown" },
        body: "---\ntype: Note\ntitle: A\ndescription: A note.\n---\nHello.\n",
      })
    ).json()) as { hash: string };
    expect((await s.app.request(`${UI}/-/image/${w.hash}`)).status).toBe(404);
    const csv = new TextEncoder().encode("a,b\n1,2\n");
    await attach(s, "data/t.csv", csv, "text/csv");
    expect((await s.app.request(`${UI}/-/image/${hex(csv)}`)).status).toBe(404);
  });

  test("a past attachment still answers: the hash names bytes the library held", async () => {
    const s = setup();
    await attach(s, "img/wide.png", PNG, "image/png");
    await s.req("/files/img/wide.png", { method: "DELETE" });
    expect((await image(s)).status).toBe(200);
  });

  test("w: a variant as WebP, AVIF when accepted, never enlarged; only known edges", async () => {
    const s = setup();
    await attach(s, "img/wide.png", PNG, "image/png");
    const calls = fakeImages(s);
    const webp = await image(s, "?w=640", { Accept: "image/webp,*/*" });
    expect(webp.status).toBe(200);
    expect(webp.headers.get("Content-Type")).toBe("image/webp");
    expect(webp.headers.get("Vary")).toBe("Accept");
    expect(webp.headers.get("Cache-Control")).toBe("private, max-age=31536000, immutable");
    expect(webp.headers.get("Content-Disposition")).toBe("inline");
    expect(new Uint8Array(await webp.arrayBuffer())).toEqual(WEBP);
    const avif = await image(s, "?w=640", { Accept: "image/avif,image/webp,*/*" });
    expect(avif.headers.get("Content-Type")).toBe("image/avif");
    expect(calls).toEqual([
      { width: 640, format: "image/webp" },
      { width: 640, format: "image/avif" },
    ]);
    // At or past the image's own long edge (1600): the original, with no transform.
    const big = await image(s, "?w=1920");
    expect(big.headers.get("Content-Type")).toBe("image/png");
    expect(big.headers.get("Vary")).toBe("Accept");
    expect(calls).toHaveLength(2);
    expect((await image(s, "?w=500")).status).toBe(400);
    expect((await image(s, "?w=abc")).status).toBe(400);
  });

  test("w falls back to the original: no binding, a failed transform, an SVG", async () => {
    const s = setup();
    await attach(s, "img/wide.png", PNG, "image/png");
    const none = await image(s, "?w=640");
    expect(none.headers.get("Content-Type")).toBe("image/png");
    expect(new Uint8Array(await none.arrayBuffer())).toEqual(PNG);
    const calls = fakeImages(s, { fail: true });
    const failed = await image(s, "?w=640", { Accept: "image/avif,*/*" });
    expect(failed.status).toBe(200);
    expect(failed.headers.get("Content-Type")).toBe("image/png");
    // AVIF tried, then WebP, then the original.
    expect(calls.map((c) => c.format)).toEqual(["image/avif", "image/webp"]);
    await attach(s, "img/mark.svg", SVG, "image/svg+xml");
    const r = await s.app.request(`${UI}/-/image/${hex(SVG)}?w=320`);
    expect(r.headers.get("Content-Type")).toBe("image/svg+xml");
    expect(r.headers.get("Content-Security-Policy")).toContain("sandbox");
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(new Uint8Array(SVG));
    expect(calls).toHaveLength(2);
  });

  test("a concept's JSON lists its images' hashes and sizes, backfilling ones from before", async () => {
    const s = setup();
    await attach(s, "img/wide.png", PNG, "image/png");
    // An image from before TEMPRA-152: stored by the store alone, no size.
    const old = makePng(30, 20);
    s.blobs.map.set(hex(old), old);
    s.store().apply({ actor: "test/old", request_id: "old" }, [
      {
        op: "attach",
        path: "img/old.png",
        blob: { hash: hex(old), size: old.length, media: "image/png" },
      },
    ]);
    await s.req("/files/notes/figs.md", {
      method: "PUT",
      headers: { "Content-Type": "text/markdown" },
      body: [
        "---",
        "type: Note",
        "title: Figs",
        "description: Figures.",
        "---",
        "![Wide](/img/wide.png)",
        "",
        "Inline ![old](../img/old.png), ![gone](/img/gone.png), ![ext](https://example.com/x.png).",
        "",
      ].join("\n"),
    });
    const view = (await (
      await s.app.request(`${API}/files/notes/figs.md`, {
        headers: { Accept: "application/json" },
      })
    ).json()) as { images: Record<string, unknown> };
    expect(view.images).toEqual({
      "img/wide.png": { hash: HASH, media: "image/png", width: 1600, height: 800 },
      "img/old.png": { hash: hex(old), media: "image/png", width: 30, height: 20 },
    });
    // Kept: the next read has the size without the bytes.
    expect(s.store().read("img/old.png")).toMatchObject({ width: 30, height: 20 });
  });
});

test("the app offers the variant edges the server makes (TEMPRA-162)", async () => {
  const src = await Bun.file(new URL("../../app/src/images.ts", import.meta.url)).text();
  const m = src.match(/export const VARIANT_EDGES = \[([^\]]*)\]/);
  expect(m?.[1]?.split(",").map((x) => Number(x.trim()))).toEqual([...VARIANT_EDGES]);
});
