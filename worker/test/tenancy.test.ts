import { describe, expect, test } from "bun:test";
import { API, ORIGIN, setup, UI } from "./harness";
import { approve, connectApp } from "./oauth-flow";

type S = ReturnType<typeof setup>;

/** Fills a route pattern's parameters and wildcard with plausible values. */
function fill(path: string, lib = "demo"): string {
  return path
    .replace(":owner", "owner")
    .replace(":lib", lib)
    .replace(":request", "req_1")
    .replace(":date", "2026-10-01")
    .replace(":file", "bundle.tar")
    .replace(":id", "tok_1")
    .replace("*", "a.md");
}

/** Every route that names a library by {owner}/{slug}, with its method. */
async function libraryRoutes(s: S) {
  // Imported after the harness has stubbed cloudflare:workers.
  const { createApp } = await import("../src/app");
  const app = createApp(() => s.deps);
  const seen = new Set<string>();
  return app.routes
    .filter((r) => r.method !== "ALL" && r.path.includes(":owner/:lib"))
    .filter((r) => {
      const key = `${r.method} ${r.path}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

async function seedOwnerContent(s: S) {
  const r = await s.req("/files/a.md", {
    method: "PUT",
    headers: { "Content-Type": "text/markdown" },
    body: "---\ntype: Note\n---\nThe owner's secret note.\n",
  });
  expect(r.status).toBe(200);
}

/**
 * Every library route, on the owner's library `lib`, as a stranger's session, write token and
 * human: token: what did not answer 404, or showed the owner's secret note.
 */
async function strangerFailures(
  s: S,
  other: Awaited<ReturnType<S["stranger"]>>,
  routes: Awaited<ReturnType<typeof libraryRoutes>>,
  lib = "demo",
): Promise<string[]> {
  const failures: string[] = [];
  for (const r of routes) {
    const path = fill(r.path, lib);
    const attempts: [string, Promise<Response>][] = !path.startsWith("/api/")
      ? [
          [
            "session",
            other.app.request(path, {
              method: r.method,
              headers: { Origin: ORIGIN },
              body: r.method === "GET" ? undefined : new URLSearchParams({ confirm: lib }),
              redirect: "manual",
            }),
          ],
        ]
      : [
          ...[other.writer, other.human].map((token): [string, Promise<Response>] => [
            token === other.writer ? "write token" : "human token",
            s.anon.request(path, {
              method: r.method,
              headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
              body:
                r.method === "GET" || r.method === "DELETE"
                  ? undefined
                  : JSON.stringify({ confirm: lib }),
            }),
          ]),
          // The app's own pages call the API with the session (TEMPRA-9).
          [
            "session",
            other.app.request(path, {
              method: r.method,
              headers: { Origin: ORIGIN, "Content-Type": "application/json" },
              body:
                r.method === "GET" || r.method === "DELETE"
                  ? undefined
                  : JSON.stringify({ confirm: lib }),
            }),
          ],
        ];
    for (const [who, res] of attempts) {
      const got = await res;
      const body = await got.text();
      // Adding the trailing slash redirects any name alike, so it tells nothing.
      if (got.status === 301 && got.headers.get("Location") === `${path}/`) continue;
      if (got.status !== 404 || body.includes("secret note")) {
        failures.push(`${r.method} ${r.path} as the stranger's ${who}: ${got.status}`);
      }
    }
  }
  return failures;
}

