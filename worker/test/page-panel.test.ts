/**
 * The page panel (tempra-dev: app/page-panel): `show` names an MCP App that draws a page in the
 * chat, its resource declares this deployment for its fonts and images, its result carries the
 * page for the panel (tree, threads, signed image links, the changes asked for), and `page_act`
 * comments and checks as the person, only with the panel's grant, only on its page.
 */
import { describe, expect, test } from "bun:test";
import { MCP_APP_MIME, PAGE_PANEL_URI } from "../src/mcp/server";
import { setup } from "./harness";
import { makePng } from "./images";
import { approve, connectApp } from "./oauth-flow";
import { attachFile } from "./upload";

type S = ReturnType<typeof setup>;
type Page = {
  grant: string | null;
  viewer: { id: string | null; handle: string | null; comment: boolean; check: boolean };
  ask: string | null;
  url: string;
  concept: {
    path: string;
    title: string;
    seq: number;
    hash: string;
    images: Record<string, { src: string }>;
  };
  threads: {
    id: string;
    status: string;
    actor: string;
    anchor: { quote: string } | null;
    comments: { by?: Record<string, unknown> }[];
  }[];
  checked: { actor: string; since: number } | null;
  before: { seq: number; label: string; doc?: unknown } | null;
  byline: { actor: string } | null;
};

const doc = (body: string) =>
  `---\ntype: Metric\ntitle: Margin\ndescription: Gross margin.\n---\n${body}`;

async function seed(s: S, body = "# Margin\n\nMargin is revenue minus cost.\n", ifMatch?: string) {
  const r = await s.req("/files/metrics/margin.md", {
    method: "PUT",
    headers: {
      "Content-Type": "text/markdown",
      ...(ifMatch ? { "If-Match": `"${ifMatch}"` } : {}),
    },
    body: doc(body),
  });
  expect(r.status).toBeLessThan(300);
}

/** A person's agent over OAuth: the connection a chat has. */
async function agent(s: S) {
  const { client } = await connectApp(s.app, approve);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args });
    const text = (r.content as { text: string }[]).map((c) => c.text).join("\n");
    return { text, isError: !!r.isError, page: (r.structuredContent as { page?: Page })?.page };
  };
  return { client, call };
}

