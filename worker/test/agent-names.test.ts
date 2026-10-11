import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { feedEvent } from "../src/feed";
import { ORIGIN, setup } from "./harness";

// Agents named for their person in the tree's marks, the new-version notice and comment
// authors (TEMPRA-77): feed events and thread views carry the ledger's `by`.

type Text = { type: "text"; text: string };

async function shared() {
  const s = setup();
  const friend = await s.stranger("friend@example.com");
  await s.accounts.share("lib-1", friend.user.id, "write", "user_1");
  const minted = await friend.app.request("/api/v1/tokens", {
    method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json" },
    body: JSON.stringify({ library: "owner/demo", actor: "claude-code/laptop", scope: "write" }),
  });
  const { secret } = (await minted.json()) as { secret: string };
  const put = await s.req("/files/a.md", {
    method: "PUT",
    headers: { "Content-Type": "text/markdown" },
    body: "---\ntype: Note\n---\nA.\n",
    token: secret,
  });
  expect(put.status).toBe(200);
  return { s, friend, secret };
}

describe("who acted, by id", () => {
  test("feed events carry the person and agent", async () => {
    const { s, friend } = await shared();
    const [e] = s.store().events({}).events.map(feedEvent);
    expect(e?.by?.person).toBe(friend.user.id);
    expect(e?.by?.agent).toMatch(/^agt_/);
  });

  test("comments and their actions carry it; the MCP transcript names the agent", async () => {
    const { s, secret } = await shared();
    const transport = new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
      requestInit: { headers: { Authorization: `Bearer ${secret}` } },
      fetch: async (url, init) => s.app.request(url.toString(), init as RequestInit),
    });
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(transport);
    const call = async (name: string, args: Record<string, unknown>) => {
      const r = await client.callTool({ name, arguments: args });
      return (r.content as Text[]).map((c) => c.text).join("\n");
    };
    await call("comment", { action: "open", path: "a.md", body: "Is this right?" });
    // The owner replies in the app: a person, no agent.
    const listed = (await (await s.req("/comments?path=a.md")).json()) as {
      threads: {
        id: string;
        comments: { by?: { agent?: string } }[];
        actions: { by?: object }[];
      }[];
    };
    const t = listed.threads[0];
    if (!t) throw new Error("no thread");
    await s.app.request(`/api/v1/libraries/owner/demo/comments/${t.id}`, {
      method: "POST",
      headers: { Origin: ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reply", body: "Yes." }),
    });
    expect(t.comments[0]?.by?.agent).toMatch(/^agt_/);
    expect(t.actions[0]?.by).toEqual(t.comments[0]?.by as object);
    const text = await call("comments", { path: "a.md" });
    expect(text).toContain("- claude-code for @friend at");
    expect(text).toContain("- human:owner at");
  });
});
