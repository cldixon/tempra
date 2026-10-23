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

const ask = (s: S, email: string) =>
  s.anon.request("/sign-in", {
    method: "POST",
    headers: { Origin: ORIGIN },
    body: new URLSearchParams({ email, next: "/" }),
  });

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
  test("the sign-in page frames invite mode as a private beta", async () => {
    const s = beta();
    expect(await (await s.anon.request("/sign-in")).text()).toContain("private beta");
    Object.assign(s.env, { SIGNUP: "open" });
    expect(await (await s.anon.request("/sign-in")).text()).not.toContain("private beta");
  });

  test("a new email notifies the operator once; the page tells the person nothing more", async () => {
    const s = beta();
    const r = await ask(s, "friend@example.com");
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("Check your email");
    await ask(s, "friend@example.com");
    await settle();
    expect(s.outbox).toHaveLength(1);
    expect(s.outbox[0]?.to).toBe("owner@example.com");
    expect(s.outbox[0]?.subject).toContain("friend@example.com");
    expect(s.outbox[0]?.text).toContain(`${ORIGIN}/waitlist`);
  });

  test("no OPERATOR_EMAIL: people still join, nobody is mailed", async () => {
    const s = setup();
    Object.assign(s.env, { SIGNUP: "invite" });
    await ask(s, "friend@example.com");
    await settle();
    expect(s.outbox).toHaveLength(0);
    expect(await s.accounts.waitlist()).toHaveLength(1);
  });

  test("notices are capped per day; the rest still wait", async () => {
    const s = beta();
    for (let i = 0; i < WAITLIST_NOTICES_PER_DAY + 3; i++) await ask(s, `p${i}@example.com`);
    await settle();
    expect(s.outbox).toHaveLength(WAITLIST_NOTICES_PER_DAY);
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