describe("tenancy (v2 spec: Tenancy and authorization)", () => {
  test("every library route answers a stranger's session or tokens with 404", async () => {
    const s = setup();
    await seedOwnerContent(s);
    const other = await s.stranger();
    const routes = await libraryRoutes(s);
    // The UI's pages and the REST API, all of them.
    expect(routes.filter((r) => !r.path.startsWith("/api/")).length).toBeGreaterThan(15);
    expect(routes.filter((r) => r.path.startsWith("/api/")).length).toBeGreaterThan(20);

    expect(await strangerFailures(s, other, routes)).toEqual([]);

    // Nothing was written to the owner's library.
    expect(s.store().headSeq()).toBe(1);
  });

  test("a library the owner's agent created is a 404 to a stranger on every route", async () => {
    const s = setup();
    const { call } = await connectApp(s.app, {
      ...approve,
      libraries: "all",
      library: "",
      create_libraries: "on",
    });
    expect((await call("create_library", { slug: "agent-made" })).isError).toBe(false);
    const w = await call("write", {
      library: "owner/agent-made",
      path: "a.md",
      content: "---\ntype: Note\n---\nThe owner's secret note.\n",
    });
    expect(w.isError).toBe(false);
    const other = await s.stranger();
    const routes = await libraryRoutes(s);
    expect(await strangerFailures(s, other, routes, "agent-made")).toEqual([]);
    // Its owner is the person, with the agent's write attributed to them.
    expect((await s.app.request("/api/v1/libraries/owner/agent-made/files/a.md")).status).toBe(200);
  });

  test("the same name under another owner is a different library", async () => {
    const s = setup();
    await seedOwnerContent(s);
    const other = await s.stranger();
    const theirs = await other.app.request("/stranger/demo/");
    expect(theirs.status).toBe(200);
    expect(await theirs.text()).not.toContain("a.md");
    const tree = await s.anon.request("/api/v1/libraries/stranger/demo/tree", {
      headers: { Authorization: `Bearer ${other.writer}` },
    });
    expect(tree.status).toBe(200);
    expect(JSON.stringify(await tree.json())).not.toContain("a.md");
    // And the owner cannot open the stranger's.
    expect((await s.app.request("/stranger/demo/")).status).toBe(404);
    const ownerToken = await s.anon.request("/api/v1/libraries/stranger/demo/tree", {
      headers: { Authorization: "Bearer writer" },
    });
    expect(ownerToken.status).toBe(404);
  });

  test("lists and token management show and touch only the account's own", async () => {
    const s = setup();
    const other = await s.stranger();
    // The owner mints a token in the app.
    const minted = await s.app.request("/api/v1/tokens", {
      method: "POST",
      headers: { Origin: ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({ library: "demo", actor: "claude-code/mine", scope: "write" }),
    });
    expect(minted.status).toBe(201);
    const ownerTokens = await s.accounts.tokens("user_1");
    const ownerTokenId = ownerTokens[0]?.id ?? "";
    expect(ownerTokenId).toStartWith("tok_");

    const home = await (await other.app.request("/api/v1/libraries")).text();
    expect(home).toContain('"owner":"stranger","slug":"demo"');
    expect(home).not.toContain('"owner":"owner"');
    const tokens = await (await other.app.request("/api/v1/tokens")).text();
    expect(tokens).not.toContain("claude-code/mine");
    expect(tokens).toContain("claude-code/stranger");

    // Revoking the owner's token from the stranger's session, or with their human: token.
    const ui = await other.app.request(`/api/v1/tokens/${ownerTokenId}`, {
      method: "DELETE",
      headers: { Origin: ORIGIN },
    });
    expect(ui.status).toBe(404);
    const rest = await s.anon.request(`/api/v1/tokens/${ownerTokenId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${other.human}` },
    });
    expect(rest.status).toBe(404);
    expect((await s.accounts.tokens("user_1"))[0]?.revoked).toBeNull();

    // REST lists are the stranger's own; minting for the owner's library is refused.
    const auth = { Authorization: `Bearer ${other.human}` };
    const libs = (await (await s.anon.request("/api/v1/libraries", { headers: auth })).json()) as {
      libraries: { id: string; owner: string }[];
    };
    expect(libs.libraries.map((l) => l.owner)).toEqual(["stranger"]);
    const listed = (await (await s.anon.request("/api/v1/tokens", { headers: auth })).json()) as {
      tokens: { id: string }[];
    };
    expect(listed.tokens.map((t) => t.id)).not.toContain(ownerTokenId);
    const forOwnerLib = await s.anon.request("/api/v1/tokens", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ library: "lib-1", actor: "claude-code/x", scope: "write" }),
    });
    expect(forOwnerLib.status).toBe(404);
  });

  test("OAuth consent offers only the signed-in account's libraries", async () => {
    const s = setup();
    const other = await s.stranger();
    await s.accounts.createLibrary("private-notes", { id: "user_1", handle: "owner" });
    const reg = await s.anon.request("/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "Claude",
        redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
        token_endpoint_auth_method: "none",
      }),
    });
    const { client_id } = (await reg.json()) as { client_id: string };
    const q = new URLSearchParams({
      response_type: "code",
      client_id,
      redirect_uri: "https://claude.ai/api/mcp/auth_callback",
      scope: "okf:read okf:write",
      state: "s",
      code_challenge: "x".repeat(43),
      code_challenge_method: "S256",
    });
    const page = await (await other.app.request(`/authorize?${q}`)).text();
    expect(page).toContain("stranger@example.com");
    expect(page).toContain('name="library" value="demo"');
    expect(page).not.toContain("private-notes");
  });

  test("a read member reads and comments, and every other change is refused", async () => {
    const s = setup();
    await seedOwnerContent(s);
    const friend = await s.stranger("friend@example.com");
    await s.accounts.share("lib-1", friend.user.id, "read", "user_1");
    const as = (path: string, init: RequestInit = {}) =>
      friend.app.request(`${API}${path}`, {
        ...init,
        headers: { Origin: ORIGIN, "Content-Type": "application/json", ...init.headers },
      });

    const read = await as("/files/a.md");
    expect(read.status).toBe(200);
    expect(await read.text()).toContain("secret note");
    expect((await friend.app.request(`${UI}/`)).status).toBe(200);
    const comment = await as("/comments", {
      method: "POST",
      body: JSON.stringify({ path: "a.md", body: "Is this still true?" }),
    });
    expect(comment.status).toBe(201);
    const seqAfterComment = s.store().headSeq();

    const put = await as("/files/a.md", {
      method: "PUT",
      headers: { "Content-Type": "text/markdown" },
      body: "---\ntype: Note\n---\nChanged.\n",
    });
    expect(put.status).toBe(403);
    expect(await put.text()).toContain("read and comment");

    // Every other state-changing route, REST and UI: nothing lands.
    const failures: string[] = [];
    for (const r of await libraryRoutes(s)) {
      if (r.method === "GET" || r.path.includes("/comments")) continue;
      const path = fill(r.path);
      const got = await friend.app.request(path, {
        method: r.method,
        headers: { Origin: ORIGIN, "Content-Type": "application/json" },
        body: r.method === "DELETE" ? undefined : JSON.stringify({ confirm: "demo", path: "a.md" }),
      });
      if (got.status < 400) failures.push(`${r.method} ${r.path}: ${got.status}`);
    }
    expect(failures).toEqual([]);
    expect(s.store().headSeq()).toBe(seqAfterComment);
  });

  test("a write member writes and verifies as themselves; owner-only stays the owner's", async () => {
    const s = setup();
    await seedOwnerContent(s);
    const friend = await s.stranger("friend@example.com");
    await s.accounts.share("lib-1", friend.user.id, "write", "user_1");
    const as = (path: string, init: RequestInit = {}) =>
      friend.app.request(`${API}${path}`, {
        ...init,
        headers: { Origin: ORIGIN, "Content-Type": "application/json", ...init.headers },
      });

    const put = await as("/files/b.md", {
      method: "PUT",
      headers: { "Content-Type": "text/markdown" },
      body: "---\ntype: Note\n---\nThe friend's note.\n",
    });
    expect(put.status).toBe(200);
    expect((await as("/verify/a.md", { method: "POST" })).status).toBe(200);
    const log = (await (await as("/requests")).json()) as { requests: { actor: string }[] };
    expect(log.requests.map((r) => r.actor)).toContain("human:friend");

    for (const [path, body] of [
      ["/delete", { confirm: "demo" }],
      ["/restore", { to: new Date().toISOString() }],
      ["/maintain", {}],
    ] as const) {
      const got = await as(path, { method: "POST", body: JSON.stringify(body) });
      expect(got.status).toBe(403);
      expect(await got.text()).toContain("owner_only");
    }
    expect((await as("/restores")).status).toBe(403);
    // The owner still can.
    expect((await s.req("/restores", { token: "human" })).status).toBe(200);
  });

  test("shared libraries are listed with the role; removing a member cuts them off at once", async () => {
    const s = setup();
    const friend = await s.stranger("friend@example.com");
    await s.accounts.share("lib-1", friend.user.id, "read", "user_1");
    const list = (await (await friend.app.request("/api/v1/libraries")).json()) as {
      libraries: { owner: string; slug: string; role: string }[];
    };
    expect(list.libraries.map((l) => `${l.owner}/${l.slug}:${l.role}`)).toEqual([
      "friend/demo:owner",
      "owner/demo:read",
    ]);
    // Owner-only lists stay the account's own.
    expect((await s.accounts.libraries(friend.user.id)).map((l) => l.owner)).toEqual(["friend"]);
    expect(await s.accounts.members("lib-1")).toMatchObject([{ handle: "friend", role: "read" }]);

    expect((await friend.app.request(`${API}/tree`)).status).toBe(200);
    expect(await s.accounts.unshare("lib-1", friend.user.id)).toBe(true);
    expect((await friend.app.request(`${API}/tree`)).status).toBe(404);
    expect((await friend.app.request(`${UI}/`)).status).toBe(404);
  });

  test("a member's token acts at their role now, never as the owner", async () => {
    const s = setup();
    const friend = await s.stranger("friend@example.com");
    await s.accounts.share("lib-1", friend.user.id, "write", "user_1");
    const mint = async (actor: string) =>
      (
        await s.accounts.createToken({
          libraryId: "lib-1",
          actor,
          scope: "write",
          prefix: null,
          expires: null,
          mcpTiers: "all",
          createdBy: friend.user.id,
        })
      ).secret;
    const agent = await mint("claude-code/friend");
    const human = await mint("human:friend");
    const put = (token: string) =>
      s.req("/files/c.md", {
        method: "PUT",
        token,
        headers: { "Content-Type": "text/markdown" },
        body: "---\ntype: Note\n---\nBy the friend's agent.\n",
      });
    expect((await put(agent)).status).toBe(200);
    // A human: token acts for the person who minted it, not the library's owner.
    const me = await s.anon.request("/api/v1/me", {
      headers: { Authorization: `Bearer ${human}` },
    });
    expect(((await me.json()) as { handle: string }).handle).toBe("friend");
    expect((await s.req("/restores", { token: human })).status).toBe(403);

    await s.accounts.share("lib-1", friend.user.id, "read", "user_1");
    expect((await put(agent)).status).toBe(403);
    const comment = await s.req("/comments", {
      method: "POST",
      token: agent,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "c.md", body: "Still here, read only." }),
    });
    expect(comment.status).toBe(201);

    await s.accounts.unshare("lib-1", friend.user.id);
    const gone = await s.req("/tree", { token: agent });
    expect(gone.status).toBe(401);
    expect(await gone.text()).toContain("no_access");
  });

  test("a member mints tokens on a shared library at their role, on their own limit", async () => {
    const s = setup();
    const friend = await s.stranger("friend@example.com");
    await s.accounts.share("lib-1", friend.user.id, "read", "user_1");
    const mint = (scope: string) =>
      friend.app.request("/api/v1/tokens", {
        method: "POST",
        headers: { Origin: ORIGIN, "Content-Type": "application/json" },
        body: JSON.stringify({ library: "owner/demo", actor: "claude-code/friend", scope }),
      });
    const tooMuch = await mint("write");
    expect(tooMuch.status).toBe(403);
    expect(await tooMuch.text()).toContain("mint a read token");
    const ok = await mint("read");
    expect(ok.status).toBe(201);
    const minted = (await ok.json()) as { id: string; library: string; secret: string };
    expect(minted.library).toBe("owner/demo");
    // The slug alone names their own library, never the shared one.
    const own = await friend.app.request("/api/v1/tokens", {
      method: "POST",
      headers: { Origin: ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({ library: "demo", actor: "claude-code/mine", scope: "write" }),
    });
    expect(((await own.json()) as { library: string }).library).toBe("demo");

    // Both see it; it counts against the member's limit, not the owner's.
    const theirs = (await s.accounts.tokens(friend.user.id)).map((t) => t.library);
    expect(theirs).toContain("owner/demo");
    expect((await s.accounts.tokens("user_1")).map((t) => t.id)).toContain(minted.id);
    expect((await s.accounts.usage("user_1")).tokens).toBe(0);
    expect((await s.accounts.usage(friend.user.id)).tokens).toBe(4);

    // The member may revoke their own; the owner may revoke any on their library.
    const revoke = await friend.app.request(`/api/v1/tokens/${minted.id}`, {
      method: "DELETE",
      headers: { Origin: ORIGIN },
    });
    expect(revoke.status).toBe(204);
    expect((await s.req("/tree", { token: minted.secret })).status).toBe(401);
  });

  test("a token's agent and the person in the app are told apart in the ledger", async () => {
    const s = setup();
    const friend = await s.stranger("friend@example.com");
    await s.accounts.share("lib-1", friend.user.id, "write", "user_1");
    const minted = await friend.app.request("/api/v1/tokens", {
      method: "POST",
      headers: { Origin: ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({ library: "owner/demo", actor: "claude-code/laptop", scope: "write" }),
    });
    const { secret } = (await minted.json()) as { secret: string };
    const note = (body: string) => ({
      method: "PUT",
      headers: { "Content-Type": "text/markdown" },
      body: `---\ntype: Note\n---\n${body}\n`,
    });
    expect((await s.req("/files/by-agent.md", { ...note("Agent."), token: secret })).status).toBe(
      200,
    );
    const inApp = await friend.app.request(`${API}/files/by-person.md`, {
      ...note("Person."),
      headers: { Origin: ORIGIN, "Content-Type": "text/markdown" },
    });
    expect(inApp.status).toBe(200);
    const r = (await (await s.app.request(`${API}/agents`)).json()) as {
      contributors: { person: string; agent: { name: string; platform: string } | null }[];
    };
    expect(
      r.contributors.map(
        (c) => `${c.person}:${c.agent ? `${c.agent.name}@${c.agent.platform}` : "-"}`,
      ),
    ).toEqual(["friend:-", "friend:claude-code@token/claude-code"]);
  });

  test("the owner is never a member; deletes take memberships with them", async () => {
    const s = setup();
    const friend = await s.stranger("friend@example.com");
    expect(s.accounts.share("lib-1", "user_1", "write", "user_1")).rejects.toThrow(
      "cannot also be a member",
    );
    expect(s.accounts.share("lib-1", friend.user.id, "admin" as "read", "user_1")).rejects.toThrow(
      "read or write",
    );
    await s.accounts.share("lib-1", friend.user.id, "read", "user_1");
    await s.accounts.share(friend.lib.id, "user_1", "write", friend.user.id);
    await s.accounts.deleteLibrary(friend.lib.id);
    expect((await s.accounts.reachable("user_1")).map((l) => l.owner)).toEqual(["owner"]);
    await s.accounts.deleteUser(friend.user);
    expect(await s.accounts.members("lib-1")).toEqual([]);
  });

  test("library paths are {owner}/{slug} in the UI and the API", () => {
    expect(UI).toBe("/owner/demo");
    expect(API).toBe("/api/v1/libraries/owner/demo");
  });
});
