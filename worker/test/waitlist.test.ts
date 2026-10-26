import { describe, expect, test } from "bun:test";
import { WAITLIST_NOTICES_PER_DAY } from "../src/accounts";
import { ORIGIN, setup } from "./harness";

type S = ReturnType<typeof setup>;

/** The operator is the demo library's owner, whom s.app is signed in as. */
function beta() {
  const s = setup();
  Object.assign(s.env, { SIGNUP: "invite", OPERATOR_EMAIL: " Owner@Example.com " });
  return s;
}

/** Request access (TEMPRA-125): the one way onto the waitlist. */
const ask = (s: S, email: string) =>
  s.anon.request("/request-access", {
    method: "POST",
    headers: { Origin: ORIGIN },
    body: new URLSearchParams({ email }),
  });

const operatorMail = (s: S) => s.outbox.filter((m) => m.to === "owner@example.com");

/** Lets work run after the response, as waitUntil would. */
const settle = () => new Promise((r) => setTimeout(r, 10));

/** Decides, then follows the redirect back to the list (post, redirect, get), as a browser does. */
const decide = async (client: S["app"], email: string, decision: string, origin = ORIGIN) => {
  const r = await client.request("/waitlist", {
    method: "POST",
    headers: { Origin: origin },
    body: new URLSearchParams({ email, decision }),
  });
  if (r.status !== 303) return r;
  expect(r.headers.get("Location")).toStartWith("/waitlist?");
  return client.request(r.headers.get("Location") ?? "");
};

