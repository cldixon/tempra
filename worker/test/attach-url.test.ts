import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { checkSourceUrl, fetchSource } from "../src/fetch-source";
import { sniffMedia } from "../src/media";
import { API, ORIGIN, setup } from "./harness";
import { base64, makePng } from "./images";
import { attachFile } from "./upload";

type S = ReturnType<typeof setup>;
type Text = { type: "text"; text: string };

async function mcp(s: S, token = "writer") {
  const transport = new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
    fetch: async (url, init) => s.app.request(url.toString(), init as RequestInit),
  });
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(transport);
  return async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args });
    return { text: (r.content as Text[]).map((c) => c.text).join("\n"), isError: !!r.isError };
  };
}

const describeFile = async (s: S, path: string) =>
  (await (
    await s.app.request(`${API}/files/${path}`, { headers: { Accept: "application/json" } })
  ).json()) as Record<string, unknown>;

const PNG = makePng(6, 4);
const png = () =>
  new Response(PNG as unknown as BodyInit, { headers: { "Content-Type": "image/png" } });
const redirect = (to: string) => () =>
  new Response(null, { status: 302, headers: { Location: to } });

/** A body that streams `chunks` of `size` bytes, and says it is small. */
const stream = (chunks: number, size: number) => () => {
  let sent = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(c) {
        if (sent++ >= chunks) return c.close();
        c.enqueue(sent === 1 ? PNG.slice(0, Math.min(size, PNG.length)) : new Uint8Array(size));
      },
    }),
    { headers: { "Content-Type": "image/png", "Content-Length": "10" } },
  );
};

const lastEvent = (s: S) =>
  s
    .store()
    .events({ since: s.store().headSeq() - 1 })
    .events.at(-1);

