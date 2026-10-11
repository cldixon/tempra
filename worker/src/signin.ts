import type { Context, Hono } from "hono";
import { type SignupMode, signupMode, type User } from "./accounts";
import type { Deps } from "./app";
import { LEGAL } from "./legal";
import { esc, messagePage, page } from "./oauth/pages";
import { fromThisSite } from "./origin";
import {
  clearedSessionCookie,
  LINK_MINUTES,
  readCookie,
  SESSION_COOKIE,
  safeNext,
  sessionCookie,
} from "./session";

/**
 * Sign-in for the UI (v2 spec: Accounts and sign-in): email magic links and session cookies.
 * Who may get a link is the deployment's SIGNUP mode (v2 spec: A4): open, invite or closed.
 */

export interface Mailer {
  send(msg: {
    to: string;
    subject: string;
    text: string;
    /** Minimal HTML beside the text (notification mail). */
    html?: string;
    /** Extra headers: List-Unsubscribe and List-Unsubscribe-Post. */
    headers?: Record<string, string>;
  }): Promise<void>;
}

type AppEnv = { Bindings: Cloudflare.Env };
type C = Context<AppEnv>;

function isLoopback(url: URL): boolean {
  return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

/** Local dev and the gate: no mail provider, links shown on the page and logged. */
export function devSignIn(req: Request, env: Cloudflare.Env): boolean {
  return env.DEV_SIGNIN === "1" && isLoopback(new URL(req.url));
}

/**
 * The signed-in user, or the response to send instead: a redirect to the sign-in page for a
 * page load, a 401 page for anything else.
 */
export async function signedIn(
  req: Request,
  deps: Pick<Deps, "accounts" | "sessions">,
): Promise<User | Response> {
  const secret = readCookie(req, SESSION_COOKIE);
  if (secret) {
    const user = await deps.sessions.user(secret);
    if (user) return user;
  }
  const url = new URL(req.url);
  if (req.method === "GET" || req.method === "HEAD") {
    const next = encodeURIComponent(url.pathname + url.search);
    return new Response(null, {
      status: 302,
      headers: { Location: `/sign-in?next=${next}`, "Cache-Control": "no-store" },
    });
  }
  return messagePage("Not signed in", "Sign in again, then retry.", 401);
}

/**
 * Sends a link by email, or in local dev (no mailer, DEV_SIGNIN=1, loopback) logs it and returns
 * the link, to show on the page. Returns "" once mailed, or null when sending failed.
 */
export async function sendLink(
  req: Request,
  env: Cloudflare.Env,
  d: Pick<Deps, "mailer" | "meter">,
  msg: { to: string; subject: string; text: string; link: string },
): Promise<string | null> {
  // Local dev shows the link even when a mailer is bound, so nothing real is sent from cf dev.
  if (!d.mailer || devSignIn(req, env)) {
    if (!devSignIn(req, env)) return null;
    console.log(`Link for ${msg.to}: ${msg.link}`);
    return msg.link;
  }
  try {
    await d.mailer.send({ to: msg.to, subject: msg.subject, text: msg.text });
    d.meter?.({ kind: "email", account: msg.to });
    return "";
  } catch (e) {
    console.error(JSON.stringify({ mail_failed: msg.subject, error: String(e) }));
    return null;
  }
}

/**
 * Runs work after the response when the platform allows (so the sign-in page answers in the
 * same time whatever the email is), otherwise now. Failures are logged, never shown.
 */
function afterResponse(c: C, work: Promise<unknown>) {
  const logged = work.catch((e) => console.error(JSON.stringify({ after_response: String(e) })));
  try {
    c.executionCtx.waitUntil(logged);
  } catch {
    // No execution context (tests): the promise already runs; nothing waits on it.
  }
}

/** The operator's email (Worker secret OPERATOR_EMAIL), normalized like sign-in emails. */
export const operatorEmail = (env: Cloudflare.Env) =>
  env.OPERATOR_EMAIL?.trim().toLowerCase() || null;

/** Tells the operator a new email joined the waitlist (v2 spec: Accounts, The waitlist). */
async function notifyOperator(env: Cloudflare.Env, d: Deps, email: string, origin: string) {
  const to = operatorEmail(env);
  if (!to || !d.mailer) return;
  await d.mailer.send({
    to,
    subject: `Tempra waitlist: ${email}`,
    text: `${email} asked to join Tempra.\n\nApprove or dismiss: ${origin}/waitlist\n`,
  });
  d.meter?.({ kind: "email", account: to });
}

/** A server-rendered page with the strict headers sign-in uses: no script, no framing, no cache. */
export function html(
  body: string,
  status = 200,
  headers: Record<string, string> = {},
  title = "Sign in",
): Response {
  return new Response(page(title, body), {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'",
      "Cache-Control": "no-store",
      // same-origin: the link's secret never leaves in a Referer, and form posts still carry Origin.
      "Referrer-Policy": "same-origin",
      ...headers,
    },
  });
}

