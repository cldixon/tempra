import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import type { Context, Hono } from "hono";
import type { User } from "./accounts";
import type { Deps } from "./app";
import { deleteAccount } from "./lifecycle";
import { clearedSessionCookie, readCookie, SESSION_COOKIE, sessionId } from "./session";
import { sendLink } from "./signin";
import { OkfError } from "./store/errors";

/**
 * The account as the app's pages manage it (TEMPRA-14): the account page, sessions, email and
 * handle changes, deleting the account, and connected apps. Only the signed-in person: a token,
 * even a human: one, never reaches these (a leaked token must not take over the account).
 * Every change passes the same-site check, through `signedIn`.
 */
// biome-ignore lint/suspicious/noExplicitAny: the app's env type is generic here.
type C = Context<any>;

export function registerAccountApi(
  // biome-ignore lint/suspicious/noExplicitAny: mounted on the app whatever its env.
  app: Hono<any>,
  deps: (env: Cloudflare.Env) => Deps,
  signedIn: (c: C, d: Deps) => Promise<User>,
) {
  const person = async (c: C) => {
    const d = deps(c.env);
    if (c.req.header("Authorization") !== undefined) {
      throw new OkfError(403, "session_only", "The account is managed only from the app's pages.");
    }
    return { d, user: await signedIn(c, d) };
  };
  const body = async <T>(c: C): Promise<Partial<T>> =>
    (await c.req.json<T>().catch(() => ({}))) as Partial<T>;

  app.get("/api/v1/account", async (c) => {
    const { d, user } = await person(c);
    const secret = readCookie(c.req.raw, SESSION_COOKIE);
    const current = secret ? sessionId(secret) : null;
    const [sessions, usage, limits] = await Promise.all([
      d.sessions.list(user.id),
      d.accounts.usage(user.id),
      d.accounts.limits(user.id),
    ]);
    return c.json({
      email: user.email,
      handle: user.handle,
      actor: user.actor,
      sessions: sessions.map((s) => ({ ...s, current: s.id === current })),
      usage,
      limits,
    });
  });

  app.put("/api/v1/account/handle", async (c) => {
    const { d, user } = await person(c);
    const updated = await d.accounts.setHandle(
      user.id,
      String((await body<{ handle: string }>(c)).handle ?? ""),
    );
    return c.json({ handle: updated.handle, actor: updated.actor });
  });

  // Changing the email: a link to the new address confirms it (v2 spec: Accounts, A3). The link
  // lands on /account/email/confirm, a server page, like sign-in links.
  app.post("/api/v1/account/email", async (c) => {
    const { d, user } = await person(c);
    const email = String((await body<{ email: string }>(c)).email ?? "")
      .trim()
      .toLowerCase();
    if (!/^[^\s@]+@[^\s@]+$/.test(email) || email.length > 254) {
      throw new OkfError(400, "bad_email", "That does not look like an email address.");
    }
    if (email === user.email) throw new OkfError(400, "same_email", "That is your email already.");
    const ip = c.req.header("CF-Connecting-IP") ?? null;
    const secret = await d.sessions.createLink(email, ip, { user: user.id });
    if (!secret)
      throw new OkfError(429, "rate_limited", "Too many links asked for. Try again later.");
    const link = `${new URL(c.req.url).origin}/account/email/confirm?t=${secret}`;
    const sent = await sendLink(c.req.raw, c.env, d, {
      to: email,
      link,
      subject: "Confirm your new Tempra email",
      text: `Open this link to make this your Tempra sign-in email:\n\n${link}\n\nIt works once, within 15 minutes. If you did not ask for it, ignore this email.\n`,
    });
    if (sent === null)
      throw new OkfError(502, "mail_failed", "Could not send email. Try again later.");
    // Local dev shows the link instead of mailing it.
    return c.json({ sent_to: email, ...(sent && { dev_link: sent }) });
  });

  app.delete("/api/v1/account/sessions/:id", async (c) => {
    const { d, user } = await person(c);
    await d.sessions.endById(user.id, c.req.param("id"));
    return c.body(null, 204);
  });

  app.post("/api/v1/account/delete", async (c) => {
    const { d, user } = await person(c);
    if (String((await body<{ confirm: string }>(c)).confirm ?? "").trim() !== user.handle) {
      throw new OkfError(400, "not_confirmed", `Type ${user.handle} to confirm.`);
    }
    await deleteAccount(d, c.env.OAUTH_PROVIDER, user);
    return c.body(null, 204, { "Set-Cookie": clearedSessionCookie });
  });

  // ---------------------------------------------------------------- connected apps

  app.get("/api/v1/apps", async (c) => {
    const { d, user } = await person(c);
    const oauth: OAuthHelpers = c.env.OAUTH_PROVIDER;
    const libs = await d.accounts.reachable(user.id);
    const grants = [];
    let cursor: string | undefined;
    do {
      const page = await oauth.listUserGrants(user.id, { cursor, limit: 100 });
      grants.push(...page.items);
      cursor = page.cursor;
    } while (cursor);
    const names = new Map<string, string>();
    for (const id of new Set(grants.map((g) => g.clientId))) {
      const client = await oauth.lookupClient(id).catch(() => null);
      if (client?.clientName) names.set(id, client.clientName);
    }
    grants.sort((a, b) => b.createdAt - a.createdAt);
    return c.json({
      apps: grants.map((g) => {
        const m = (g.metadata ?? {}) as GrantMetadata;
        return {
          id: g.id,
          app: names.get(g.clientId) ?? g.clientId,
          actor: m.actor ?? null,
          libraries:
            m.libraries === "all"
              ? "all"
              : Array.isArray(m.libraries)
                ? libs
                    .filter((l) => m.libraries?.includes(l.id))
                    .map((l) => (l.role === "owner" ? l.slug : `${l.owner}/${l.slug}`))
                : m.library
                  ? [m.library]
                  : [],
          access: m.access === "write" ? "write" : "read",
          prefix: m.prefix ?? null,
          tiers: m.tiers === "files" ? "files" : "all",
          created: new Date(g.createdAt * 1000).toISOString(),
        };
      }),
    });
  });

  app.delete("/api/v1/apps/:id", async (c) => {
    const { user } = await person(c);
    const oauth: OAuthHelpers = c.env.OAUTH_PROVIDER;
    await oauth.revokeGrant(c.req.param("id"), user.id);
    return c.body(null, 204);
  });
}

/** Grant metadata: `libraries` since account-level access, `library` (a slug) before it. */
type GrantMetadata = {
  libraries?: "all" | string[];
  library?: string;
  actor?: string;
  access?: string;
  prefix?: string | null;
  tiers?: string;
};
