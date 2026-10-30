import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  broadcastPresence,
  FEED_MAX_AGE_MS,
  type FeedMessage,
  PRESENCE_SEARCH_PATHS,
  PRESENCE_THROTTLE_MS,
  Presence,
  type PresenceMessage,
  presenceCaller,
  presencePaths,
} from "../src/feed";
import { API, setup } from "./harness";

// Agents' presence on the change feed (TEMPRA-219): what an agent reads and searches now, sent to
// the library's sockets, throttled, never for people, never stored.

const agent = { actor: "claude-code/test", by: { person: "user_1", agent: "agt_1" } };
const concept = (path: string) => ({ kind: "concept", path, hash: "h" });

describe("presence messages", () => {
  test("a read, a page and a search name their files; the generated index names none", () => {
    expect(presencePaths("read", concept("a/b.md"))).toEqual(["a/b.md"]);
    expect(presencePaths("read", { kind: "attachment", path: "a/x.png" })).toEqual(["a/x.png"]);
    expect(presencePaths("read", { kind: "derived", path: "index.md" })).toEqual([]);
    expect(presencePaths("page", { file: concept("c.md"), head: 3 })).toEqual(["c.md"]);
    const results = Array.from({ length: 15 }, (_, i) => ({ path: `p${i}.md` }));
    expect(presencePaths("search", { seq: 1, results })).toHaveLength(PRESENCE_SEARCH_PATHS);
    expect(presencePaths("outline", { files: [] })).toEqual([]);
  });

  test("people are never presence: a human actor, or no caller at all", () => {
    const p = new Presence();
    expect(presenceCaller({ actor: "human:owner", created_by: "user_1" })).toBeNull();
    expect(p.message({ actor: "human:owner", by: null }, "read", concept("a.md"))).toBeNull();
    expect(p.message(null, "read", concept("a.md"))).toBeNull();
    expect(presenceCaller({ actor: "claude-code/x", created_by: "u", agent: "agt" })).toEqual({
      actor: "claude-code/x",
      by: { person: "u", agent: "agt" },
    });
  });

  test("only reads and searches; writes are the events' own", () => {
    const p = new Presence();
    expect(p.message(agent, "apply", { seq: 2, results: [concept("a.md")] })).toBeNull();
    expect(p.message(agent, "read", concept("a.md"))).toEqual({
      type: "presence",
      kind: "reading",
      actor: "claude-code/test",
      by: { person: "user_1", agent: "agt_1" },
      paths: ["a.md"],
    });
    expect(p.message(agent, "search", { results: [{ path: "b.md" }] })?.kind).toBe("searching");
  });

  test("throttled per agent and file, while the kind stays the same", () => {
    const p = new Presence();
    const t = 1_000_000;
    expect(p.message(agent, "read", concept("a.md"), t)?.paths).toEqual(["a.md"]);
    // The same agent on the same file, too soon: nothing.
    expect(p.message(agent, "read", concept("a.md"), t + 1000)).toBeNull();
    // Another agent, another file or another kind goes through.
    expect(
      p.message({ ...agent, actor: "other/x" }, "read", concept("a.md"), t + 1000),
    ).not.toBeNull();
    expect(p.message(agent, "read", concept("b.md"), t + 1000)).not.toBeNull();
    const found = p.message(
      agent,
      "search",
      { results: [{ path: "a.md" }, { path: "c.md" }] },
      t + 1000,
    );
    expect(found?.paths).toEqual(["a.md", "c.md"]);
    // A search's files already sent are left out of the next one.
    expect(
      p.message(agent, "search", { results: [{ path: "a.md" }, { path: "d.md" }] }, t + 2000)
        ?.paths,
    ).toEqual(["d.md"]);
    // Past the throttle, again.
    expect(p.message(agent, "read", concept("a.md"), t + PRESENCE_THROTTLE_MS)).not.toBeNull();
  });

  test("a change of kind always goes through: read, search, read again within the throttle", () => {
    // Found in the gate: the second read was held back, so the app went on showing the search.
    const p = new Presence();
    const t = 2_000_000;
    expect(p.message(agent, "read", concept("a.md"), t)?.kind).toBe("reading");
    expect(p.message(agent, "search", { results: [{ path: "a.md" }] }, t + 500)?.kind).toBe(
      "searching",
    );
    expect(p.message(agent, "read", concept("a.md"), t + 1000)?.paths).toEqual(["a.md"]);
    // The same kind again, too soon: held back.
    expect(p.message(agent, "read", concept("a.md"), t + 1500)).toBeNull();
  });

  test("each socket gets the files under its prefix; old or broken sockets are skipped", () => {
    const now = Date.now();
    const got: Record<string, FeedMessage[]> = { all: [], notes: [], other: [], old: [] };
    const socket = (name: string, prefix: string, opened = now) => ({
      prefix,
      opened,
      close: () => {
        throw new Error("presence never closes a socket");
      },
      send: (m: string) => got[name]?.push(JSON.parse(m) as FeedMessage),
    });
    const message: PresenceMessage = {
      type: "presence",
      kind: "searching",
      actor: "claude-code/test",
      by: null,
      paths: ["notes/a.md", "x.md"],
    };
    const sent = broadcastPresence(
      [
        socket("all", ""),
        socket("notes", "notes"),
        socket("other", "other"),
        socket("old", "", now - FEED_MAX_AGE_MS - 1),
        {
          prefix: "",
          opened: now,
          close: () => {},
          send: () => {
            throw new Error("closed");
          },
        },
      ],
      message,
      now,
    );
    expect(sent).toBe(2);
    expect(got.all).toEqual([message]);
    expect(got.notes).toEqual([{ ...message, paths: ["notes/a.md"] }]);
    expect(got.other).toEqual([]);
    expect(got.old).toEqual([]);
  });
});

