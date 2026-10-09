import type { Context, Hono } from "hono";
import type { User } from "./accounts";
import type { Deps } from "./app";
import type { Notifications } from "./notify";
import { devMailer, devOutbox, flushMail, itemLink } from "./notify-mail";
import { esc } from "./oauth/pages";
import { devSignIn, html } from "./signin";
import { OkfError } from "./store/errors";

/**
 * The person's inbox and mail settings (TEMPRA-72, TEMPRA-74), for a signed-in session only:
 * items addressed to them across their libraries, read and done, and what they are mailed. The
 * one-click unsubscribe is open to anyone holding the link's key, from any site, as RFC 8058
 * asks; the dev outbox exists only in local dev.
 */
// biome-ignore lint/suspicious/noExplicitAny: the app's env type is generic here.
type C = Context<any>;

export function notificationsOf(d: Deps): Notifications {
  if (!d.notifications) throw new OkfError(501, "unavailable", "Notifications are not wired here.");
  return d.notifications;
}

export function registerInboxApi(
  // biome-ignore lint/suspicious/noExplicitAny: mounted on the app whatever its env.
  app: Hono<any>,
  deps: (env: Cloudflare.Env) => Deps,
  signedIn: (c: C, d: Deps) => Promise<User>,
) {
  const person = async (c: C) => {
    const d = deps(c.env);
    if (c.req.header("Authorization") !== undefined) {
      throw new OkfError(403, "session_only", "The inbox is read only from the app's pages.");
    }
    const user = await signedIn(c, d);
    return { d, n: notificationsOf(d), user };
  };
  const body = async <T>(c: C): Promise<Partial<T>> =>
    (await c.req.json<T>().catch(() => ({}))) as Partial<T>;

  // ------------------------------------------------------------------ the inbox

  app.get("/api/v1/inbox", async (c) => {
    const { n, user } = await person(c);
    const limit = Number(c.req.query("limit") ?? "") || undefined;
    const [page, unread] = await Promise.all([
      n.inbox(user.id, {
        all: c.req.query("all") === "1",
        before: c.req.query("before") || undefined,
        limit,
      }),
      n.unread(user.id),
    ]);
    return c.json({
      items: page.items.map(({ library: _l, ...i }) => ({ ...i, href: itemLink("", i) })),
      next: page.next,
      unread: unread.total,
    });
  });

  // The avatar's count; cheap enough to ask on every page.
  app.get("/api/v1/inbox/count", async (c) => {
    const { n, user } = await person(c);
    return c.json({ unread: (await n.unread(user.id)).total });
  });

  app.post("/api/v1/inbox/read", async (c) => {
    const { d, n, user } = await person(c);
    const b = await body<{ ids: unknown; library: unknown }>(c);
    let library: string | undefined;
    if (typeof b.library === "string" && b.library) {
      // By {owner}/{slug}, among the libraries the person reaches.
      const lib = (await d.accounts.reachable(user.id)).find(
        (l) => `${l.owner}/${l.slug}` === b.library,
      );
      if (!lib) throw new OkfError(404, "no_library", `There is no library ${b.library}.`);
      library = lib.id;
    }
    const ids = Array.isArray(b.ids)
      ? b.ids.filter((x): x is string => typeof x === "string")
      : undefined;
    return c.json({ read: await n.markRead(user.id, { ids, library }) });
  });

  app.post("/api/v1/inbox/:id/done", async (c) => {
    const { n, user } = await person(c);
    const b = await body<{ done: unknown }>(c);
    const ok = await n.markDone(user.id, c.req.param("id"), b.done !== false);
    if (!ok) throw new OkfError(404, "not_found", "No such item in your inbox.");
    return c.json({ done: b.done !== false });
  });

  // ------------------------------------------------------------------ mail settings

  app.get("/api/v1/account/notifications", async (c) => {
    const { d, n, user } = await person(c);
    const [prefs, libs] = await Promise.all([n.prefs(user.id), d.accounts.reachable(user.id)]);
    const own = new Map(prefs.libraries.map((l) => [l.library, l]));
    return c.json({
      immediate: prefs.immediate,
      digest: prefs.digest,
      libraries: libs.map((l) => ({
        library: `${l.owner}/${l.slug}`,
        immediate: own.get(l.id)?.immediate ?? null,
        digest: own.get(l.id)?.digest ?? null,
      })),
    });
  });

  app.put("/api/v1/account/notifications", async (c) => {
    const { d, n, user } = await person(c);
    const b = await body<{ library: unknown; immediate: unknown; digest: unknown }>(c);
    const setting = (v: unknown, k: string) => {
      if (v === undefined || v === null || typeof v === "boolean") return v as boolean | null;
      throw new OkfError(400, "bad_request", `\`${k}\` is true, false or null.`);
    };
    let library = "";
    if (typeof b.library === "string" && b.library) {
      const lib = (await d.accounts.reachable(user.id)).find(
        (l) => `${l.owner}/${l.slug}` === b.library,
      );
      if (!lib) throw new OkfError(404, "no_library", `There is no library ${b.library}.`);
      library = lib.id;
    }
    await n.setPrefs(user.id, library, {
      immediate: setting(b.immediate, "immediate"),
      digest: setting(b.digest, "digest"),
    });
    return c.body(null, 204);
  });

  // ------------------------------------------------------------------ one-click unsubscribe

  const unsubscribed = () =>
    html(
      "<h1>Unsubscribed</h1><p>You get no more notification mail from Tempra. Turn it back on from your Account page.</p>",
      200,
      {},
      "Unsubscribed",
    );
  const badKey = () =>
    html(
      "<h1>Link not valid</h1><p>Change what you are mailed from your Account page.</p>",
      404,
      {},
      "Unsubscribe",
    );

  // A mail client or scanner may fetch the link: the GET only asks, the POST does it.
  app.get("/unsubscribe", async (c) => {
    const key = c.req.query("k") ?? "";
    if (!/^[0-9a-f]{48}$/.test(key)) return badKey();
    return html(
      `<h1>Unsubscribe</h1><p>Stop all notification mail from Tempra?</p>
<form method="post" action="/unsubscribe?k=${esc(key)}"><p><button class="primary" type="submit">Unsubscribe</button></p></form>`,
      200,
      {},
      "Unsubscribe",
    );
  });

  // RFC 8058: the mail provider posts here, from its own site, with no session. The key is the
  // credential, and all it can do is turn mail off.
  app.post("/unsubscribe", async (c) => {
    const n = notificationsOf(deps(c.env));
    const user = await n.unsubscribe(c.req.query("k") ?? "");
    return user ? unsubscribed() : badKey();
  });

  // ------------------------------------------------------------------ local dev outbox

  const devOnly = (c: C) => {
    if (!devSignIn(c.req.raw, c.env)) throw new OkfError(404, "no_route", "No such route.");
  };

  app.get("/_dev/mail", (c) => {
    devOnly(c);
    const rows = devOutbox
      .map(
        (m) =>
          `<article><h2>${esc(m.subject)}</h2><p class="small muted">To ${esc(m.to)} · ${esc(m.at)}</p><pre>${esc(m.text)}</pre></article>`,
      )
      .join("");
    return html(
      `<h1>Dev outbox</h1><form method="post" action="/_dev/mail/send"><p><button type="submit">Send what waits now</button></p></form>${rows || "<p>No mail yet.</p>"}`,
      200,
      {},
      "Dev outbox",
    );
  });

  app.get("/_dev/mail.json", (c) => {
    devOnly(c);
    return c.json({ mails: devOutbox });
  });

  // Runs the immediate mail now, without its quiet period, into the outbox.
  app.post("/_dev/mail/send", async (c) => {
    devOnly(c);
    const d = deps(c.env);
    const r = await flushMail(
      {
        accounts: d.accounts,
        notifications: notificationsOf(d),
        mailer: devMailer,
        origin: new URL(c.req.url).origin,
        now: new Date(),
      },
      { force: true },
    );
    if ((c.req.header("Accept") ?? "").includes("application/json")) return c.json(r);
    return c.redirect("/_dev/mail", 303);
  });
}
