import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { ORIGIN, setup } from "./harness";

const REDIRECT = "https://claude.ai/api/mcp/auth_callback";

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

type App = ReturnType<typeof setup>["app"];

async function register(app: App, name = "Claude", redirect = REDIRECT) {
  const r = await app.request("/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: name,
      redirect_uris: [redirect],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  });
  expect(r.status).toBe(201);
  return ((await r.json()) as { client_id: string }).client_id;
}

/** Starts an authorization: returns the consent page, its handle and cookies, and the PKCE verifier. */
async function begin(
  app: App,
  clientId: string,
  scope = "okf:read okf:write",
  redirect = REDIRECT,
) {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(sha256(new TextEncoder().encode(verifier)));
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirect,
    scope,
    state: "st4te",
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: `${ORIGIN}/mcp`,
  });
  const url = `/authorize?${query}`;
  const page = await app.request(url);
  const html = await page.text();
  const handle = /name="handle" value="([^"]+)"/.exec(html)?.[1] ?? "";
  const cookies = page.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  return { page, html, handle, cookies, url, verifier };
}

async function submit(
  app: App,
  flow: Awaited<ReturnType<typeof begin>>,
  fields: Record<string, string>,
) {
  return app.request(flow.url, {
    method: "POST",
    headers: { Cookie: flow.cookies, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ handle: flow.handle, decision: "approve", ...fields }),
    redirect: "manual",
  });
}

async function exchange(
  app: App,
  clientId: string,
  location: string,
  verifier: string,
  redirect = REDIRECT,
) {
  const code = new URL(location).searchParams.get("code") ?? "";
  const r = await app.request("/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirect,
      client_id: clientId,
      code_verifier: verifier,
      resource: `${ORIGIN}/mcp`,
    }),
  });
  expect(r.status).toBe(200);
  return (await r.json()) as { access_token: string; refresh_token: string; scope: string };
}

type Apps = {
  apps: { id: string; app: string; actor: string | null; libraries: "all" | string[] }[];
};

async function apps(app: App): Promise<Apps["apps"]> {
  const r = await app.request("/api/v1/apps");
  expect(r.status).toBe(200);
  return ((await r.json()) as Apps).apps;
}

