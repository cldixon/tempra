import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { API, ORIGIN, setup } from "./harness";

type S = ReturnType<typeof setup>;
type Text = { type: "text"; text: string };

const doc = (body: string) =>
  `---\ntype: Metric\ntitle: Margin\ndescription: Gross margin.\n---\n${body}`;

async function seed(s: S) {
  const r = await s.req("/files/metrics/margin.md", {
    method: "PUT",
    headers: { "Content-Type": "text/markdown" },
    body: doc("# Margin\n\nMargin is revenue minus cost.\n"),
  });
  expect(r.status).toBeLessThan(300);
}

/** JSON to the API as the signed-in owner, from this site's pages unless `origin` says. */
function post(s: S, path: string, body?: unknown, origin = ORIGIN) {
  return s.app.request(`${API}${path}`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

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

describe("comments over REST and MCP", () => {
  test("a person comments in the app; an agent finds it in work, replies and resolves", async () => {
    const s = setup();
    await seed(s);
    const opened = await post(s, "/comments", {
      path: "metrics/margin.md",
      body: "This contradicts the margin standard.",
      anchor: { quote: "revenue minus cost" },
    });
    expect(opened.status).toBe(201);
    const { thread } = (await opened.json()) as {
      thread: { id: string; actor: string; located: { from: number } };
    };
    expect(thread.actor).toBe("human:owner");

    const call = await mcp(s);
    const read = await call("read", { path: "metrics/margin.md" });
    expect(read.text).toContain("Open comments: 1");
    const work = await call("work", { kind: "comment" });
    expect(work.text).toContain(`thread ${thread.id}`);
    expect(work.text).toContain("revenue minus cost");
    const list = await call("comments", { path: "metrics/margin.md" });
    expect(list.text).toContain("> revenue minus cost");
    expect(list.text).toContain("human:owner");
    const start = await call("start");
    expect(start.text).toContain("open comment threads: 1");

    expect(
      (await call("comment", { action: "reply", thread: thread.id, body: "Fixed." })).isError,
    ).toBe(false);
    const resolved = await call("comment", { action: "resolve", thread: thread.id });
    expect(resolved.text).toContain("it is resolved");

    const after = (await (await s.app.request(`${API}/comments/${thread.id}`)).json()) as {
      status: string;
      resolved_by: string;
      comments: { actor: string; body: string }[];
    };
    expect(after.status).toBe("resolved");
    expect(after.resolved_by).toBe("claude-code/test");
    expect(after.comments.map((c) => c.actor)).toEqual(["human:owner", "claude-code/test"]);
    expect((await call("comments")).text).toBe("No open comment threads.");

    // The person reopens it from the app, with no body at all.
    const reopened = await post(s, `/comments/${thread.id}/reopen`);
    expect(reopened.status).toBe(200);
    const listed = (await (
      await s.app.request(`${API}/comments?path=metrics/margin.md`)
    ).json()) as {
      threads: { id: string; status: string }[];
    };
    expect(listed.threads).toEqual([expect.objectContaining({ id: thread.id, status: "open" })]);

    // Every action is in the ledger, as comment events by who did it.
    const ledger = (await (await s.req("/events?since=0")).json()) as {
      events: { op: string; actor: string }[];
    };
    expect(ledger.events.filter((e) => e.op === "comment").map((e) => e.actor)).toEqual([
      "human:owner",
      "claude-code/test",
      "claude-code/test",
      "human:owner",
    ]);
  });

  test("writes are refused cross-site, to read-only tokens and outside a token's prefix", async () => {
    const s = setup();
    await seed(s);
    const forged = await post(
      s,
      "/comments",
      { path: "metrics/margin.md", body: "x" },
      "https://evil.example",
    );
    expect(forged.status).toBe(403);
    const reader = await s.req("/comments", {
      method: "POST",
      token: "reader",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "metrics/margin.md", body: "x" }),
    });
    expect(reader.status).toBe(403);
    const scoped = await s.req("/comments", {
      method: "POST",
      token: "scoped",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "metrics/margin.md", body: "x" }),
    });
    expect(scoped.status).toBe(403);
    // Reading is fine for a read-only token.
    expect((await s.req("/comments", { token: "reader" })).status).toBe(200);
  });

  test("an agent opens a thread on a quote; a bad quote says how to fix it", async () => {
    const s = setup();
    await seed(s);
    const call = await mcp(s);
    const bad = await call("comment", {
      action: "open",
      path: "metrics/margin.md",
      quote: "nowhere in the body",
      body: "?",
    });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain("quote_not_found");
    const ok = await call("comment", {
      action: "open",
      path: "metrics/margin.md",
      quote: "Margin is",
      body: "Which margin, gross or net?",
    });
    expect(ok.text).toContain("Opened thread");
  });

  test("a stranger reaches no thread", async () => {
    const s = setup();
    await seed(s);
    const opened = (await (
      await post(s, "/comments", { path: "metrics/margin.md", body: "Mine." })
    ).json()) as { thread: { id: string } };
    const other = await s.stranger();
    const r = await other.app.request(`${API}/comments/${opened.thread.id}`);
    expect(r.status).toBe(404);
  });
});
