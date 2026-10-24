import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { resolveMentions } from "../src/notify";
import { composeBatch, flushMail, MAX_WAIT_MS, QUIET_MS, sendDigests } from "../src/notify-mail";
import { API, LIB, ORIGIN, OWNER, setup } from "./harness";

type S = ReturnType<typeof setup>;
type App = S["app"];
type Text = { type: "text"; text: string };

/** The app's API as its pages call it: JSON, from this site. */
const call = (app: App, path: string, method = "GET", body?: unknown) =>
  app.request(path, {
    method,
    headers: { Origin: ORIGIN, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const doc = (title: string) =>
  `---\ntype: Metric\ntitle: ${title}\ndescription: A metric.\n---\n# ${title}\n\nRevenue minus cost.\n`;

interface InboxItem {
  id: string;
  kind: string;
  place: string;
  path: string | null;
  thread: string | null;
  actor: string;
  excerpt: string;
  href: string;
  read_at: string | null;
  done_at: string | null;
}

async function inbox(app: App, all = false) {
  const r = await call(app, `/api/v1/inbox${all ? "?all=1" : ""}`);
  expect(r.status).toBe(200);
  return (await r.json()) as { items: InboxItem[]; unread: number };
}

/** The owner's library, shared with a friend at `role`; plus an agent token of the owner's. */
async function shared(role: "read" | "write" = "write") {
  const s = setup();
  const friend = await s.stranger("friend@example.com");
  await s.accounts.share(LIB.id, friend.user.id, role, OWNER.id);
  const agent = await s.accounts.createToken({
    libraryId: LIB.id,
    actor: "claude-code/laptop",
    scope: "write",
    prefix: null,
    expires: null,
    mcpTiers: "all",
    createdBy: OWNER.id,
  });
  return { s, friend, agent: agent.secret };
}

/** Writes a concept as the signed-in person of `app`. */
async function write(app: App, path: string) {
  const r = await app.request(`${API}/files/${path}`, {
    method: "PUT",
    headers: { Origin: ORIGIN, "Content-Type": "text/markdown", "X-Note": "test" },
    body: doc(path),
  });
  expect(r.status).toBeLessThan(300);
}

async function open(app: App, path: string, body: string) {
  const r = await call(app, `${API}/comments`, "POST", { path, body });
  expect(r.status).toBe(201);
  return ((await r.json()) as { thread: { id: string } }).thread.id;
}

describe("mentions (TEMPRA-73)", () => {
  const people = [
    { id: "u1", handle: "ann" },
    { id: "u2", handle: "bo_b" },
  ];

  test("resolves handles of people who reach the library, once each", () => {
    expect(resolveMentions("@ann and @Bo_B, also @ann again.", people)).toEqual([
      { user: "u1", handle: "ann" },
      { user: "u2", handle: "bo_b" },
    ]);
  });

  test("ignores outsiders, emails, paths and the middle of words", () => {
    expect(resolveMentions("@zed ann@ann.com /x/@ann a@ann x.@ann", people)).toEqual([]);
  });

  test("names a managed agent when one is listed (the hook TEMPRA-69 uses)", () => {
    expect(resolveMentions("@curator please", people, [{ id: "a1", name: "curator" }])).toEqual([
      { agent: "a1", name: "curator" },
    ]);
  });

  test("a mention is stored with the comment and reaches the person's inbox", async () => {
    const { s, friend } = await shared();
    await write(s.app, "metrics/margin.md");
    const r = await call(friend.app, `${API}/comments`, "POST", {
      path: "metrics/margin.md",
      body: "@owner is this still right? cc @nobody",
    });
    expect(r.status).toBe(201);
    const { thread } = (await r.json()) as {
      thread: { id: string; comments: { mentions?: string[] }[] };
    };
    expect(thread.comments[0]?.mentions).toEqual(["@owner"]);
    const { items, unread } = await inbox(s.app);
    expect(unread).toBe(1);
    expect(items[0]).toMatchObject({
      kind: "mention",
      place: "owner/demo",
      path: "metrics/margin.md",
      thread: thread.id,
      actor: "human:friend",
      excerpt: "@owner is this still right? cc @nobody",
      href: "/owner/demo/metrics/margin.md#comments",
    });
  });

  test("mentioning someone outside the library does nothing and reveals nothing", async () => {
    const { s, friend } = await shared();
    const outsider = await s.stranger("outsider@example.com");
    await write(s.app, "metrics/margin.md");
    const post = async (body: string) => {
      const r = await call(s.app, `${API}/comments`, "POST", { path: "metrics/margin.md", body });
      expect(r.status).toBe(201);
      const j = (await r.json()) as { thread: { comments: { mentions?: string[] }[] } };
      return j.thread.comments[0]?.mentions ?? null;
    };
    // An existing account outside the library and a handle nobody has read the same.
    expect(await post("@outsider have a look")).toBeNull();
    expect(await post("@nosuchhandle have a look")).toBeNull();
    expect((await inbox(outsider.app)).items).toEqual([]);
    expect((await post("@friend have a look")) ?? []).toEqual(["@friend"]);
    expect((await inbox(friend.app)).items.map((i) => i.kind)).toEqual(["mention"]);
  });

  test("agents mention over MCP, and `comments` says who was mentioned", async () => {
    const { s, friend, agent } = await shared();
    await write(s.app, "metrics/margin.md");
    const transport = new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
      requestInit: { headers: { Authorization: `Bearer ${agent}` } },
      fetch: async (url, init) => s.app.request(url.toString(), init as RequestInit),
    });
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(transport);
    const tool = async (name: string, args: Record<string, unknown>) => {
      const r = await client.callTool({ name, arguments: args });
      return (r.content as Text[]).map((c) => c.text).join("\n");
    };
    expect(
      await tool("comment", {
        action: "open",
        path: "metrics/margin.md",
        body: "@friend can you confirm the source?",
      }),
    ).toContain("Opened thread");
    expect(await tool("comments", { path: "metrics/margin.md" })).toContain("(mentioned @friend)");
    const items = (await inbox(friend.app)).items;
    expect(items).toMatchObject([{ kind: "mention", actor: "claude-code/laptop" }]);
  });
});

describe("the inbox (TEMPRA-72)", () => {
  test("a reply reaches who took part; the actor in person is never told of their own", async () => {
    const { s, friend } = await shared();
    await write(s.app, "metrics/margin.md");
    const id = await open(s.app, "metrics/margin.md", "Is this right?");
    // The owner wrote the concept: a thread they open themselves tells nobody.
    expect((await inbox(s.app)).items).toEqual([]);
    expect((await call(friend.app, `${API}/comments/${id}`, "POST", { body: "Yes." })).status).toBe(
      200,
    );
    expect((await inbox(s.app)).items).toMatchObject([
      { kind: "reply", actor: "human:friend", excerpt: "Yes." },
    ]);
    expect((await inbox(friend.app)).items).toEqual([]);
    // The owner answers: the friend took part, so they hear of it.
    await call(s.app, `${API}/comments/${id}`, "POST", { body: "Thanks." });
    expect((await inbox(friend.app)).items).toMatchObject([{ kind: "reply", excerpt: "Thanks." }]);
    // A resolve without a body is not news; it closes the thread's items for everyone
    // (TEMPRA-116), and reopening does not open them again.
    await call(friend.app, `${API}/comments/${id}/resolve`, "POST");
    expect((await inbox(s.app)).items).toEqual([]);
    expect((await inbox(friend.app)).items).toEqual([]);
    const done = (await inbox(s.app, true)).items;
    expect(done).toHaveLength(1);
    expect(done[0]?.done_at).not.toBeNull();
    await call(friend.app, `${API}/comments/${id}/reopen`, "POST");
    expect((await inbox(s.app)).items).toEqual([]);
  });

  test("the person's own agent replying does tell them", async () => {
    const { s, agent } = await shared();
    await write(s.app, "metrics/margin.md");
    const id = await open(s.app, "metrics/margin.md", "Please add the source.");
    const r = await s.req(`/comments/${id}/resolve`, {
      method: "POST",
      token: agent,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: "Added." }),
    });
    expect(r.status).toBe(200);
    // The answer is news, and the resolve that carries it closes it at once (TEMPRA-116).
    expect((await inbox(s.app)).items).toEqual([]);
    expect((await inbox(s.app, true)).items).toMatchObject([
      { kind: "reply", actor: "claude-code/laptop", excerpt: "Added." },
    ]);
  });

  test("a new thread tells who wrote the concept, while they can reach the library", async () => {
    const { s, friend } = await shared();
    await write(friend.app, "notes/plan.md");
    await open(s.app, "notes/plan.md", "Can we split this?");
    expect((await inbox(friend.app)).items).toMatchObject([
      { kind: "thread", path: "notes/plan.md", excerpt: "Can we split this?" },
    ]);
    // Removed from the library: no more items from it.
    await s.accounts.unshare(LIB.id, friend.user.id);
    await open(s.app, "notes/plan.md", "And another.");
    expect((await inbox(friend.app)).items).toHaveLength(1);
  });

  test("read, done, the count, and read state that sticks", async () => {
    const { s, friend } = await shared();
    await write(s.app, "a.md");
    const id = await open(s.app, "a.md", "One");
    await call(friend.app, `${API}/comments/${id}`, "POST", { body: "reply 1" });
    await call(friend.app, `${API}/comments/${id}`, "POST", { body: "reply 2" });
    const { items } = await inbox(s.app);
    expect(items.map((i) => i.excerpt)).toEqual(["reply 2", "reply 1"]);
    expect((await (await call(s.app, "/api/v1/inbox/count")).json()) as unknown).toEqual({
      unread: 2,
    });

    const [newest, oldest] = items;
    let r = await call(s.app, "/api/v1/inbox/read", "POST", { ids: [newest?.id] });
    expect((await r.json()) as unknown).toEqual({ read: 1 });
    expect((await (await call(s.app, "/api/v1/inbox/count")).json()) as unknown).toEqual({
      unread: 1,
    });
    r = await call(s.app, `/api/v1/inbox/${oldest?.id}/done`, "POST");
    expect(r.status).toBe(200);
    // Done leaves the inbox; read stays, marked read.
    const after = await inbox(s.app);
    expect(after.items.map((i) => i.excerpt)).toEqual(["reply 2"]);
    expect(after.items[0]?.read_at).not.toBeNull();
    expect(after.unread).toBe(0);
    expect((await inbox(s.app, true)).items).toHaveLength(2);
    // Another person's item is theirs alone.
    expect((await call(friend.app, `/api/v1/inbox/${oldest?.id}/done`, "POST")).status).toBe(404);
    r = await call(s.app, "/api/v1/inbox/read", "POST", { library: "owner/demo" });
    expect(r.status).toBe(200);
    // Tokens never read the inbox.
    expect(
      (await s.anon.request("/api/v1/inbox", { headers: { Authorization: "Bearer human" } }))
        .status,
    ).toBe(403);
  });

  test("an invitation is an inbox item, done once answered; access changes are told", async () => {
    const s = setup();
    const friend = await s.stranger("friend@example.com");
    expect(
      (await call(s.app, `${API}/invitations`, "POST", { to: "@friend", role: "read" })).status,
    ).toBe(202);
    const { items } = await inbox(friend.app);
    expect(items).toMatchObject([
      { kind: "invitation", place: "owner/demo", href: "/invitations" },
    ]);
    const inv = (await (await call(friend.app, "/api/v1/invitations")).json()) as {
      invitations: { id: string }[];
    };
    await call(friend.app, `/api/v1/invitations/${inv.invitations[0]?.id}/accept`, "POST");
    expect((await inbox(friend.app)).items).toEqual([]);
    await call(s.app, `${API}/members/friend`, "PUT", { role: "write" });
    expect((await inbox(friend.app)).items).toMatchObject([
      { kind: "access", excerpt: "Now read and write" },
    ]);
  });

  // The Inbox page's calls (TEMPRA-130): Mark all read on a filtered list, Accept from a row,
  // and the library's open items, which its home's For you here draws.
  test("Mark all read on one library's items leaves another library's unread", async () => {
    const { s, friend } = await shared();
    // The friend's thread on the owner's library, answered by the owner: a reply in owner/demo.
    await write(s.app, "a.md");
    const id = await open(friend.app, "a.md", "A question");
    await call(s.app, `${API}/comments/${id}`, "POST", { body: "An answer" });
    // The owner opens a thread on the friend's own library: a new thread in friend/demo.
    await s.accounts.share(friend.lib.id, OWNER.id, "read", friend.user.id);
    const theirs = "/api/v1/libraries/friend/demo";
    const put = await friend.app.request(`${theirs}/files/b.md`, {
      method: "PUT",
      headers: { Origin: ORIGIN, "Content-Type": "text/markdown", "X-Note": "test" },
      body: doc("b"),
    });
    expect(put.status).toBeLessThan(300);
    expect(
      (await call(s.app, `${theirs}/comments`, "POST", { path: "b.md", body: "Hello" })).status,
    ).toBe(201);
    const before = (await inbox(friend.app)).items;
    expect(before.map((i) => i.kind).sort()).toEqual(["reply", "thread"]);

    const r = await call(friend.app, "/api/v1/inbox/read", "POST", { library: "owner/demo" });
    expect((await r.json()) as unknown).toEqual({ read: 1 });
    const after = await inbox(friend.app);
    const byKind = Object.fromEntries(after.items.map((i) => [i.kind, i.read_at]));
    expect(byKind.reply).not.toBeNull();
    expect(byKind.thread).toBeNull();
    expect(after.unread).toBe(1);
  });

  test("accepting from the Inbox row adds the library; a dismissed item leaves the library's list", async () => {
    const s = setup();
    const friend = await s.stranger("friend@example.com");
    await call(s.app, `${API}/invitations`, "POST", { to: "@friend", role: "write" });
    const row = (await (await call(friend.app, "/api/v1/inbox")).json()) as {
      items: { kind: string; invitation: string | null; actions: string[] }[];
    };
    const item = row.items.find((i) => i.kind === "invitation");
    expect(item?.actions).toEqual(["accept", "decline"]);
    expect(
      (await call(friend.app, `/api/v1/invitations/${item?.invitation}/accept`, "POST")).status,
    ).toBe(200);
    // The switcher's list (GET /api/v1/libraries) now has it, with the role.
    const libs = (await (await call(friend.app, "/api/v1/libraries")).json()) as {
      libraries: { owner: string; slug: string; role?: string }[];
    };
    expect(libs.libraries).toContainEqual(
      expect.objectContaining({ owner: "owner", slug: "demo", role: "write" }),
    );
    // Done in the Inbox, gone from the library's open items (the home's For you here).
    await write(s.app, "c.md");
    await open(s.app, "c.md", "On c");
    await call(friend.app, `${API}/comments`, "POST", { path: "c.md", body: "@owner look" });
    const mine = async () =>
      (await (await call(s.app, "/api/v1/inbox?library=owner/demo")).json()) as {
        items: { id: string }[];
        open: number;
      };
    const listed = await mine();
    expect(listed.items.length).toBeGreaterThan(0);
    const first = listed.items[0]?.id;
    expect((await call(s.app, `/api/v1/inbox/${first}/done`, "POST")).status).toBe(200);
    const left = await mine();
    expect(left.items.map((i) => i.id)).not.toContain(first);
    expect(left.open).toBe(listed.open - 1);
  });

  test("the tally: changes by others since the cursor, and items for you", async () => {
    const { s, friend, agent } = await shared();
    await write(s.app, "a.md");
    // Never looked: no cursor, so nothing counts as new yet.
    let t = await (await call(s.app, `${API}/tally`)).json();
    expect(t).toMatchObject({ seen: null, changes: 0, for_you: 0 });
    const head = (t as { head: number }).head;
    expect(
      (await (await call(s.app, `${API}/seen`, "PUT", { seq: head })).json()) as unknown,
    ).toEqual({
      seq: head,
    });
    // The owner's own writes in the app are not news; their agent's and the friend's are.
    await write(s.app, "b.md");
    await write(friend.app, "c.md");
    await s.req("/files/d.md", {
      method: "PUT",
      token: agent,
      headers: { "Content-Type": "text/markdown" },
      body: doc("d"),
    });
    const id = await open(friend.app, "a.md", "@owner look");
    t = await (await call(s.app, `${API}/tally`)).json();
    expect(t).toMatchObject({ seen: head, changes: 2, for_you: 1 });
    void id;
    // The cursor never goes back, and the same numbers ride on the library list.
    expect((await (await call(s.app, `${API}/seen`, "PUT", { seq: 1 })).json()) as unknown).toEqual(
      {
        seq: head,
      },
    );
    const list = (await (await call(s.app, "/api/v1/libraries")).json()) as {
      libraries: { slug: string; owner: string; tally: { changes: number; for_you: number } }[];
    };
    expect(list.libraries.find((l) => l.owner === "owner")?.tally).toEqual({
      changes: 2,
      for_you: 1,
    });
    expect((await call(friend.app, `${API}/seen`)).status).toBe(200);
    // Agents have no read state.
    expect((await s.req("/seen")).status).toBe(403);
  });
});