describe("attach from a URL (TEMPRA-157)", () => {
  test("MCP attach with source_url fetches, stores and records where from", async () => {
    const s = setup();
    s.web.set("https://example.com/fig.png", png);
    const call = await mcp(s);
    const r = await call("attach", {
      path: "figures/fig.png",
      source_url: "https://example.com/fig.png",
      description: "The service's three tiers.",
      note: "Vendor diagram.",
    });
    expect(r.isError).toBe(false);
    expect(r.text).toContain("Fetched");
    expect(r.text).toContain("sources");
    expect(s.fetched).toEqual(["https://example.com/fig.png"]);
    const e = lastEvent(s);
    expect(e?.meta).toMatchObject({
      source: { via: "url", url: "https://example.com/fig.png" },
      description: "The service's three tiers.",
      note: "Vendor diagram.",
    });
    const source = (e?.meta?.source ?? {}) as { final_url?: string; fetched_at?: string };
    expect(source.final_url).toBeUndefined();
    expect(String(source.fetched_at)).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    // The attachment view: MCP read and the JSON description.
    const read = await call("read", { path: "figures/fig.png", image: false });
    expect(read.text).toMatch(/source: https:\/\/example\.com\/fig\.png, fetched \d{4}-/);
    expect(read.text).toContain("description: The service's three tiers.");
    const json = await describeFile(s, "figures/fig.png");
    expect(json).toMatchObject({
      media: "image/png",
      width: 6,
      height: 4,
      source: { url: "https://example.com/fig.png" },
      description: "The service's three tiers.",
    });
    // Metered as a fetch; attach is a write tool, so it counts against the write limit.
    expect(s.usage.some((u) => u.kind === "fetch" && u.bytes === PNG.length)).toBe(true);
    expect(s.usage.some((u) => u.kind === "write")).toBe(true);
  });

  test("a redirect chain is followed, each hop checked, and the final URL kept", async () => {
    const s = setup();
    s.web.set("https://a.example/1", redirect("https://b.example/2"));
    s.web.set("https://b.example/2", redirect("/3"));
    s.web.set("https://b.example/3", png);
    const call = await mcp(s);
    const r = await call("attach", { path: "r.png", source_url: "https://a.example/1" });
    expect(r.isError).toBe(false);
    expect(s.fetched).toEqual([
      "https://a.example/1",
      "https://b.example/2",
      "https://b.example/3",
    ]);
    const json = await describeFile(s, "r.png");
    expect(json.source).toMatchObject({
      url: "https://a.example/1",
      final_url: "https://b.example/3",
    });
  });

  test("more than 3 redirects, and a redirect to http: or to a private address, are refused", async () => {
    const s = setup();
    for (let i = 0; i < 5; i++) s.web.set(`https://loop.example/${i}`, redirect(`/${i + 1}`));
    s.web.set("https://down.example/x", redirect("http://down.example/x"));
    s.web.set("https://in.example/x", redirect("https://169.254.169.254/latest"));
    const call = await mcp(s);
    const many = await call("attach", { path: "a.png", source_url: "https://loop.example/0" });
    expect(many.isError).toBe(true);
    expect(many.text).toContain("fetch_refused");
    expect(many.text).toContain("more than 3");
    expect(s.fetched).toHaveLength(4);
    const down = await call("attach", { path: "a.png", source_url: "https://down.example/x" });
    expect(down.text).toContain("must be https");
    const inside = await call("attach", { path: "a.png", source_url: "https://in.example/x" });
    expect(inside.text).toContain("public host");
    expect(s.fetched).not.toContain("https://169.254.169.254/latest");
    expect(s.store().headSeq()).toBe(0);
  });

  test("http:, credentials, private and loopback addresses, localhost and our own host are refused before any fetch", async () => {
    const s = setup();
    const call = await mcp(s);
    const cases: [string, string][] = [
      ["http://example.com/a.png", "must be https"],
      ["https://user:pw@example.com/a.png", "user name or password"],
      ["https://token@example.com/a.png", "user name or password"],
      ["https://127.0.0.1/a.png", "public host"],
      ["https://10.1.2.3/a.png", "public host"],
      ["https://192.168.0.10/a.png", "public host"],
      ["https://172.20.0.1/a.png", "public host"],
      ["https://169.254.169.254/a.png", "public host"],
      ["https://0x7f.1/a.png", "public host"],
      ["https://[::1]/a.png", "public host"],
      ["https://[fe80::1]/a.png", "public host"],
      ["https://[::ffff:10.0.0.1]/a.png", "public host"],
      ["https://localhost/a.png", "public host"],
      ["https://db.localhost/a.png", "public host"],
      ["https://localhost/a.png", "public host"],
      ["ftp://example.com/a.png", "must be https"],
      ["not a url", "not a URL"],
    ];
    for (const [url, says] of cases) {
      const r = await call("attach", { path: "a.png", source_url: url });
      expect(r.isError).toBe(true);
      expect(r.text).toContain("fetch_refused");
      expect(r.text).toContain(says);
    }
    expect(s.fetched).toEqual([]);
    expect(() => checkSourceUrl("https://app.tempra.dev/x.png", ["app.tempra.dev"])).toThrow(
      "this one",
    );
    expect(checkSourceUrl("https://8.8.8.8/x.png").hostname).toBe("8.8.8.8");
  });

  test("too large is refused from the stream, whatever Content-Length says", async () => {
    const s = setup();
    s.web.set("https://big.example/x.png", stream(12, 1024 * 1024));
    const call = await mcp(s);
    const r = await call("attach", { path: "big.png", source_url: "https://big.example/x.png" });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("fetch_refused");
    expect(r.text).toContain("cap");
    expect(s.blobs.map.size).toBe(0);
    expect(s.store().headSeq()).toBe(0);
  });

  test("what is not an image, video, audio or PDF is refused by its bytes; a broken image as bad_image", async () => {
    const s = setup();
    s.web.set(
      "https://example.com/page",
      () => new Response("<html>hi</html>", { headers: { "Content-Type": "image/png" } }),
    );
    s.web.set(
      "https://example.com/broken.png",
      () => new Response(PNG.slice(0, 40) as unknown as BodyInit),
    );
    s.web.set("https://example.com/doc", () => new Response("%PDF-1.7\n%…\n"));
    s.web.set("https://example.com/gone", () => new Response("no", { status: 404 }));
    const call = await mcp(s);
    const html = await call("attach", { path: "p.png", source_url: "https://example.com/page" });
    expect(html.text).toContain("fetch_refused");
    expect(html.text).toContain("not an image, video, audio or PDF");
    const broken = await call("attach", {
      path: "b.png",
      source_url: "https://example.com/broken.png",
    });
    expect(broken.text).toContain("bad_image");
    const gone = await call("attach", { path: "g.png", source_url: "https://example.com/gone" });
    expect(gone.text).toContain("example.com answered 404");
    const pdf = await call("attach", { path: "d.pdf", source_url: "https://example.com/doc" });
    expect(pdf.isError).toBe(false);
    expect((await describeFile(s, "d.pdf")).media).toBe("application/pdf");
  });

  test("a fetch that does not finish in time is refused as a timeout", async () => {
    const s = setup();
    s.web.set(
      "https://slow.example/x.png",
      (init) =>
        new Promise<Response>((_, reject) =>
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))),
        ),
    );
    s.web.set(
      "https://drip.example/x.png",
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(c) {
              c.enqueue(PNG.slice(0, 8));
            },
          }),
        ),
    );
    const f = s.deps.fetch as NonNullable<S["deps"]["fetch"]>;
    for (const url of ["https://slow.example/x.png", "https://drip.example/x.png"]) {
      const err = await fetchSource(f, url, { timeoutMs: 30 }).catch((e) => e);
      expect(err.code).toBe("fetch_refused");
      expect(err.extra.rule).toBe("timeout");
    }
  });

  test("source_url is required, base64 is refused; read access refused", async () => {
    const s = setup();
    s.web.set("https://example.com/fig.png", png);
    const call = await mcp(s);
    const both = await call("attach", {
      path: "a.png",
      source_url: "https://example.com/fig.png",
      content_base64: base64(PNG),
    });
    expect(both.text).toContain("base64_removed");
    expect((await call("attach", { path: "a.png" })).text).toContain("`source_url`");
    const reader = await mcp(s, "reader");
    const r = await reader("attach", { path: "a.png", source_url: "https://example.com/fig.png" });
    expect(r.isError).toBe(true);
    expect(s.fetched).toEqual([]);
  });

  test("a description on every way in, kept for the version, and checked", async () => {
    const s = setup();
    const call = await mcp(s);
    const put = (path: string, bytes: Uint8Array, facts: Record<string, unknown> = {}) =>
      attachFile(s.app, call, path, bytes, facts);
    // prepare_upload
    expect((await put("one.png", PNG, { description: "  Uploaded's.  " })).status).toBe(200);
    expect((await describeFile(s, "one.png")).description).toBe("Uploaded's.");
    // source_url (above too) and REST ?from=
    s.web.set("https://example.com/fig.png", png);
    const viaUrl = await call("attach", {
      path: "three.png",
      source_url: "https://example.com/fig.png",
      description: "Fetched's.",
    });
    expect(viaUrl.isError).toBe(false);
    expect((await describeFile(s, "three.png")).description).toBe("Fetched's.");
    // The same bytes with a new description is a write; with the same, a no-op.
    const seq = s.store().headSeq();
    await put("one.png", PNG, {
      if_match: (await describeFile(s, "one.png")).hash,
      description: "Better.",
    });
    expect(s.store().headSeq()).toBe(seq + 1);
    expect((await describeFile(s, "one.png")).description).toBe("Better.");
    await put("one.png", PNG, {
      if_match: (await describeFile(s, "one.png")).hash,
      description: "Better.",
    });
    expect(s.store().headSeq()).toBe(seq + 1);
    // As it was: the earlier version's description.
    const old = (await (
      await s.app.request(`${API}/files/one.png?at=${seq}`, {
        headers: { Accept: "application/json" },
      })
    ).json()) as { description: string };
    expect(old.description).toBe("Uploaded's.");
    // New bytes start without one.
    await put("one.png", makePng(2, 2), { if_match: (await describeFile(s, "one.png")).hash });
    expect((await describeFile(s, "one.png")).description).toBeNull();
    const long = await call("attach", {
      path: "x.png",
      source_url: "https://example.com/fig.png",
      description: "x".repeat(501),
    });
    expect(long.text).toContain("bad_description");
    expect(
      (await call("prepare_upload", { path: "y.png", description: "x".repeat(501) })).text,
    ).toContain("bad_description");
  });

  test("REST POST …/files/{path}?from= and a JSON body attach from a URL; tenancy holds", async () => {
    const s = setup();
    s.web.set("https://example.com/fig.png", png);
    const q = await s.req(
      `/files/figs/q.png?from=${encodeURIComponent("https://example.com/fig.png")}&description=Q`,
      { method: "POST" },
    );
    expect(q.status).toBe(200);
    expect((await describeFile(s, "figs/q.png")).source).toMatchObject({
      url: "https://example.com/fig.png",
    });
    expect((await describeFile(s, "figs/q.png")).description).toBe("Q");
    const j = await s.req("/files/figs/j.png", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source_url: "https://example.com/fig.png", note: "From a script." }),
    });
    expect(j.status).toBe(200);
    expect(lastEvent(s)?.meta).toMatchObject({ note: "From a script." });
    const bad = await s.req("/files/figs/h.png?from=http://example.com/fig.png", {
      method: "POST",
    });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { code: string; rule: string }).rule).toBe("scheme");
    const none = await s.req("/files/figs/n.png", { method: "POST" });
    expect(((await none.json()) as { code: string }).code).toBe("bad_attach");
    expect(s.usage.filter((u) => u.kind === "fetch")).toHaveLength(2);

    // A stranger sees no library; a read member may not write.
    const fetchedBefore = s.fetched.length;
    const other = await s.stranger();
    const asStranger = await s.req("/files/figs/s.png?from=https://example.com/fig.png", {
      method: "POST",
      token: other.writer,
    });
    expect(asStranger.status).toBe(404);
    const friend = await s.stranger("friend@example.com");
    await s.accounts.share("lib-1", friend.user.id, "read", "user_1");
    const asReader = await friend.app.request(
      `${API}/files/figs/r.png?from=https://example.com/fig.png`,
      { method: "POST", headers: { Origin: ORIGIN } },
    );
    expect(asReader.status).toBe(403);
    expect(s.fetched.length).toBe(fetchedBefore);
  });

  test("every hop sends a descriptive User-Agent and Accept (Wikimedia refuses requests without one)", async () => {
    const s = setup();
    const seen: { ua: string | null; accept: string | null }[] = [];
    const strict = (next: () => Response) => (init?: RequestInit) => {
      const h = new Headers(init?.headers);
      seen.push({ ua: h.get("User-Agent"), accept: h.get("Accept") });
      return (h.get("User-Agent") ?? "").includes("+https://tempra.dev")
        ? next()
        : new Response("Please set a user-agent", { status: 400 });
    };
    s.web.set("https://commons.example/a", strict(redirect("https://upload.example/b")));
    s.web.set("https://upload.example/b", strict(png));
    const call = await mcp(s);
    const r = await call("attach", { path: "c.png", source_url: "https://commons.example/a" });
    expect(r.isError).toBe(false);
    expect(seen).toHaveLength(2);
    for (const h of seen) {
      expect(h.ua).toBe(
        "Tempra/1.0 (+https://tempra.dev; fetches an image an agent named for a library)",
      );
      expect(h.accept).toBe("image/*, application/pdf, video/*, audio/*;q=0.8, */*;q=0.1");
    }
    // A refusal names the status and the host.
    s.web.set("https://picky.example/x.png", () => new Response("no", { status: 400 }));
    const no = await call("attach", { path: "p.png", source_url: "https://picky.example/x.png" });
    expect(no.text).toContain("picky.example answered 400");
  });

  test("the design's other media are known by their bytes", () => {
    const enc = (t: string) => new TextEncoder().encode(t);
    expect(sniffMedia(enc("%PDF-1.4"))).toBe("application/pdf");
    expect(sniffMedia(enc("OggS\0\x02"))).toBe("audio/ogg");
    expect(sniffMedia(enc("RIFF\0\0\0\0WAVEfmt "))).toBe("audio/wav");
    expect(sniffMedia(enc("ID3\x04"))).toBe("audio/mpeg");
    expect(sniffMedia(enc("\0\0\0\x18ftypmp42"))).toBe("video/mp4");
    expect(
      sniffMedia(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x82, ...enc("webm")])),
    ).toBe("video/webm");
    expect(sniffMedia(enc("<html>"))).toBeNull();
  });
});