describe("presence from the API and MCP", () => {
  async function library() {
    const s = setup();
    for (const [path, title, body] of [
      ["notes/alpha.md", "Alpha", "Pelicans fly over the bay."],
      ["notes/beta.md", "Beta", "Pelicans nest on the cliffs."],
      ["gamma.md", "Gamma", "Nothing about birds."],
    ] as const) {
      const r = await s.req(`/files/${path}`, {
        method: "PUT",
        headers: { "Content-Type": "text/markdown" },
        body: `---\ntype: Note\ntitle: ${title}\ndescription: A note.\n---\n${body}\n`,
      });
      expect(r.status).toBeLessThan(300);
    }
    // The writes themselves send no presence: their events are on the feed.
    expect(s.presence).toEqual([]);
    return s;
  }

  test("an agent's GET …/files and …/page are reading; a search marks what it returned", async () => {
    const s = await library();
    const read = await s.req("/files/notes/alpha.md", { headers: { Accept: "application/json" } });
    expect(read.status).toBe(200);
    const page = await s.req("/page/gamma.md", { token: "reader" });
    expect(page.status).toBe(200);
    const found = await s.req("/search?q=pelicans");
    expect(found.status).toBe(200);
    expect(s.presence.map((p) => [p.message.kind, p.message.actor, p.message.paths])).toEqual([
      ["reading", "claude-code/test", ["notes/alpha.md"]],
      ["reading", "claude-code/reader", ["gamma.md"]],
      [
        "searching",
        "claude-code/test",
        expect.arrayContaining(["notes/alpha.md", "notes/beta.md"]),
      ],
    ]);
    expect(s.presence.every((p) => p.doId === "lib-1")).toBe(true);
  });

  test("people's own reads in the app, and a human: token's, say nothing", async () => {
    const s = await library();
    expect((await s.app.request(`${API}/page/gamma.md`)).status).toBe(200);
    expect(
      (await s.app.request(`${API}/files/gamma.md`, { headers: { Accept: "application/json" } }))
        .status,
    ).toBe(200);
    expect((await s.app.request(`${API}/search?q=pelicans`)).status).toBe(200);
    expect((await s.req("/files/gamma.md", { token: "human" })).status).toBe(200);
    expect(s.presence).toEqual([]);
  });

  test("MCP read and search are presence, throttled", async () => {
    const s = await library();
    const transport = new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
      requestInit: { headers: { Authorization: "Bearer writer" } },
      fetch: async (url, init) => s.app.request(url.toString(), init as RequestInit),
    });
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(transport);
    const call = async (name: string, args: Record<string, unknown>) => {
      const r = await client.callTool({ name, arguments: args });
      expect(r.isError).toBeFalsy();
    };
    await call("read", { path: "notes/beta.md" });
    await call("read", { path: "notes/beta.md" });
    await call("search", { q: "pelicans" });
    const sent = s.presence.map((p) => [p.message.kind, p.message.paths]);
    // The second read came within the throttle; the search names both pelican pages.
    expect(sent[0]).toEqual(["reading", ["notes/beta.md"]]);
    expect(sent.filter(([k]) => k === "reading")).toHaveLength(1);
    const searched = sent.find(([k]) => k === "searching")?.[1] as string[];
    expect([...searched].sort()).toEqual(["notes/alpha.md", "notes/beta.md"]);
    // Reading what the search found, at once: a read is its own kind, not held by the search.
    await call("read", { path: "notes/alpha.md" });
    expect(s.presence.at(-1)?.message).toMatchObject({
      kind: "reading",
      paths: ["notes/alpha.md"],
    });
    await client.close();
  });
});
