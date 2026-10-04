import { describe, expect, test } from "bun:test";
import { API, ORIGIN, setup } from "./harness";

// The app's own pages call the REST API with the session cookie (TEMPRA-9).

const concept = "---\ntype: Note\ntitle: A\ndescription: A note.\n---\nBody.\n";

function put(origin: Record<string, string>) {
  return {
    method: "PUT",
    headers: { "Content-Type": "text/markdown", "X-Note": "from the app", ...origin },
    body: concept,
  };
}

describe("session on the REST API", () => {
  test("the signed-in owner reads their library without a token", async () => {
    const s = setup();
    const res = await s.app.request(`${API}/tree`);
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveProperty("seq");
  });

  test("no session and no token is 401, not a sign-in redirect", async () => {
    const s = setup();
    const res = await s.anon.request(`${API}/tree`);
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe("no_token");
  });

  test("a write from the app's pages is attributed to the person, with its note", async () => {
    const s = setup();
    const res = await s.app.request(`${API}/files/a.md`, put({ Origin: ORIGIN }));
    expect(res.status).toBe(200);
    const ledger = (await (await s.app.request(`${API}/requests?limit=1`)).json()) as {
      requests: { actor: string; note: string | null }[];
    };
    expect(ledger.requests[0]).toMatchObject({ actor: "human:owner", note: "from the app" });
  });

  test("Sec-Fetch-Site same-origin stands in for a missing Origin", async () => {
    const s = setup();
    const res = await s.app.request(`${API}/files/a.md`, put({ "Sec-Fetch-Site": "same-origin" }));
    expect(res.status).toBe(200);
  });

  test("a session write from another site, or with no origin at all, is refused", async () => {
    const s = setup();
    const origins: Record<string, string>[] = [
      { Origin: "https://evil.example" },
      {},
      { Origin: "null" },
    ];
    for (const origin of origins) {
      const res = await s.app.request(`${API}/files/a.md`, put(origin));
      expect(res.status).toBe(403);
      expect(((await res.json()) as { code: string }).code).toBe("cross_origin");
    }
    expect(s.store().headSeq()).toBe(0);
  });

  test("a bearer token, when sent, decides alone: a bad one is not rescued by the session", async () => {
    const s = setup();
    const res = await s.app.request(`${API}/tree`, {
      headers: { Authorization: "Bearer not-a-token" },
    });
    expect(res.status).toBe(401);
  });

  test("library and token management works from the session, writes same-site only", async () => {
    const s = setup();
    const libs = (await (await s.app.request("/api/v1/libraries")).json()) as {
      libraries: { owner: string; slug: string }[];
    };
    expect(libs.libraries).toEqual([expect.objectContaining({ owner: "owner", slug: "demo" })]);

    const body = JSON.stringify({ library: "demo", actor: "claude-code/app", scope: "read" });
    const headers = { "Content-Type": "application/json" };
    const crossSite = await s.app.request("/api/v1/tokens", { method: "POST", headers, body });
    expect(crossSite.status).toBe(403);
    const minted = await s.app.request("/api/v1/tokens", {
      method: "POST",
      headers: { ...headers, Origin: ORIGIN },
      body,
    });
    expect(minted.status).toBe(201);
    const tokens = (await (await s.app.request("/api/v1/tokens")).json()) as {
      tokens: { actor: string }[];
    };
    expect(tokens.tokens.map((t) => t.actor)).toContain("claude-code/app");
  });

  test("a stranger's session sees nothing of the owner's library or tokens", async () => {
    const s = setup();
    const other = await s.stranger();
    expect((await other.app.request(`${API}/tree`)).status).toBe(404);
    const libs = await (await other.app.request("/api/v1/libraries")).text();
    expect(libs).not.toContain('"owner":"owner"');
  });
});
