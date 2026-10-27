/**
 * The upload panel (TEMPRA-200; tempra-dev: app/media, Upload panel): `prepare_upload` names an
 * MCP App (SEP-1865) that a host draws in the chat, the panel's resource carries its CSP, the
 * result carries what the panel needs, and `/ul/` takes the panel's cross-origin PUT.
 */
import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { MCP_APP_MIME, UPLOAD_PANEL_URI } from "../src/mcp/server";
import { setup } from "./harness";
import { makePng } from "./images";

const PNG = makePng(4, 3);
const PANEL_META = { ui: { csp: { connectDomains: ["http://localhost"] }, prefersBorder: true } };

async function connect(app: ReturnType<typeof setup>["app"]) {
  const transport = new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
    requestInit: { headers: { Authorization: "Bearer writer" } },
    fetch: async (url, init) => app.request(url.toString(), init as RequestInit),
  });
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

type Upload = { url: string; page?: string; path: string; library: string; media?: string };

describe("the upload panel (TEMPRA-200)", () => {
  test("prepare_upload names the panel; the panel is an MCP App resource with its CSP", async () => {
    const client = await connect(setup().app);
    const tool = (await client.listTools()).tools.find((t) => t.name === "prepare_upload");
    expect(tool?._meta).toEqual({ ui: { resourceUri: UPLOAD_PANEL_URI } });

    const listed = (await client.listResources()).resources.find((r) => r.uri === UPLOAD_PANEL_URI);
    expect(listed).toMatchObject({ mimeType: MCP_APP_MIME, _meta: PANEL_META });

    const read = await client.readResource({ uri: UPLOAD_PANEL_URI });
    const [content] = read.contents as { uri: string; mimeType: string; text: string }[];
    expect(content).toMatchObject({ uri: UPLOAD_PANEL_URI, mimeType: MCP_APP_MIME });
    expect((content as { _meta?: unknown })._meta).toEqual(PANEL_META);
    expect(content?.text).toStartWith("<!doctype html>");
    expect(content?.text).toContain('<main id="panel"></main>');
    expect(content?.text).toContain('<script type="module">');
    // Its script never closes its own element early.
    expect(content?.text.match(/<\/script>/g)?.length).toBe(1);
  });

  test("the result carries the upload for the panel, and still the curl line and the link", async () => {
    const client = await connect(setup().app);
    const r = await client.callTool({
      name: "prepare_upload",
      arguments: { path: "figures/photo.png", size: PNG.length, description: "A photo." },
    });
    const textOut = (r.content as { text: string }[]).map((c) => c.text).join("\n");
    expect(textOut).toContain("curl -sS -T photo.png");
    expect(textOut).toContain("/owner/demo/-/upload/");
    expect(textOut).toContain("an upload panel appears");
    const upload = (r.structuredContent as { upload: Upload & Record<string, unknown> }).upload;
    expect(upload).toMatchObject({
      path: "figures/photo.png",
      library: "demo",
      media: "image/png",
      size: PNG.length,
      description: "A photo.",
    });
    expect(upload.url).toStartWith("http://localhost/ul/lib-1/");
    expect(upload.page).toStartWith("http://localhost/owner/demo/-/upload/");
    expect(upload.url.split("/").pop()).toBe(upload.page?.split("/").pop());
  });

  test("/ul/ answers a cross-origin preflight and PUT; from the chat, the person supplied it", async () => {
    const s = setup();
    const client = await connect(s.app);
    const r = await client.callTool({ name: "prepare_upload", arguments: { path: "p.png" } });
    const { url } = (r.structuredContent as { upload: Upload }).upload;
    const from = { Origin: "https://abc123.claudemcpcontent.com" };

    const pre = await s.anon.request(url, {
      method: "OPTIONS",
      headers: {
        ...from,
        "Access-Control-Request-Method": "PUT",
        "Access-Control-Request-Headers": "content-type",
      },
    });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(pre.headers.get("Access-Control-Allow-Methods")).toBe("PUT");
    expect(pre.headers.get("Access-Control-Allow-Headers")).toBe("Content-Type");
    expect(pre.headers.get("Access-Control-Allow-Credentials")).toBeNull();

    // A refusal is readable by the panel too, and leaves the link good.
    const bad = await s.anon.request(`${url}?via=chat`, {
      method: "PUT",
      body: PNG.slice(0, 20),
      headers: { ...from, "Content-Type": "image/png" },
    });
    expect(bad.status).toBe(400);
    expect(bad.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(((await bad.json()) as { code: string }).code).toBe("bad_image");

    const put = await s.anon.request(`${url}?via=chat`, {
      method: "PUT",
      body: PNG,
      headers: { ...from, "Content-Type": "image/png" },
    });
    expect(put.status).toBe(200);
    expect(put.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const facts = (await (
      await s.req("/files/p.png", { headers: { Accept: "application/json" } })
    ).json()) as { supplied_by: string | null };
    expect(facts.supplied_by).toBe("owner");
  });

  test("curl's PUT, without ?via=chat, records no supplier", async () => {
    const s = setup();
    const client = await connect(s.app);
    const r = await client.callTool({ name: "prepare_upload", arguments: { path: "q.png" } });
    const { url } = (r.structuredContent as { upload: Upload }).upload;
    expect((await s.anon.request(url, { method: "PUT", body: PNG })).status).toBe(200);
    const facts = (await (
      await s.req("/files/q.png", { headers: { Accept: "application/json" } })
    ).json()) as { supplied_by: string | null };
    expect(facts.supplied_by).toBeNull();
  });
});