/** The app's API, as its pages call it: JSON, from this site. */
function api(app: App, path: string, method: string, body?: unknown, origin = ORIGIN) {
  return app.request(path, {
    method,
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function mcp(app: App, token: string) {
  const transport = new StreamableHTTPClientTransport(new URL(`${ORIGIN}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
    fetch: async (url, init) => app.request(url.toString(), init as RequestInit),
  });
  const client = new Client({ name: "oauth-test", version: "1.0.0" });
  await client.connect(transport);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args });
    return {
      text: (r.content as { text: string }[]).map((c) => c.text).join("\n"),
      isError: !!r.isError,
    };
  };
  return { client, call };
}

/** Makes a second account with its own library; returns its handle. */
async function setupStranger(accounts: ReturnType<typeof setup>["accounts"]): Promise<string> {
  const user = await accounts.user("stranger@example.com");
  await accounts.createLibrary("demo", user);
  return user.handle;
}

const approve = {
  library: "demo",
  new_library: "",
  access: "write",
  prefix: "",
  actor: "claude-ai/connector",
  tiers: "all",
};

describe("OAuth for MCP clients", () => {
  test("discovery: /mcp challenges with protected-resource metadata", async () => {
    const { app } = setup();
    const r = await app.request("/mcp", { method: "POST", body: "{}" });
    expect(r.status).toBe(401);
    expect(r.headers.get("WWW-Authenticate")).toContain(
      `resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`,
    );
    const prm = (await (await app.request("/.well-known/oauth-protected-resource/mcp")).json()) as {
      resource: string;
      authorization_servers: string[];
    };
    expect(prm.resource).toBe(`${ORIGIN}/mcp`);
    const asm = (await (
      await app.request("/.well-known/oauth-authorization-server")
    ).json()) as Record<string, unknown>;
    expect(asm.authorization_endpoint).toBe(`${ORIGIN}/authorize`);
    expect(asm.registration_endpoint).toBe(`${ORIGIN}/register`);
    expect(asm.code_challenge_methods_supported).toEqual(["S256"]);
    expect(asm.client_id_metadata_document_supported).toBe(true);
  });

  test("connect, consent, token, and a write attributed to the app", async () => {
    const { app, accounts } = setup();
    const clientId = await register(app);
    const flow = await begin(app, clientId);
    expect(flow.page.status).toBe(200);
    expect(flow.html).toContain("<h1>Connect Claude</h1>");
    expect(flow.html).toContain("Signed in as owner@example.com");
    expect(flow.html).toContain("<strong>claude.ai</strong>");
    expect(flow.html).toContain('value="claude/connector"');

    const done = await submit(app, flow, approve);
    expect(done.status).toBe(302);
    const location = done.headers.get("Location") ?? "";
    expect(location.startsWith(`${REDIRECT}?`)).toBe(true);
    expect(new URL(location).searchParams.get("state")).toBe("st4te");
    const tokens = await exchange(app, clientId, location, flow.verifier);
    expect(tokens.scope.split(" ").sort()).toEqual(["okf:read", "okf:write"]);
    expect((await accounts.user("owner@example.com")).actor).toBe("human:owner");

    const { call } = await mcp(app, tokens.access_token);
    const w = await call("write", {
      path: "a.md",
      content: "---\ntype: Note\n---\nhi\n",
      note: "via oauth",
    });
    expect(w.isError).toBe(false);
    expect((await call("read", { path: "a.md" })).text).toContain("by: claude-ai/connector");
    expect((await call("start")).text).toContain("You are claude-ai/connector (write)");
  });

  test("a read-only grant cannot write", async () => {
    const { app } = setup();
    const clientId = await register(app, "ChatGPT");
    const flow = await begin(app, clientId, "okf:read");
    expect(flow.html).toContain('value="read" checked');
    const done = await submit(app, flow, {
      ...approve,
      access: "read",
      actor: "chatgpt/connector",
    });
    const tokens = await exchange(app, clientId, done.headers.get("Location") ?? "", flow.verifier);
    expect(tokens.scope).toBe("okf:read");
    const { call } = await mcp(app, tokens.access_token);
    const w = await call("write", { path: "a.md", content: "---\ntype: Note\n---\nhi\n" });
    expect(w.isError).toBe(true);
    expect(w.text).toContain("read_only");
    expect((await call("start")).isError).toBe(false);
  });

  test("a new library, a directory limit and file tools only", async () => {
    const { app, accounts } = setup();
    const clientId = await register(app);
    const flow = await begin(app, clientId);
    const done = await submit(app, flow, {
      ...approve,
      library: "",
      new_library: "team-notes",
      prefix: "inbox",
      tiers: "files",
    });
    const tokens = await exchange(app, clientId, done.headers.get("Location") ?? "", flow.verifier);
    expect((await accounts.libraries("user_1")).map((l) => l.slug)).toContain("team-notes");
    const { client, call } = await mcp(app, tokens.access_token);
    const tools = (await client.listTools()).tools.map((t) => t.name);
    expect(tools).not.toContain("search");
    expect(
      (await call("write", { path: "x.md", content: "---\ntype: Note\n---\n" })).text,
    ).toContain("outside_prefix");
    expect(
      (await call("write", { path: "inbox/x.md", content: "---\ntype: Note\n---\n" })).isError,
    ).toBe(false);
    expect((await call("start")).text).toContain("Library owner/team-notes");
  });

  test("invalid choices re-show the page; cancelling returns access_denied", async () => {
    const { app } = setup();
    const clientId = await register(app);
    const flow = await begin(app, clientId);
    const bad = await submit(app, flow, { ...approve, actor: "human:me" });
    expect(bad.status).toBe(400);
    expect(await bad.text()).toContain("The ledger name must look like app/label");
    // The same handle still works after the error.
    const denied = await submit(app, flow, { decision: "deny" });
    expect(denied.status).toBe(302);
    expect(new URL(denied.headers.get("Location") ?? "").searchParams.get("error")).toBe(
      "access_denied",
    );
  });

  test("grants are listed and revoked; a revoked token stops working", async () => {
    const { app } = setup();
    const clientId = await register(app);
    const flow = await begin(app, clientId);
    const done = await submit(app, flow, approve);
    const tokens = await exchange(app, clientId, done.headers.get("Location") ?? "", flow.verifier);

    const list = await apps(app);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ app: "Claude", actor: "claude-ai/connector" });
    const grant = list[0]?.id ?? "";

    const forged = await api(
      app,
      `/api/v1/apps/${grant}`,
      "DELETE",
      undefined,
      "https://evil.example",
    );
    expect(forged.status).toBe(403);
    const byToken = await app.request(`/api/v1/apps/${grant}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    expect(byToken.status).toBe(403);
    const revoked = await api(app, `/api/v1/apps/${grant}`, "DELETE");
    expect(revoked.status).toBe(204);
    expect(await apps(app)).toEqual([]);
    const r = await app.request("/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(r.status).toBe(401);
    // A Bearer challenge, so the client signs in again rather than showing no tools.
    expect(r.headers.get("WWW-Authenticate")).toContain('error="invalid_token"');
    expect(r.headers.get("WWW-Authenticate")).toContain("oauth-protected-resource/mcp");
  });

  test("a connection whose account was deleted outright is told to sign in again", async () => {
    const { app, db } = setup();
    const clientId = await register(app);
    const flow = await begin(app, clientId);
    const done = await submit(app, flow, approve);
    const tokens = await exchange(app, clientId, done.headers.get("Location") ?? "", flow.verifier);
    // A data reset: the account rows go, the OAuth grant stays behind in KV.
    for (const t of [
      "tokens",
      "sessions",
      "sign_in_links",
      "library_members",
      "agents",
      "libraries",
      "handle_holds",
      "users",
    ]) {
      db.run(`DELETE FROM ${t}`);
    }
    const r = await app.request("/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(r.status).toBe(401);
    expect(r.headers.get("WWW-Authenticate")).toContain('error="invalid_token"');
  });

  test("deleting the library, or the account, revokes its connections", async () => {
    for (const how of ["library", "account"] as const) {
      const { app } = setup();
      const clientId = await register(app);
      const flow = await begin(app, clientId);
      const done = await submit(app, flow, approve);
      const tokens = await exchange(
        app,
        clientId,
        done.headers.get("Location") ?? "",
        flow.verifier,
      );
      const [path, confirm] =
        how === "library"
          ? ["/api/v1/libraries/owner/demo/delete", "demo"]
          : ["/api/v1/account/delete", "owner"];
      const del = await api(app, path, "POST", { confirm });
      expect(del.status).toBe(204);
      const r = await app.request("/mcp", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      expect(r.status).toBe(401);
    }
  });

  test("all libraries: every library the account owns, including later ones", async () => {
    const { app, accounts } = setup();
    const clientId = await register(app);
    const flow = await begin(app, clientId);
    expect(flow.html).toContain('name="libraries" value="all" checked');
    const done = await submit(app, flow, { ...approve, libraries: "all", library: "" });
    const tokens = await exchange(app, clientId, done.headers.get("Location") ?? "", flow.verifier);
    const { client, call } = await mcp(app, tokens.access_token);

    // One library: no `library` needed.
    expect((await call("start")).text).toContain("# Library owner/demo");
    await accounts.createLibrary("developers", { id: "user_1", handle: "owner" });
    const listed = await call("start");
    expect(listed.text).toContain("# Your libraries (2)");
    expect(listed.text).toContain("- owner/developers");
    const ambiguous = await call("read", { path: "a.md" });
    expect(ambiguous.isError).toBe(true);
    expect(ambiguous.text).toContain("library_required");

    const note = "---\ntype: Note\n---\nhi\n";
    expect(
      (await call("write", { library: "owner/developers", path: "a.md", content: note })).isError,
    ).toBe(false);
    expect((await call("read", { library: "developers", path: "a.md" })).text).toContain(
      "by: claude-ai/connector",
    );
    expect((await call("read", { library: "owner/demo", path: "a.md" })).text).toContain(
      "not_found",
    );
    expect((await call("start", { library: "developers" })).text).toContain(
      "Other libraries you can reach: owner/demo",
    );
    const uris = (await client.listResources()).resources.map((r) => r.uri);
    expect(uris).toContain("okf://owner/developers/a.md");

    // Another account's library is not reachable by name.
    const other = await setupStranger(accounts);
    const theirs = await call("read", { library: `${other}/demo`, path: "a.md" });
    expect(theirs.text).toContain("no_library");

    // Deleting one library keeps a connection to all of them.
    const del = await api(app, "/api/v1/libraries/owner/developers/delete", "POST", {
      confirm: "developers",
    });
    expect(del.status).toBe(204);
    expect((await call("start")).text).toContain("# Library owner/demo");
    expect((await apps(app))[0]?.libraries).toBe("all");
  });

  test("a member connects their own agent to a shared library, held to their role", async () => {
    const s = setup();
    const friend = await s.stranger("friend@example.com");
    await s.accounts.share("lib-1", friend.user.id, "write", "user_1");
    const clientId = await register(friend.app);
    const flow = await begin(friend.app, clientId);
    // Their own demo by slug; the owner's as owner/slug, marked shared with their role.
    expect(flow.html).toContain('name="library" value="demo"');
    expect(flow.html).toContain('name="library" value="owner/demo"');
    expect(flow.html).toContain("shared with you, write");
    const done = await submit(friend.app, flow, {
      ...approve,
      libraries: "selected",
      library: "owner/demo",
    });
    const tokens = await exchange(
      friend.app,
      clientId,
      done.headers.get("Location") ?? "",
      flow.verifier,
    );
    const { call } = await mcp(friend.app, tokens.access_token);
    expect((await call("start")).text).toContain("# Library owner/demo");
    const note = "---\ntype: Note\n---\nFrom the friend's agent.\n";
    expect((await call("write", { path: "f.md", content: note })).isError).toBe(false);
    // Their writes count against their own account, not the owner's.
    const writes = s.usage.filter((e) => e.kind === "write").map((e) => e.account);
    expect(writes).toContain("friend");
    expect(writes).not.toContain("owner");
    expect(await apps(friend.app)).toMatchObject([{ libraries: ["owner/demo"] }]);

    // Lowered to read: the same connection reads and comments, and cannot write.
    await s.accounts.share("lib-1", friend.user.id, "read", "user_1");
    const refused = await call("write", { path: "g.md", content: note });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("read_only");
    const comment = await call("comment", { action: "open", path: "f.md", body: "A question." });
    expect(comment.isError).toBe(false);

    // Removed: the library is gone from the connection.
    await s.accounts.unshare("lib-1", friend.user.id);
    expect((await call("read", { library: "owner/demo", path: "f.md" })).text).toContain(
      "no_library",
    );
  });

  test("all libraries means the account's own, never ones shared with it", async () => {
    const s = setup();
    const friend = await s.stranger("friend@example.com");
    await s.accounts.share("lib-1", friend.user.id, "write", "user_1");
    const clientId = await register(friend.app);
    const flow = await begin(friend.app, clientId);
    const done = await submit(friend.app, flow, { ...approve, libraries: "all", library: "" });
    const tokens = await exchange(
      friend.app,
      clientId,
      done.headers.get("Location") ?? "",
      flow.verifier,
    );
    const { call } = await mcp(friend.app, tokens.access_token);
    expect((await call("start")).text).toContain("# Library friend/demo");
    expect((await call("read", { library: "owner/demo", path: "a.md" })).text).toContain(
      "no_library",
    );
  });

  test("each person's agents are their own identities, recorded in the ledger", async () => {
    const s = setup();
    const friend = await s.stranger("friend@example.com");
    await s.accounts.share("lib-1", friend.user.id, "write", "user_1");
    const CHATGPT = "https://chatgpt.com/connector_platform_oauth_redirect";
    /** Connects an app as a person, to the owner's demo, and writes one note through it. */
    const connect = async (app: App, name: string, redirect: string, pick: string) => {
      const clientId = await register(app, name, redirect);
      const flow = await begin(app, clientId, "okf:read okf:write", redirect);
      const done = await submit(app, flow, { ...approve, libraries: "selected", library: pick });
      const t = await exchange(
        app,
        clientId,
        done.headers.get("Location") ?? "",
        flow.verifier,
        redirect,
      );
      const { call } = await mcp(app, t.access_token);
      const path = `${name.toLowerCase()}-${crypto.randomUUID().slice(0, 8)}.md`;
      const w = await call("write", { path, content: "---\ntype: Note\n---\nHi.\n" });
      expect(w.isError).toBe(false);
    };
    await connect(s.app, "Claude", REDIRECT, "demo");
    await connect(s.app, "ChatGPT", CHATGPT, "demo");
    await connect(friend.app, "Claude", REDIRECT, "owner/demo");
    await connect(friend.app, "ChatGPT", CHATGPT, "owner/demo");
    // Connecting the same app again is the same agent.
    await connect(friend.app, "Claude", REDIRECT, "owner/demo");

    const r = await s.app.request("/api/v1/libraries/owner/demo/agents");
    expect(r.status).toBe(200);
    const { contributors } = (await r.json()) as {
      contributors: {
        person: string;
        agent: { id: string; name: string; platform: string; client: string | null };
        requests: number;
      }[];
    };
    const seen = contributors.map((c) => `${c.agent.name} (${c.agent.platform}) for ${c.person}`);
    expect(seen.sort()).toEqual([
      "ChatGPT (chatgpt.com) for friend",
      "ChatGPT (chatgpt.com) for owner",
      "Claude (claude.ai) for friend",
      "Claude (claude.ai) for owner",
    ]);
    expect(new Set(contributors.map((c) => c.agent.id)).size).toBe(4);
    const friendsClaude = contributors.find(
      (c) => c.person === "friend" && c.agent.name === "Claude",
    );
    expect(friendsClaude?.requests).toBe(2);
    // What the client said at MCP initialize, kept as a claim.
    expect(friendsClaude?.agent.client).toBe("oauth-test 1.0.0");

    // Each request names its person and agent by id, stable across handle changes.
    const log = (await (await s.req("/requests", { token: "human" })).json()) as {
      requests: { by: { person: string; agent?: string } | null }[];
    };
    expect(log.requests[0]?.by).toEqual({
      person: friend.user.id,
      agent: friendsClaude?.agent.id as string,
    });
  });

  test("selected libraries: only those, and a suspended account is cut off", async () => {
    const { app, accounts, db } = setup();
    await accounts.createLibrary("private", { id: "user_1", handle: "owner" });
    const clientId = await register(app);
    const flow = await begin(app, clientId);
    const done = await submit(app, flow, { ...approve, libraries: "selected" });
    const tokens = await exchange(app, clientId, done.headers.get("Location") ?? "", flow.verifier);
    const { call } = await mcp(app, tokens.access_token);
    expect((await call("start")).text).toContain("# Library owner/demo");
    expect((await call("read", { library: "owner/private", path: "a.md" })).text).toContain(
      "no_library",
    );
    // A library created later is not selected.
    await accounts.createLibrary("later", { id: "user_1", handle: "owner" });
    expect((await call("start")).text).toContain("# Library owner/demo");
    expect((await apps(app))[0]?.libraries).toEqual(["demo"]);

    db.run("UPDATE users SET suspended = ? WHERE id = ?", [new Date().toISOString(), "user_1"]);
    const r = await app.request("/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(r.status).toBe(401);
    // A Bearer challenge, so the client signs in again rather than showing no tools.
    expect(r.headers.get("WWW-Authenticate")).toContain('error="invalid_token"');
    expect(r.headers.get("WWW-Authenticate")).toContain("oauth-protected-resource/mcp");
  });

  test("a connection whose account was deleted outright is told to sign in again", async () => {
    const { app, db } = setup();
    const clientId = await register(app);
    const flow = await begin(app, clientId);
    const done = await submit(app, flow, approve);
    const tokens = await exchange(app, clientId, done.headers.get("Location") ?? "", flow.verifier);
    // A data reset: the account rows go, the OAuth grant stays behind in KV.
    for (const t of [
      "tokens",
      "sessions",
      "sign_in_links",
      "library_members",
      "agents",
      "libraries",
      "handle_holds",
      "users",
    ]) {
      db.run(`DELETE FROM ${t}`);
    }
    const r = await app.request("/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(r.status).toBe(401);
    expect(r.headers.get("WWW-Authenticate")).toContain('error="invalid_token"');
  });

  test("selecting nothing re-shows the page", async () => {
    const { app } = setup();
    const clientId = await register(app);
    const flow = await begin(app, clientId);
    const bad = await submit(app, flow, { ...approve, libraries: "selected", library: "" });
    expect(bad.status).toBe(400);
    expect(await bad.text()).toContain("Pick at least one library");
  });

  test("bearer tokens still work on /mcp alongside OAuth", async () => {
    const { app } = setup();
    const { call } = await mcp(app, "writer");
    expect((await call("start")).text).toContain("You are claude-code/test");
  });
});