describe("the page panel", () => {
  test("show names the panel; page_act is the panel's alone; the resource carries its CSP", async () => {
    const s = setup();
    const { client } = await agent(s);
    const tools = (await client.listTools()).tools;
    expect(tools.find((t) => t.name === "show")?._meta).toEqual({
      ui: { resourceUri: PAGE_PANEL_URI },
    });
    expect(tools.find((t) => t.name === "page_act")?._meta).toEqual({
      ui: { resourceUri: PAGE_PANEL_URI, visibility: ["app"] },
    });
    const read = await client.readResource({ uri: PAGE_PANEL_URI });
    const [content] = read.contents as { mimeType: string; text: string; _meta?: unknown }[];
    expect(content?.mimeType).toBe(MCP_APP_MIME);
    expect(content?._meta).toEqual({
      ui: {
        csp: { connectDomains: ["http://localhost"], resourceDomains: ["http://localhost"] },
        prefersBorder: true,
      },
    });
    expect(content?.text).toStartWith("<!doctype html>");
    expect(content?.text).toContain('<body class="page-body">');
    // Inter from this deployment, never from a relative URL the host's frame cannot resolve.
    expect(content?.text).toContain('url("http://localhost/_design/inter-latin-opsz-normal.');
    expect(content?.text).not.toContain('url("/_design/');
    expect(content?.text.match(/<\/script>/g)?.length).toBe(1);
  });

  test("show gives the panel the page, its threads and signed images; the model a line", async () => {
    const s = setup();
    const { call } = await agent(s);
    await attachFile(s.app, call, "metrics/chart.png", makePng(4, 3));
    await seed(s, "# Margin\n\nMargin is revenue minus cost.\n\n![A chart](/metrics/chart.png)\n");
    await call("comment", {
      action: "open",
      path: "metrics/margin.md",
      quote: "revenue minus cost",
      body: "Which cost?",
    });
    const r = await call("show", { path: "metrics/margin.md", ask: "Is this right?" });
    expect(r.isError).toBe(false);
    expect(r.text).toContain('Showing "Margin" (metrics/margin.md');
    expect(r.text).toContain("1 open comment thread");
    expect(r.text).toContain("http://localhost/owner/demo/metrics/margin.md");
    const page = r.page as Page;
    expect(page.concept.title).toBe("Margin");
    expect(page.ask).toBe("Is this right?");
    expect(page.viewer).toEqual({
      id: "user_1",
      handle: "owner",
      comment: true,
      check: true,
    });
    expect(page.grant).toBeString();
    expect(page.threads).toHaveLength(1);
    expect(page.threads[0]?.anchor?.quote).toBe("revenue minus cost");
    const src = page.concept.images["metrics/chart.png"]?.src ?? "";
    expect(src).toStartWith("http://localhost/dl/lib-1/");
    // The signed link loads the image with no session.
    const img = await s.anon.request(src);
    expect(img.status).toBe(200);
    expect(img.headers.get("Content-Type")).toBe("image/png");
  });

  test("show draws the changes since the previous version, or since a check", async () => {
    const s = setup();
    const { call } = await agent(s);
    await seed(s);
    const first = (await call("show", { path: "metrics/margin.md" })).page as Page;
    await seed(s, "# Margin\n\nMargin is revenue minus the cost of goods.\n", first.concept.hash);
    const prev = (await call("show", { path: "metrics/margin.md", since: "previous" })).page;
    expect(prev?.before).toEqual({
      seq: first.concept.seq,
      doc: expect.anything(),
      label: "since v1",
    });
    // No check yet: nothing to draw against.
    const none = (await call("show", { path: "metrics/margin.md", since: "checked" })).page;
    expect(none?.before).toBeNull();
  });

  test("page_act comments and resolves with the person's words, marked as from the chat", async () => {
    const s = setup();
    const { call } = await agent(s);
    await seed(s);
    const page = (await call("show", { path: "metrics/margin.md" })).page as Page;
    const grant = page.grant as string;

    const opened = await call("page_act", {
      grant,
      action: "open",
      quote: "revenue minus cost",
      body: "Say which costs.",
    });
    expect(opened.isError).toBe(false);
    const t = opened.page?.threads[0];
    // The agent's connection is the actor; the words are marked as the person's, from the chat.
    expect(t?.actor).toBe("claude-ai/connector");
    expect(t?.comments[0]?.by).toMatchObject({ person: "user_1", surface: "chat" });
    expect(t?.anchor?.quote).toBe("revenue minus cost");

    const replied = await call("page_act", {
      grant,
      action: "resolve",
      thread: t?.id,
      body: "Fine as it is.",
    });
    expect(replied.page?.threads[0]?.status).toBe("resolved");

    // Checking is not the panel's: it stays in the app.
    const check = await call("page_act", { grant, action: "check" });
    expect(check.isError).toBe(true);

    // The agents' transcript names the person, in the chat.
    const threads = await call("comments", { path: "metrics/margin.md", status: "all" });
    expect(threads.text).toContain("the person, in the chat with ");
  });

  test("page_act needs the panel's grant, for its page, and words to comment", async () => {
    const s = setup();
    const { call } = await agent(s);
    await seed(s);
    await s.req("/files/notes/other.md", {
      method: "PUT",
      headers: { "Content-Type": "text/markdown" },
      body: "---\ntype: Note Set\ntitle: Other\ndescription: Another page.\n---\nOther words.\n",
    });
    const page = (await call("show", { path: "metrics/margin.md" })).page as Page;
    const forged = await call("page_act", { grant: "x.y", action: "open", body: "Hi" });
    expect(forged.isError).toBe(true);
    expect(forged.text).toContain("bad_panel");
    const empty = await call("page_act", { grant: page.grant, action: "open", body: " " });
    expect(empty.isError).toBe(true);

    // A thread on another page is not this panel's to touch.
    const other = await call("comment", { action: "open", path: "notes/other.md", body: "Hm" });
    const id = /thread (\S+) on/.exec(other.text)?.[1];
    const elsewhere = await call("page_act", { grant: page.grant, action: "resolve", thread: id });
    expect(elsewhere.isError).toBe(true);
    expect(elsewhere.text).toContain("another page");
  });

  test("a bearer token without a person gets the page, read only", async () => {
    const s = setup();
    await seed(s);
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { StreamableHTTPClientTransport } = await import(
      "@modelcontextprotocol/sdk/client/streamableHttp.js"
    );
    const transport = new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
      requestInit: { headers: { Authorization: "Bearer writer" } },
      fetch: async (url, init) => s.app.request(url.toString(), init as RequestInit),
    });
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(transport);
    const r = await client.callTool({ name: "show", arguments: { path: "metrics/margin.md" } });
    const page = (r.structuredContent as { page: Page }).page;
    expect(page.grant).toBeNull();
    expect(page.viewer.comment).toBe(false);
  });

  test("show refuses what is not a page", async () => {
    const s = setup();
    const { call } = await agent(s);
    await attachFile(s.app, call, "metrics/chart.png", makePng(4, 3));
    const r = await call("show", { path: "metrics/chart.png" });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("not_concept");
  });
});
