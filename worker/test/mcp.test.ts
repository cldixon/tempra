import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { imagesService, MODEL_BYTES, MODEL_EDGE, variantKeysFor } from "../src/images";
import { readTar } from "../src/util/tar";
import { setup } from "./harness";
import { base64, makePng } from "./images";
import { approve, connectApp } from "./oauth-flow";

type Text = { type: "text"; text: string };

async function connect(app: ReturnType<typeof setup>["app"], token = "writer") {
  const transport = new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
    fetch: async (url, init) => app.request(url.toString(), init as RequestInit),
  });
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(transport);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args });
    return { text: (r.content as Text[]).map((c) => c.text).join("\n"), isError: !!r.isError };
  };
  return { client, call };
}

const hashOf = (text: string) => /hash: ([0-9a-f]{64})/.exec(text)?.[1] ?? "";

const doc = (title: string, body: string) =>
  `---\ntype: Memo\ntitle: ${title}\ndescription: About ${title}.\nstatus: stable\n---\n${body}`;

describe("MCP server", () => {
  test("tiers: tool lists depend on the token", async () => {
    const { app } = setup();
    const names = async (token: string) =>
      (await (await connect(app, token)).client.listTools()).tools.map((t) => t.name).sort();
    const tier1 = [
      "attach",
      "batch",
      "browse",
      "create_library",
      "delete",
      "edit",
      "grep",
      "move",
      "read",
      "start",
      "write",
    ];
    const tier2 = [
      "comment",
      "comments",
      "diff",
      "export",
      "history",
      "links",
      "log",
      "query",
      "revert",
      "search",
      "sources",
      "work",
    ];
    expect(await names("files")).toEqual(tier1);
    expect(await names("writer")).toEqual([...tier1, ...tier2].sort());
    expect(await names("process")).toEqual([...tier1, ...tier2, "verify"].sort());

    const { client } = await connect(app, "files");
    const read = (await client.listTools()).tools.find((t) => t.name === "read");
    expect(Object.keys(read?.inputSchema.properties ?? {})).toEqual(["path", "image", "library"]);
    const { client: full } = await connect(app, "writer");
    const tier2Tool = (await full.listTools()).tools.find((t) => t.name === "search");
    expect(tier2Tool?.description?.startsWith("Beyond files:")).toBe(true);
    expect(full.getInstructions()).toContain("Call `start` first");
  });

  test("the file-equivalent workflow", async () => {
    const { app } = setup();
    const { call } = await connect(app);

    expect((await call("start")).text).toContain("The library is empty");

    let r = await call("write", {
      path: "metrics/revenue.md",
      content: doc("Revenue", "Money in. See [orders](/tables/orders.md).\n"),
      note: "first concept",
    });
    expect(r.isError).toBe(false);
    expect(r.text).toContain("broken_link");
    r = await call("write", {
      path: "tables/orders.md",
      content: doc("Orders", "One row per order.\n"),
    });
    expect(r.text).toContain("Lint: none.");

    // Writing an existing path without if_match fails with the current hash.
    r = await call("write", { path: "tables/orders.md", content: doc("Orders", "x\n") });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("current_hash: ");

    r = await call("read", { path: "metrics/revenue" });
    expect(r.text).toContain("trust: unverified · stale: no · status: stable · inbound links: 0");
    expect(r.text).toContain("Lint: none.");
    const h = hashOf(r.text);

    r = await call("edit", {
      path: "metrics/revenue.md",
      edits: [{ old: "Money in.", new: "Money received." }],
      if_match: h,
    });
    expect(r.isError).toBe(false);
    r = await call("edit", { path: "metrics/revenue.md", edits: [{ old: "nope", new: "x" }] });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("Current document:");

    expect((await call("grep", { pattern: "received" })).text).toBe(
      "metrics/revenue.md:8: Money received. See [orders](/tables/orders.md).",
    );
    expect((await call("browse", { dir: "metrics" })).text).toBe(
      "# Concepts\n\n* [Revenue](revenue.md) - About Revenue.\n",
    );

    r = await call("move", { from: "tables", to: "data/tables", note: "reorganize" });
    expect(r.text).toContain("data/tables/orders.md");
    expect((await call("read", { path: "metrics/revenue.md" })).text).toContain(
      "[orders](/data/tables/orders.md)",
    );

    r = await call("batch", {
      note: "two at once",
      ops: [
        { op: "write", path: "a.md", content: doc("A", "a\n") },
        { op: "write", path: "b.md", content: doc("B", "[a](a.md)\n") },
      ],
    });
    expect(r.text).toContain("Applied a.md");
    const hb = hashOf((await call("read", { path: "b.md" })).text);
    expect((await call("delete", { path: "b.md", if_match: hb })).isError).toBe(false);

    const start = (await call("start")).text;
    expect(start).toContain("Concepts: 3 · attachments: 0");
    expect(start).toContain("Types: Memo 3");
    expect(start).toContain("Health (checked ");
  });

  test("revert is the owner's: a write member's agent is refused and nothing lands", async () => {
    const s = setup();
    const owner = await connect(s.app);
    await owner.call("write", { path: "x.md", content: doc("X", "Alpha.\n") });
    const friend = await s.stranger("friend@example.com");
    await s.accounts.share("lib-1", friend.user.id, "write", "user_1");
    const { secret } = await s.accounts.createToken({
      libraryId: "lib-1",
      actor: "claude-code/friend",
      scope: "write",
      prefix: null,
      expires: null,
      mcpTiers: "all",
      createdBy: friend.user.id,
    });
    const member = await connect(s.app, secret);
    const head = s.store().headSeq();
    // The member's agent writes content, but does not revert (TEMPRA-124).
    const r = await member.call("revert", { path: "x.md", to_seq: 1, note: "undo" });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("owner_only");
    expect(s.store().headSeq()).toBe(head);
    expect(
      (await member.call("edit", { path: "x.md", edits: [{ old: "Alpha", new: "Beta" }] })).isError,
    ).toBe(false);
  });

  test("beyond files: search, query, links, log, history, diff, revert, work", async () => {
    const { app } = setup();
    const { call } = await connect(app);
    await call("write", { path: "x.md", content: doc("X", "Alpha beta.\n[y](/y.md)\n") });
    await call("write", { path: "y.md", content: doc("Y", "Gamma.\n") });
    const h = hashOf((await call("read", { path: "x.md" })).text);
    await call("write", {
      path: "x.md",
      content: doc("X", "Alpha delta.\n[y](/y.md)\n"),
      if_match: h,
      note: "delta",
    });

    expect((await call("search", { q: "alpha" })).text).toContain("x.md — X");
    expect((await call("query", { type: "Memo" })).text).toContain("2 matching concepts");
    expect(JSON.parse((await call("links", { path: "y.md" })).text).inbound[0].path).toBe("x.md");
    const log = (await call("log")).text;
    expect(log.split("\n")[0]).toContain("claude-code/test · delta");
    expect((await call("history", { path: "x.md" })).text).toContain("seq 3");
    const diff = (await call("diff", { path: "x.md" })).text;
    expect(diff).toContain("-Alpha beta.");
    expect(diff).toContain("+Alpha delta.");
    expect((await call("revert", { path: "x.md", to_seq: 1, note: "undo" })).isError).toBe(false);
    expect((await call("read", { path: "x.md" })).text).toContain("Alpha beta.");

    await call("write", {
      path: "old.md",
      content: `---\ntype: Note\nstale_after: 2020-01-01T00:00:00Z\n---\n[gone](/gone.md)\n`,
    });
    const work = (await call("work")).text;
    expect(work).toContain("[stale] old.md");
    expect(work).toContain("[broken_link] old.md");
  });

  test("export and attachments give working short-lived download URLs", async () => {
    const { app } = setup();
    const { call } = await connect(app);
    await call("write", { path: "a.md", content: doc("A", "a\n") });
    const bytes = new Uint8Array([1, 2, 3, 250]);
    const r = await call("attach", {
      path: "refs/data.bin",
      content_base64: btoa(String.fromCharCode(...bytes)),
    });
    expect(r.isError).toBe(false);

    const read = (await call("read", { path: "refs/data.bin" })).text;
    const fileUrl = /download \(15 minutes\): (\S+)/.exec(read)?.[1] ?? "";
    const got = await app.request(fileUrl);
    expect(got.status).toBe(200);
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(bytes);

    const exp = (await call("export")).text;
    const url = /(http\S+)/.exec(exp)?.[1] ?? "";
    const tar = await app.request(url);
    expect(tar.status).toBe(200);
    const paths = readTar(new Uint8Array(await tar.arrayBuffer()))
      .map((f) => f.path)
      .sort();
    expect(paths).toEqual(["a.md", "index.md", "log.md", "refs/data.bin", "refs/index.md"]);

    // Tampered or foreign links are refused.
    expect((await app.request(`${url.slice(0, -2)}xx`)).status).toBe(403);
    expect((await app.request(url.replace("/dl/lib-1/", "/dl/other/"))).status).toBe(403);
  });

  test("attach round-trips a few-hundred-KB image byte for byte (TEMPRA-105)", async () => {
    const { app } = setup();
    const { call } = await connect(app);
    const png = makePng(320, 320, { noise: true });
    expect(png.length).toBeGreaterThan(250_000);
    const r = await call("attach", { path: "assets/attach-test.png", content_base64: base64(png) });
    expect(r.isError).toBe(false);
    const read = (await call("read", { path: "assets/attach-test.png" })).text;
    expect(read).toContain(`size: ${png.length} bytes · media: image/png`);
    expect(read).toContain("dimensions: 320×320 px");
    const url = /download \(15 minutes\): (\S+)/.exec(read)?.[1] ?? "";
    const got = new Uint8Array(await (await app.request(url)).arrayBuffer());
    expect(got.length).toBe(png.length);
    expect(Buffer.from(got).equals(Buffer.from(png))).toBe(true);
    // The same image with its base64 cut short, as a model typing it out might send it.
    const cut = await call("attach", {
      path: "assets/attach-cut.png",
      content_base64: base64(png).slice(0, 4000),
    });
    expect(cut.isError).toBe(true);
    expect(cut.text).toContain("bad_image");
  });

  test("permissions: read-only tokens cannot write; only process tokens verify", async () => {
    const { app } = setup();
    const writer = await connect(app);
    await writer.call("write", { path: "a.md", content: doc("A", "a\n") });

    const reader = await connect(app, "reader");
    const r = await reader.call("write", { path: "b.md", content: doc("B", "b\n") });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("read_only");

    const proc = await connect(app, "process");
    expect((await proc.call("verify", { path: "a.md" })).isError).toBe(false);
    const after = (await writer.call("read", { path: "a.md" })).text;
    expect(after).toContain("trust: machine-confirmed");
    expect(after).toContain("by: process:nightly-verify");
  });

  test("resources list and read concepts", async () => {
    const { app } = setup();
    const { client, call } = await connect(app);
    await call("write", { path: "t/a.md", content: doc("A", "a\n") });
    const list = await client.listResources();
    expect(list.resources.map((r) => [r.uri, r.title])).toEqual([["okf://owner/demo/t/a.md", "A"]]);
    const res = await client.readResource({ uri: "okf://owner/demo/t/a.md" });
    expect((res.contents[0] as { text: string }).text).toContain("title: A");
  });

  describe("images and attachment bytes (TEMPRA-153, TEMPRA-155)", () => {
    // A valid 1x1 PNG.
    const PNG = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      ),
      (c) => c.charCodeAt(0),
    );
    /** A JPEG of 3000x2000 whose comments pad it past the model's cap. */
    const bigJpeg = () => {
      const parts: number[] = [0xff, 0xd8];
      for (let i = 0; i < 10; i++) {
        parts.push(0xff, 0xfe, 0xff, 0xfd, ...new Array(0xfffb).fill(0x20));
      }
      // SOF0: 8-bit, 2000 high, 3000 wide, one component.
      parts.push(0xff, 0xc0, 0x00, 0x0b, 0x08, 0x07, 0xd0, 0x0b, 0xb8, 0x01, 0x01, 0x11, 0x00);
      // SOS and a byte of image data: attachments are checked on write (TEMPRA-152).
      parts.push(0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x00);
      parts.push(0xff, 0xd9);
      return new Uint8Array(parts);
    };
    const b64 = (bytes: Uint8Array) => {
      let s = "";
      for (let i = 0; i < bytes.length; i += 0x8000) {
        s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      }
      return btoa(s);
    };
    const SCALED = new Uint8Array([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);

    /** A stand-in for the IMAGES binding: records each transform and answers a tiny WebP. */
    const fakeImages = (s: ReturnType<typeof setup>) => {
      const calls: { width: number; format: string }[] = [];
      const cache = new Map<string, { bytes: Uint8Array; media: string }>();
      s.deps.images = imagesService({
        blobs: s.blobs,
        cache: {
          get: async (k) => cache.get(k) ?? null,
          put: async (k, bytes, media) => {
            cache.set(k, { bytes, media });
          },
        },
        transformer: {
          input: (stream) => ({
            transform: (t) => ({
              output: async (o) => {
                await new Response(stream).arrayBuffer();
                calls.push({ width: t.width, format: o.format });
                return {
                  image: () => new Response(SCALED).body as ReadableStream<Uint8Array>,
                  contentType: () => o.format,
                };
              },
            }),
          }),
        },
      });
      return { calls, cache };
    };

    const content = async (
      client: Awaited<ReturnType<typeof connect>>["client"],
      args: Record<string, unknown>,
    ) =>
      (await client.callTool({ name: "read", arguments: args })).content as (
        | Text
        | { type: "image"; data: string; mimeType: string }
      )[];

    test("read returns a PNG as an image block, with no binding", async () => {
      const s = setup();
      const { client, call } = await connect(s.app);
      await call("attach", { path: "img/dot.png", content_base64: b64(PNG) });
      const c = await content(client, { path: "img/dot.png" });
      expect(c[0]?.type).toBe("text");
      expect((c[0] as Text).text).toContain("media: image/png");
      expect(c[1]).toEqual({ type: "image", data: b64(PNG), mimeType: "image/png" });
      expect(s.usage.filter((e) => e.kind === "read_image").map((e) => e.bytes)).toEqual([
        PNG.byteLength,
      ]);
      // image: false gives the facts alone.
      const facts = await content(client, { path: "img/dot.png", image: false });
      expect(facts.map((x) => x.type)).toEqual(["text"]);
    });

    test("a large JPEG is scaled for the model, once", async () => {
      const s = setup();
      const { calls, cache } = fakeImages(s);
      const { client, call } = await connect(s.app);
      const jpeg = bigJpeg();
      expect(jpeg.byteLength).toBeGreaterThan(MODEL_BYTES);
      await call("attach", { path: "img/big.jpg", content_base64: b64(jpeg) });
      for (let i = 0; i < 2; i++) {
        const c = await content(client, { path: "img/big.jpg" });
        const img = c[1] as { type: string; data: string; mimeType: string };
        expect(img.type).toBe("image");
        expect(img.mimeType).toBe("image/webp");
        const decoded = Uint8Array.from(atob(img.data), (ch) => ch.charCodeAt(0));
        expect(decoded).toEqual(SCALED);
        expect(decoded.byteLength).toBeLessThanOrEqual(MODEL_BYTES);
      }
      // Scaled once to the model's edge; the second read came from the cache.
      expect(calls).toEqual([{ width: MODEL_EDGE, format: "image/webp" }]);
      expect([...cache.keys()]).toEqual([
        expect.stringMatching(/^variants\/[0-9a-f]{64}\/1568\.webp$/),
      ]);
    });

    test("without the binding, a large image says it is too large", async () => {
      const s = setup();
      const { client, call } = await connect(s.app);
      await call("attach", { path: "img/big.jpg", content_base64: b64(bigJpeg()) });
      const c = await content(client, { path: "img/big.jpg" });
      expect(c.map((x) => x.type)).toEqual(["text", "text"]);
      expect((c[1] as Text).text).toContain("too large to show");
      expect((c[0] as Text).text).toContain("download (15 minutes): http");
    });

    test("SVG comes back as its text; other files are unchanged", async () => {
      const s = setup();
      const { client, call } = await connect(s.app);
      const svg = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>';
      await call("attach", { path: "img/c.svg", content_base64: btoa(svg) });
      const c = await content(client, { path: "img/c.svg" });
      expect(c.map((x) => x.type)).toEqual(["text", "text"]);
      expect((c[1] as Text).text).toContain("<circle");
      await call("attach", { path: "refs/data.bin", content_base64: btoa("\u0001\u0002") });
      const bin = await content(client, { path: "refs/data.bin" });
      expect(bin.map((x) => x.type)).toEqual(["text"]);
    });

    test("resources carry an attachment's bytes, up to a cap", async () => {
      const s = setup();
      fakeImages(s);
      const { client, call } = await connect(s.app);
      await call("attach", { path: "img/big.jpg", content_base64: b64(bigJpeg()) });
      await call("attach", { path: "refs/data.csv", content_base64: btoa("a,b\n1,2\n") });
      const big = new Uint8Array(3 * 1024 * 1024).fill(7);
      // Over MCP's request cap, so it goes up over REST.
      const put = await s.req("/files/refs/huge.bin", {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: big,
      });
      expect(put.status).toBeLessThan(300);

      const list = await client.listResources();
      expect(
        Object.fromEntries(list.resources.map((r) => [r.name, r.mimeType ?? null])),
      ).toMatchObject({ "img/big.jpg": "image/jpeg", "refs/data.csv": "text/csv" });

      const img = (await client.readResource({ uri: "okf://owner/demo/img/big.jpg" }))
        .contents[0] as { mimeType: string; blob: string };
      expect(img.mimeType).toBe("image/webp");
      expect(Uint8Array.from(atob(img.blob), (ch) => ch.charCodeAt(0))).toEqual(SCALED);

      const csv = (await client.readResource({ uri: "okf://owner/demo/refs/data.csv" }))
        .contents[0] as { mimeType: string; blob: string };
      expect(csv).toMatchObject({ mimeType: "text/csv", blob: btoa("a,b\n1,2\n") });

      const huge = (await client.readResource({ uri: "okf://owner/demo/refs/huge.bin" }))
        .contents[0] as { mimeType: string; text: string };
      expect(huge.mimeType).toBe("text/plain");
      expect(huge.text).toContain("Attachment; download: http");
    });

    test("the sweep's variant keys cover every edge and format of a blob", () => {
      const keys = variantKeysFor(["blobs/abc", "exports/x"]);
      expect(keys).toContain("variants/abc/1568.webp");
      expect(keys.every((k) => k.startsWith("variants/abc/"))).toBe(true);
    });
  });

  test("rejects requests without a valid token", async () => {
    const { app } = setup();
    const r = await app.request("/mcp", { method: "POST", body: "{}" });
    expect(r.status).toBe(401);
  });

  describe("create_library (TEMPRA-100)", () => {
    /** A read-and-write connection to all libraries that may create them. */
    const creator = { ...approve, libraries: "all", library: "", create_libraries: "on" };

    test("creates a library the person owns, then writes in it as their agent", async () => {
      const s = setup();
      const { call } = await connectApp(s.app, creator);
      const made = await call("create_library", {
        slug: "recipes",
        title: "Recipes",
        description: "What we cook.",
      });
      expect(made.isError).toBe(false);
      expect(made.text).toContain("Created library owner/recipes, owned by @owner");
      // It answers like start for the new library.
      expect(made.text).toContain("# Library owner/recipes (seq 0)");
      expect(made.text).toContain("Title: Recipes");
      expect(made.text).toContain("Description: What we cook.");
      expect(made.text).toContain("The library is empty");
      expect((await s.accounts.library("owner", "recipes"))?.ownerId).toBe("user_1");

      const w = await call("write", {
        library: "owner/recipes",
        path: "soup.md",
        content: doc("Soup", "Hot.\n"),
        note: "First recipe",
      });
      expect(w.isError).toBe(false);
      expect((await call("start", { library: "owner/recipes" })).text).toContain("Title: Recipes");
      // The ledger's first event is the person's agent, as with any other write.
      const log = (await (
        await s.app.request("/api/v1/libraries/owner/recipes/requests")
      ).json()) as { requests: { actor: string; by: { person: string; agent?: string } }[] };
      expect(log.requests).toHaveLength(1);
      expect(log.requests[0]?.actor).toBe("claude-ai/connector");
      expect(log.requests[0]?.by.person).toBe("user_1");
      expect(log.requests[0]?.by.agent).toMatch(/^agt_/);
      const agents = (await (
        await s.app.request("/api/v1/libraries/owner/recipes/agents")
      ).json()) as { contributors: { person: string; agent: { name: string } }[] };
      expect(agents.contributors.map((c) => `${c.agent.name} for ${c.person}`)).toEqual([
        "Claude for owner",
      ]);
      // Counted as a write against the person's account, like any write.
      expect(s.usage.filter((e) => e.kind === "write").map((e) => e.account)).toEqual([
        "owner",
        "owner",
      ]);
      // The app lists it, with what the agent said it is for.
      const list = (await (await s.app.request("/api/v1/libraries")).json()) as {
        libraries: { slug: string; role: string }[];
      };
      expect(list.libraries.find((l) => l.slug === "recipes")?.role).toBe("owner");
    });

    test("refused for a read connection, without the choice, and for a bearer token", async () => {
      const s = setup();
      const read = await connectApp(s.app, { ...creator, access: "read" }, { scope: "okf:read" });
      expect(read.flow.html).not.toContain("create_libraries");
      const r1 = await read.call("create_library", { slug: "x" });
      expect(r1.isError).toBe(true);
      expect(r1.text).toContain("create_not_allowed");
      expect(r1.text).toContain("read access");

      const { create_libraries: _, ...without } = creator;
      const plain = await connectApp(s.app, without);
      const r2 = await plain.call("create_library", { slug: "x" });
      expect(r2.text).toContain("create_not_allowed");
      expect(r2.text).toContain("reconnect");

      const files = await connectApp(s.app, { ...without, tiers: "files" });
      expect((await files.call("create_library", { slug: "x" })).text).toContain(
        "create_not_allowed",
      );

      const token = await connect(s.app, "writer");
      const r3 = await token.call("create_library", { slug: "x" });
      expect(r3.text).toContain("create_not_allowed");
      expect(r3.text).toContain("reaches one library");
      expect(await s.accounts.library("owner", "x")).toBeNull();
    });

    test("the library limit, a taken slug and bad slugs are refused", async () => {
      const s = setup();
      s.db.run(`UPDATE users SET limits = '{"libraries": 2}' WHERE id = 'user_1'`);
      const { call } = await connectApp(s.app, creator);
      const taken = await call("create_library", { slug: "demo" });
      expect(taken.text).toContain("Error 409 slug_taken");
      for (const slug of ["Bad Slug", "owner/x", "stranger/x", "../x", "-x", "x/", ""]) {
        const bad = await call("create_library", { slug });
        expect(bad.isError).toBe(true);
        expect(bad.text).toContain("bad_slug");
      }
      const line = await call("create_library", { slug: "ok", title: "One\n## Two" });
      expect(line.text).toContain("bad_title");
      const long = await call("create_library", { slug: "ok", description: "x".repeat(301) });
      expect(long.text).toContain("bad_description");
      expect((await call("create_library", { slug: "second" })).isError).toBe(false);
      const over = await call("create_library", { slug: "third" });
      expect(over.text).toContain("Error 403 library_limit");
      expect(over.text).toContain("limit of 2 libraries");
      expect((await s.accounts.libraries("user_1")).map((l) => l.slug).sort()).toEqual([
        "demo",
        "second",
      ]);
    });
  });
});