describe("the waitlist (v2 spec: Accounts and sign-in, The waitlist)", () => {
  test("sign-in and Request access say the right thing in each mode", async () => {
    const s = beta();
    const page = async (path: string) => {
      const r = await s.anon.request(path, { redirect: "manual" });
      return { status: r.status, location: r.headers.get("Location"), text: await r.text() };
    };
    // invite: sign-in is for accounts, with a way to ask; Request access is its own page.
    let signIn = await page("/sign-in");
    expect(signIn.text).toContain("We'll email you a link and a code.");
    expect(signIn.text).toContain('href="/request-access"');
    expect(signIn.text).not.toContain("creates your account");
    const request = await page("/request-access");
    expect(request.status).toBe(200);
    expect(request.text).toContain("private beta");
    expect(request.text).toContain("<title>Request access");
    // open: the link creates the account; Request access goes to sign-in.
    Object.assign(s.env, { SIGNUP: "open" });
    signIn = await page("/sign-in");
    expect(signIn.text).toContain("The same link creates your account.");
    expect(signIn.text).not.toContain("/request-access");
    expect(await page("/request-access")).toMatchObject({ status: 302, location: "/sign-in" });
    // closed: no new accounts, and no form to ask with.
    Object.assign(s.env, { SIGNUP: "closed" });
    signIn = await page("/sign-in");
    expect(signIn.text).toContain("not taking new accounts");
    expect(signIn.text).not.toContain("creates your account");
    expect(signIn.text).not.toContain("/request-access");
    const closed = await page("/request-access");
    expect(closed.text).toContain("Not taking new accounts");
    expect(closed.text).not.toContain("<form");
    const posted = await ask(s, "friend@example.com");
    expect(await posted.text()).toContain("Not taking new accounts");
    expect(await s.accounts.waitlist()).toHaveLength(0);
  });

  test("a new email is told once it is on the list, and the operator once", async () => {
    const s = beta();
    const r = await ask(s, "friend@example.com");
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).toContain("Request received");
    expect(text).toContain("If you asked several times, wait an hour");
    await ask(s, "friend@example.com");
    await settle();
    expect(s.outbox.map((m) => [m.to, m.subject])).toEqual([
      ["friend@example.com", "You're on the list: Tempra"],
      ["owner@example.com", "Tempra waitlist: friend@example.com"],
    ]);
    expect(s.outbox[0]?.text).toContain("we'll email this address when you're in");
    expect(s.outbox[1]?.text).toContain(`${ORIGIN}/waitlist`);
  });

  test("the page says the same whoever asks; an account is sent a sign-in link", async () => {
    const s = beta();
    s.db.run("INSERT INTO invites (email, created) VALUES ('friend@example.com', 'now')");
    const answers = new Set<string>();
    for (const email of ["owner@example.com", "friend@example.com", "new@example.com"]) {
      answers.add((await (await ask(s, email)).text()).replace(email, "EMAIL"));
    }
    expect(answers.size).toBe(1);
    await settle();
    expect(s.outbox.map((m) => [m.to, m.subject])).toEqual([
      ["owner@example.com", "Your Tempra sign-in link"],
      ["friend@example.com", "Your Tempra sign-in link"],
      ["new@example.com", "You're on the list: Tempra"],
      ["owner@example.com", "Tempra waitlist: new@example.com"],
    ]);
    expect(s.outbox[0]?.text).toContain("You can already sign in");
    expect(await s.accounts.waitlist()).toEqual([
      { email: "new@example.com", created: expect.any(String) },
    ]);
  });

  test("Request access is a same-site post, and checks the email", async () => {
    const s = beta();
    const evil = await s.anon.request("/request-access", {
      method: "POST",
      headers: { Origin: "https://evil.example" },
      body: new URLSearchParams({ email: "friend@example.com" }),
    });
    expect(evil.status).toBe(403);
    const bad = await ask(s, "not an email");
    expect(bad.status).toBe(400);
    expect(await bad.text()).toContain('role="alert"');
    expect(await s.accounts.waitlist()).toHaveLength(0);
  });

  test("sign-in no longer adds anyone to the waitlist", async () => {
    const s = beta();
    const r = await s.anon.request("/sign-in", {
      method: "POST",
      headers: { Origin: ORIGIN },
      body: new URLSearchParams({ email: "stranger@example.com", next: "/" }),
    });
    const text = await r.text();
    expect(text).toContain("can sign in here");
    expect(text).toContain('href="/request-access"');
    await settle();
    expect(s.outbox).toHaveLength(0);
    expect(await s.accounts.waitlist()).toHaveLength(0);
  });

  test("no OPERATOR_EMAIL: people still join and are told, the operator is not", async () => {
    const s = setup();
    Object.assign(s.env, { SIGNUP: "invite" });
    await ask(s, "friend@example.com");
    await settle();
    expect(s.outbox.map((m) => m.to)).toEqual(["friend@example.com"]);
    expect(await s.accounts.waitlist()).toHaveLength(1);
  });

  test("notices are capped per day; the rest still wait, and each person is told", async () => {
    const s = beta();
    for (let i = 0; i < WAITLIST_NOTICES_PER_DAY + 3; i++) await ask(s, `p${i}@example.com`);
    await settle();
    expect(operatorMail(s)).toHaveLength(WAITLIST_NOTICES_PER_DAY);
    expect(s.outbox).toHaveLength(2 * WAITLIST_NOTICES_PER_DAY + 3);
    expect(await s.accounts.waitlist()).toHaveLength(WAITLIST_NOTICES_PER_DAY + 3);
  });

  test("only the operator sees /waitlist; others get 404, no session goes to sign-in", async () => {
    const s = beta();
    await ask(s, "friend@example.com");
    const page = await s.app.request("/waitlist");
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("friend@example.com");
    expect(html).toContain('value="invited"');
    // Each button names whom it decides on, for screen readers (V-12).
    expect(html).toContain('aria-label="Approve friend@example.com"');
    const { app: other } = await s.stranger();
    expect((await other.request("/waitlist")).status).toBe(404);
    expect((await decide(other, "friend@example.com", "invited")).status).toBe(404);
    const anon = await s.anon.request("/waitlist");
    expect(anon.status).toBe(302);
    expect(anon.headers.get("Location")).toBe("/sign-in?next=%2Fwaitlist");
    Object.assign(s.env, { OPERATOR_EMAIL: undefined });
    expect((await s.app.request("/waitlist")).status).toBe(404);
    expect(await s.accounts.waitlist()).toHaveLength(1);
  });

  test("approve invites the email and tells them; they can then sign in", async () => {
    const s = beta();
    await ask(s, "friend@example.com");
    await settle();
    s.outbox.length = 0;
    expect(
      (await decide(s.app, "friend@example.com", "invited", "https://evil.example")).status,
    ).toBe(403);
    const r = await decide(s.app, "friend@example.com", "invited");
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain("friend@example.com approved.");
    expect(html).toContain("Nobody is waiting.");
    expect(s.outbox.map((m) => [m.to, m.subject])).toEqual([
      ["friend@example.com", "You're in: Tempra"],
    ]);
    expect(s.outbox[0]?.text).toContain(`${ORIGIN}/sign-in`);
    // Approving twice does nothing more.
    expect(await (await decide(s.app, "friend@example.com", "invited")).text()).toContain(
      "was not waiting",
    );
    expect(s.outbox).toHaveLength(1);
    await ask(s, "friend@example.com");
    expect(s.outbox.at(-1)?.subject).toBe("Your Tempra sign-in link");
  });

  test("dismiss sends nothing, and asking again does not renotify", async () => {
    const s = beta();
    await ask(s, "spam@example.com");
    await settle();
    s.outbox.length = 0;
    expect(await (await decide(s.app, "spam@example.com", "dismissed")).text()).toContain(
      "spam@example.com dismissed.",
    );
    expect((await decide(s.app, "spam@example.com", "maybe")).status).toBe(400);
    await ask(s, "spam@example.com");
    await settle();
    expect(s.outbox).toHaveLength(0);
    expect(await s.accounts.waitlist()).toHaveLength(0);
    expect(s.db.query("SELECT COUNT(*) AS n FROM invites").get()).toEqual({ n: 0 });
  });

  test("an email invited another way leaves the review list", async () => {
    const s = beta();
    await ask(s, "friend@example.com");
    s.db.run("INSERT INTO invites (email, created) VALUES ('friend@example.com', 'now')");
    expect(await s.accounts.waitlist()).toHaveLength(0);
  });
});