describe("notification mail (TEMPRA-74)", () => {
  const origin = "https://app.example";

  /** A reply on the owner's thread by the friend, `n` times. */
  async function replies(n: number) {
    const { s, friend } = await shared();
    await write(s.app, "a.md");
    const id = await open(s.app, "a.md", "Question");
    for (let i = 1; i <= n; i++) {
      await call(friend.app, `${API}/comments/${id}`, "POST", { body: `reply ${i}` });
    }
    return { s, friend };
  }

  const flush = (s: S, now: Date, force = false) =>
    flushMail(
      {
        accounts: s.accounts,
        notifications: s.notifications,
        mailer: s.deps.mailer ?? null,
        origin,
        now,
      },
      { force },
    );

  test("a burst is one mail, after a quiet spell, with a one-click unsubscribe", async () => {
    const { s } = await replies(3);
    const before = s.outbox.length;
    // Still busy: it waits.
    expect(await flush(s, new Date())).toMatchObject({ mails: 0, waiting: 3 });
    const later = new Date(Date.now() + QUIET_MS + 1000);
    expect(await flush(s, later)).toMatchObject({ mails: 1, items: 3 });
    const mails = s.outbox.slice(before);
    expect(mails).toHaveLength(1);
    const m = mails[0];
    expect(m?.to).toBe("owner@example.com");
    expect(m?.subject).toBe("3 new in your Tempra inbox");
    expect(m?.text).toContain("@friend replied on a.md in owner/demo");
    expect(m?.text).toContain(`${origin}/owner/demo/a.md#comments`);
    expect(m?.html).toContain("<ul>");
    const unsub = m?.headers?.["List-Unsubscribe"] ?? "";
    expect(m?.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    // Sent once: nothing waits now.
    expect(await flush(s, later)).toMatchObject({ mails: 0, waiting: 0 });

    // One click, from the mail provider, no session: mail is off.
    const url = new URL(unsub.slice(1, -1));
    expect(url.pathname).toBe("/unsubscribe");
    expect((await s.anon.request(`/unsubscribe${url.search}`)).status).toBe(200);
    const r = await s.anon.request(`/unsubscribe${url.search}`, { method: "POST" });
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("Unsubscribed");
    expect((await s.anon.request("/unsubscribe?k=0000", { method: "POST" })).status).toBe(404);
    const prefs = await (await call(s.app, "/api/v1/account/notifications")).json();
    expect(prefs).toMatchObject({ immediate: false, digest: false });
  });

  test("a batch goes after the longest wait even while replies keep coming", async () => {
    const { s } = await replies(1);
    expect(await flush(s, new Date(Date.now() + MAX_WAIT_MS + 1000))).toMatchObject({ mails: 1 });
  });

  test("read items, mail turned off, and the daily cap are respected", async () => {
    const { s } = await replies(2);
    const later = new Date(Date.now() + QUIET_MS + 1000);
    // Read in the app first: not mailed.
    await call(s.app, "/api/v1/inbox/read", "POST", {});
    expect(await flush(s, later)).toMatchObject({ mails: 0, skipped: 2 });

    // Off for this library only: skipped; on for the account still.
    const { s: s2, friend } = await replies(1);
    expect(
      (
        await call(s2.app, "/api/v1/account/notifications", "PUT", {
          library: "owner/demo",
          immediate: false,
        })
      ).status,
    ).toBe(204);
    const prefs = (await (await call(s2.app, "/api/v1/account/notifications")).json()) as {
      immediate: boolean;
      libraries: { library: string; immediate: boolean | null; digest: boolean | null }[];
    };
    expect(prefs.immediate).toBe(true);
    expect(prefs.libraries).toEqual([{ library: "owner/demo", immediate: false, digest: null }]);
    expect(await flush(s2, later)).toMatchObject({ mails: 0, skipped: 1 });
    void friend;

    // The cap: the day's slots taken, the batch is skipped, not held.
    const { s: s3 } = await replies(1);
    for (let i = 0; i < 20; i++)
      await s3.notifications.takeMailSlot(OWNER.id, later.toISOString().slice(0, 10));
    expect(await flush(s3, later)).toMatchObject({ mails: 0, skipped: 1 });
  });

  test("the digest is opt-in, per library, and only when something happened", async () => {
    const { s, friend } = await replies(1);
    const digestDeps = {
      accounts: s.accounts,
      notifications: s.notifications,
      mailer: s.deps.mailer ?? null,
      origin,
      now: new Date(Date.now() + 1000),
      digest: async (doId: string, since: string) => {
        const lib = await s.deps.libraryByDoId(doId);
        if (!lib) throw new Error("no library");
        return lib.digest({ since });
      },
    };
    const before = s.outbox.length;
    expect(await sendDigests(digestDeps)).toEqual({ mails: 0, people: 0 });
    await call(s.app, "/api/v1/account/notifications", "PUT", { digest: true });
    expect(await sendDigests(digestDeps)).toEqual({ mails: 1, people: 1 });
    const m = s.outbox.slice(before)[0];
    expect(m?.subject).toBe("Tempra digest: 1 library");
    expect(m?.text).toContain("owner/demo");
    expect(m?.text).toContain("1 thread opened, 0 resolved");
    // The health summary (TEMPRA-66): the open thread, and the concept nobody has verified.
    expect(m?.text).toMatch(/Now: .*1 open comment\b/);
    expect(m?.text).toMatch(/Now: .*1 unverified/);
    expect(m?.headers?.["List-Unsubscribe"]).toContain("/unsubscribe?k=");
    // Since the last digest, nothing new: no mail.
    expect(await sendDigests({ ...digestDeps, now: new Date(Date.now() + 2000) })).toEqual({
      mails: 0,
      people: 1,
    });
    void friend;
  });

  test("a single item's subject names who and where", () => {
    const m = composeBatch(origin, "k".repeat(48), [
      {
        id: "1",
        library: "l",
        kind: "mention",
        place: "ann/notes",
        path: "x.md",
        thread: "t",
        seq: 3,
        actor: "human:bo",
        excerpt: "@ann see <this>",
        created: new Date().toISOString(),
        read_at: null,
        done_at: null,
        title: null,
        by_user: null,
        by_agent: null,
        count: null,
      },
    ]);
    expect(m.subject).toBe("@bo mentioned you on x.md");
    expect(m.html).toContain("@ann see &#60;this&#62;");
  });
});

describe("the Inbox's verify items (TEMPRA-116)", () => {
  /** The current hash of a file, or none when it is not there. */
  const hashOf = async (s: S, path: string) => {
    const r = await s.app.request(`${API}/files/${path}`, {
      headers: { Accept: "application/json" },
    });
    return r.ok ? ((await r.json()) as { hash: string }).hash : null;
  };
  const put = async (s: S, token: string, path: string, body: string) => {
    const hash = await hashOf(s, path);
    return s.req(`/files/${path}`, {
      method: "PUT",
      token,
      headers: {
        "Content-Type": "text/markdown",
        "X-Note": "agent edit",
        ...(hash ? { "If-Match": hash } : {}),
      },
      body,
    });
  };
  /** Writes as the person in `app` (the owner's session). */
  const saveAs = async (s: S, app: App, path: string, body: string) => {
    const hash = await hashOf(s, path);
    return app.request(`${API}/files/${path}`, {
      method: "PUT",
      headers: {
        Origin: ORIGIN,
        "Content-Type": "text/markdown",
        ...(hash ? { "If-Match": hash } : {}),
      },
      body,
    });
  };
  const verify = (app: App, path: string) => call(app, `${API}/verify/${path}`, "POST");
  const edited = (title: string, n: number) => doc(title).replace("Revenue minus cost.", `v${n}`);
  const days = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
  const staleDoc = (title: string, after: string) =>
    `---\ntype: Metric\ntitle: ${title}\ndescription: A metric.\nstale_after: ${after}\n---\n# ${title}\n\nBody.\n`;

  test("an agent's edit to a page a person verified is one keyed item, closed by verifying", async () => {
    const { s, friend, agent } = await shared();
    await write(s.app, "metrics/margin.md");
    expect((await verify(friend.app, "metrics/margin.md")).status).toBe(200);
    for (const n of [1, 2]) {
      const r = await put(s, agent, "metrics/margin.md", edited("Margin", n));
      expect(r.status).toBeLessThan(300);
      // The notice is the Worker's, never the caller's.
      expect(await r.json()).not.toHaveProperty("notify");
    }
    const { items, unread } = await inbox(friend.app);
    expect(unread).toBe(1);
    expect(items).toMatchObject([
      {
        kind: "verify",
        path: "metrics/margin.md",
        title: "Margin",
        count: 2,
        excerpt: "2 edits since you verified",
        actor: "claude-code/laptop",
        href: "/owner/demo/metrics/margin.md?review=1",
        actions: ["review", "dismiss"],
        library: "owner/demo",
      },
    ]);
    // The owner never verified it: nothing for them.
    expect((await inbox(s.app)).items).toEqual([]);
    // Verifying closes it, for everyone.
    expect((await verify(friend.app, "metrics/margin.md")).status).toBe(200);
    expect((await inbox(friend.app)).items).toEqual([]);
    const done = (await (await call(friend.app, "/api/v1/inbox?done=1")).json()) as {
      items: InboxItem[];
      open: number;
    };
    expect(done.items.map((i) => i.kind)).toEqual(["verify"]);
    expect(done.items[0]?.done_at).not.toBeNull();
    expect(done.open).toBe(0);
  });

  test("the person acting in the app is not told of their own edit; their agent's is news", async () => {
    const { s, agent } = await shared();
    await write(s.app, "metrics/margin.md");
    expect((await verify(s.app, "metrics/margin.md")).status).toBe(200);
    expect((await saveAs(s, s.app, "metrics/margin.md", edited("Margin", 1))).status).toBeLessThan(
      300,
    );
    expect((await inbox(s.app)).items).toEqual([]);
    expect((await put(s, agent, "metrics/margin.md", edited("Margin", 2))).status).toBeLessThan(
      300,
    );
    expect((await inbox(s.app)).items.map((i) => i.kind)).toEqual(["verify"]);
  });

  test("a moved page takes its verify item along", async () => {
    const { s, friend, agent } = await shared();
    await write(s.app, "metrics/margin.md");
    await verify(friend.app, "metrics/margin.md");
    await put(s, agent, "metrics/margin.md", edited("Margin", 1));
    const moved = await s.req("/batch", {
      method: "POST",
      token: agent,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ops: [{ op: "move", path: "metrics/margin.md", to: "metrics/gross-margin.md" }],
      }),
    });
    expect(moved.status).toBeLessThan(300);
    expect((await inbox(friend.app)).items).toMatchObject([
      { kind: "verify", path: "metrics/gross-margin.md" },
    ]);
  });

  test("staleness never reaches a person's Inbox: it is the agents' housekeeping (TEMPRA-142)", async () => {
    const s = setup();
    const writer = await s.stranger("writer@example.com");
    await s.accounts.share(LIB.id, writer.user.id, "write", OWNER.id);
    const save = (path: string, body: string) => saveAs(s, s.app, path, body);
    expect((await save("ops/soon.md", staleDoc("Soon", days(5)))).status).toBeLessThan(300);
    expect((await save("ops/past.md", staleDoc("Past", days(-5)))).status).toBeLessThan(300);
    expect((await call(s.app, `${API}/maintain`, "POST")).status).toBeLessThan(300);
    for (const app of [s.app, writer.app]) expect((await inbox(app)).items).toEqual([]);
    // The agents' work queue has it, and the home counts it as their housekeeping.
    const needs = (await (await call(s.app, `${API}/needs`)).json()) as {
      housekeeping: { stale: number };
      count: number;
    };
    expect(needs.housekeeping.stale).toBe(1);
    expect(needs.count).toBe(0);
  });

  test("resolving a thread closes its mention items too", async () => {
    const { s, friend } = await shared();
    await write(friend.app, "notes/plan.md");
    const id = await open(s.app, "notes/plan.md", "@friend can we split this?");
    const mine = (await (await call(friend.app, "/api/v1/inbox?library=owner/demo")).json()) as {
      items: (InboxItem & { actions: string[]; who: string })[];
      open: number;
    };
    expect(mine.open).toBe(1);
    expect(mine.items).toMatchObject([{ kind: "mention", actions: ["reply"], who: "owner" }]);
    expect((await call(friend.app, "/api/v1/inbox?library=owner/nope")).status).toBe(404);
    await call(s.app, `${API}/comments/${id}/resolve`, "POST");
    expect((await inbox(friend.app)).items).toEqual([]);
  });
});