function sameOrigin(c: C): boolean {
  return fromThisSite(c.req.raw);
}

const EMAIL = /^[^\s@]+@[^\s@]+$/;

function signInForm(next: string, mode: SignupMode, opts: { email?: string; error?: string } = {}) {
  const err = opts.error ? `<p class="notice">${esc(opts.error)}</p>` : "";
  const intro =
    mode === "invite"
      ? "Tempra is in private beta. If your email is on the list, we send you a link; if not, you join the waitlist and we write once you are in."
      : "We email you a link. New here? The same link creates your account.";
  return `<h1>Sign in</h1>
<p>${intro}</p>
${err}<form method="post" action="/sign-in" class="stack">
<input type="hidden" name="next" value="${esc(next)}">
<label class="field">Email
<input id="email" name="email" type="text" inputmode="email" autocomplete="email" required autofocus value="${esc(opts.email ?? "")}"></label>
<p><button class="primary" type="submit">Email me a link</button></p></form>
<p class="small faint"><a href="${LEGAL}/terms">Terms</a> · <a href="${LEGAL}/privacy">Privacy</a></p>`;
}

export function registerSignInRoutes<E extends AppEnv>(
  app: Hono<E>,
  deps: (env: Cloudflare.Env) => Deps,
) {
  const unavailable = (c: C) => !deps(c.env).mailer && !devSignIn(c.req.raw, c.env);

  app.get("/sign-in", async (c) => {
    const next = safeNext(c.req.query("next"));
    const secret = readCookie(c.req.raw, SESSION_COOKIE);
    if (secret && (await deps(c.env).sessions.user(secret))) return c.redirect(next, 302);
    if (unavailable(c as unknown as C)) {
      return html(
        `<h1>Sign-in is not set up</h1><p>This deployment has no way to send sign-in emails yet.</p>`,
        503,
      );
    }
    return html(signInForm(next, signupMode(c.env.SIGNUP)));
  });

  app.post("/sign-in", async (c) => {
    if (!sameOrigin(c as unknown as C))
      return messagePage("Refused", "Sign in from this site.", 403);
    const d = deps(c.env);
    const form = await c.req.formData();
    const next = safeNext(String(form.get("next") ?? ""));
    const email = String(form.get("email") ?? "")
      .trim()
      .toLowerCase();
    if (!EMAIL.test(email) || email.length > 254) {
      return html(
        signInForm(next, signupMode(c.env.SIGNUP), {
          email,
          error: "That does not look like an email address.",
        }),
        400,
      );
    }
    const dev = devSignIn(c.req.raw, c.env);
    if (!d.mailer && !dev) {
      return html(`<h1>Sign-in is not set up</h1><p>This deployment cannot send email.</p>`, 503);
    }
    const ip = c.req.header("CF-Connecting-IP") ?? null;
    const allowed = await d.accounts.mayJoin(email, signupMode(c.env.SIGNUP));
    if (!allowed && (await d.accounts.joinWaitlist(email, ip))) {
      afterResponse(c as unknown as C, notifyOperator(c.env, d, email, new URL(c.req.url).origin));
    }
    const secret = allowed ? await d.sessions.createLink(email, ip) : null;
    let shown = "";
    if (secret) {
      const origin = new URL(c.req.url).origin;
      const link = `${origin}/sign-in/link?t=${secret}&next=${encodeURIComponent(next)}`;
      const sent = await sendLink(c.req.raw, c.env, d, {
        to: email,
        link,
        subject: "Your Tempra sign-in link",
        text: `Open this link to sign in to Tempra:\n\n${link}\n\nIt works once, within ${LINK_MINUTES} minutes. If you did not ask for it, ignore this email.\n`,
      });
      if (sent === null) {
        return html("<h1>Could not send email</h1><p>Try again in a few minutes.</p>", 502);
      }
      // Local dev: the link is shown here instead of mailed.
      shown = sent
        ? `<p>Local dev, no email sent: <a id="dev-link" href="${esc(sent)}">link</a></p>`
        : "";
    }
    // The same answer whether the email has an account, is invited, is waitlisted, or asked
    // too often: the page reveals none of it.
    return html(`<h1>Check your email</h1>
<p>If <strong>${esc(email)}</strong> can sign in here, a link is on its way. It works once, within ${LINK_MINUTES} minutes. If not, the address is on the waitlist.</p>
<p class="muted">Nothing? Check spam, or <a href="/sign-in?next=${esc(encodeURIComponent(next))}">try again</a> later.</p>${shown}`);
  });

  // Opening the link only shows a button: mail scanners that fetch links cannot use it up.
  app.get("/sign-in/link", (c) => {
    const t = c.req.query("t") ?? "";
    const next = safeNext(c.req.query("next"));
    return html(`<h1>Sign in</h1><p>Continue to finish signing in on this device.</p>
<form method="post" action="/sign-in/link">
<input type="hidden" name="t" value="${esc(t)}"><input type="hidden" name="next" value="${esc(next)}">
<p><button class="primary" type="submit">Continue</button></p></form>`);
  });

  app.post("/sign-in/link", async (c) => {
    if (!sameOrigin(c as unknown as C))
      return messagePage("Refused", "Sign in from this site.", 403);
    const d = deps(c.env);
    const form = await c.req.formData();
    const next = safeNext(String(form.get("next") ?? ""));
    const email = (await d.sessions.consumeLink(String(form.get("t") ?? "")))?.email;
    if (!email) {
      return html(
        `<h1>This link has expired</h1><p>Sign-in links work once, within ${LINK_MINUTES} minutes.</p><p><a href="/sign-in?next=${esc(encodeURIComponent(next))}">Get a new link</a></p>`,
        400,
      );
    }
    // Checked again here: an invite may have been withdrawn since the link was sent.
    if (!(await d.accounts.mayJoin(email, signupMode(c.env.SIGNUP)))) {
      return html("<h1>Not invited</h1><p>This address is on the waitlist.</p>", 403);
    }
    const user = await d.accounts.user(email);
    const secret = await d.sessions.create(user.id, c.req.header("User-Agent") ?? null);
    return new Response(null, {
      status: 303,
      headers: { Location: next, "Set-Cookie": sessionCookie(secret), "Cache-Control": "no-store" },
    });
  });

  const signOut = async (c: C, everywhere: boolean) => {
    if (!sameOrigin(c)) return messagePage("Refused", "Sign out from this site.", 403);
    const d = deps(c.env);
    const secret = readCookie(c.req.raw, SESSION_COOKIE);
    if (secret) {
      const user = everywhere ? await d.sessions.user(secret) : null;
      if (user) await d.sessions.endAll(user.id);
      else await d.sessions.end(secret);
    }
    return new Response(null, {
      status: 303,
      headers: { Location: "/sign-in", "Set-Cookie": clearedSessionCookie },
    });
  };
  app.post("/sign-out", (c) => signOut(c as unknown as C, false));
  app.post("/sign-out/everywhere", (c) => signOut(c as unknown as C, true));
}
