import type { Context, Hono } from "hono";
import { type SignupMode, signupMode, type User } from "./accounts";
import type { Deps } from "./app";
import { LEGAL } from "./legal";
import { alertNotice, esc, invalid, messagePage, PAGE_HEADERS, page } from "./oauth/pages";
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
  return messagePage("Not signed in", "Sign in again, then retry.", 401, SIGN_IN);
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
  return new Response(page(title, body), { status, headers: { ...PAGE_HEADERS, ...headers } });
}

function sameOrigin(c: C): boolean {
  return fromThisSite(c.req.raw);
}

const EMAIL = /^[^\s@]+@[^\s@]+$/;

const SIGN_IN = { href: "/sign-in", label: "Go to sign in" };

/** Said wherever a link may not have been sent: the link limits per email and per IP. */
const RATE_HINT = "If you asked several times, wait an hour, then try again.";

/** Who is new here, by mode (TEMPRA-125): the line under the sign-in form. */
function newHere(mode: SignupMode): string {
  if (mode === "open") return "New here? The same link creates your account.";
  if (mode === "invite") return `No account yet? <a href="/request-access">Request access</a>.`;
  return "Tempra is not taking new accounts.";
}

function signInForm(next: string, mode: SignupMode, opts: { email?: string; error?: string } = {}) {
  const err = opts.error ? alertNotice("email-error", opts.error) : "";
  return `<h1>Sign in</h1>
<p>We'll email you a link.</p>
${err}<form method="post" action="/sign-in" class="stack">
<input type="hidden" name="next" value="${esc(next)}">
<label class="field">Email
<input id="email" name="email" type="text" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" required autofocus value="${esc(opts.email ?? "")}"${invalid("email-error", !!opts.error)}></label>
<p><button class="primary" type="submit">Email me a link</button></p></form>
<p class="muted">${newHere(mode)}</p>`;
}

function requestForm(opts: { email?: string; error?: string } = {}) {
  const err = opts.error ? alertNotice("email-error", opts.error) : "";
  return `<h1>Request access</h1>
<p>Tempra is in private beta. Leave your email and we'll write when you're in.</p>
${err}<form method="post" action="/request-access" class="stack">
<label class="field">Email
<input id="email" name="email" type="text" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" required autofocus value="${esc(opts.email ?? "")}"${invalid("email-error", !!opts.error)}></label>
<p><button class="primary" type="submit">Request access</button></p></form>
<p class="muted">Have an account? <a href="/sign-in">Sign in</a>.</p>`;
}

const notSetUp = () =>
  html(
    `<h1>Sign-in is not set up</h1><p>This deployment has no way to send sign-in emails yet.</p>`,
    503,
    {},
    "Sign-in is not set up",
  );

const closedPage = () =>
  html(
    `<h1>Not taking new accounts</h1><p>Tempra is not taking new accounts right now.</p><p><a href="/sign-in">Sign in</a> · <a href="${LEGAL}">About Tempra</a></p>`,
    200,
    {},
    "Not taking new accounts",
  );

/** The email from a sign-in or request form, normalized, and whether it looks like one. */
function formEmail(form: FormData): { email: string; ok: boolean } {
  const email = String(form.get("email") ?? "")
    .trim()
    .toLowerCase();
  return { email, ok: EMAIL.test(email) && email.length <= 254 };
}

/** Local dev: the link shown on the page instead of mailed. */
const devLink = (shown: string) =>
  shown ? `<p>Local dev, no email sent: <a id="dev-link" href="${esc(shown)}">link</a></p>` : "";

/**
 * Creates and sends a sign-in link, within the per-email and per-IP limits. The dev link to show,
 * "" when mailed or when over a limit (the page says the same either way), null when sending
 * failed.
 */
async function mailSignInLink(
  c: C,
  d: Deps,
  email: string,
  next: string,
  intro: string,
): Promise<string | null> {
  const secret = await d.sessions.createLink(email, c.req.header("CF-Connecting-IP") ?? null);
  if (!secret) return "";
  const link = `${new URL(c.req.url).origin}/sign-in/link?t=${secret}&next=${encodeURIComponent(next)}`;
  return sendLink(c.req.raw, c.env, d, {
    to: email,
    link,
    subject: "Your Tempra sign-in link",
    text: `${intro}\n\n${link}\n\nIt works once, within ${LINK_MINUTES} minutes. If you did not ask for it, ignore this email.\n`,
  });
}

const couldNotSend = (back: string) =>
  html(
    `<h1>Could not send email</h1><p>Try again in a few minutes.</p><p><a href="${esc(back)}">Back</a></p>`,
    502,
    {},
    "Could not send email",
  );

/** Tells a new waitlisted email it is on the list, once (TEMPRA-125). */
async function welcomeToWaitlist(c: C, d: Deps, email: string) {
  const text = `Thanks for asking to join Tempra. You're on the list, and we'll email this address when you're in.\n\nIf you did not ask, ignore this email.\n`;
  if (!d.mailer || devSignIn(c.req.raw, c.env)) {
    if (devSignIn(c.req.raw, c.env)) console.log(`Waitlist email for ${email}`);
    return;
  }
  await d.mailer.send({ to: email, subject: "You're on the list: Tempra", text });
  d.meter?.({ kind: "email", account: email });
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
    if (unavailable(c as unknown as C)) return notSetUp();
    return html(signInForm(next, signupMode(c.env.SIGNUP)));
  });

  app.post("/sign-in", async (c) => {
    if (!sameOrigin(c as unknown as C))
      return messagePage("Refused", "Sign in from this site.", 403, SIGN_IN);
    const d = deps(c.env);
    const form = await c.req.formData();
    const next = safeNext(String(form.get("next") ?? ""));
    const mode = signupMode(c.env.SIGNUP);
    const { email, ok } = formEmail(form);
    if (!ok) {
      return html(
        signInForm(next, mode, { email, error: "That does not look like an email address." }),
        400,
      );
    }
    if (unavailable(c as unknown as C)) return notSetUp();
    // Sign-in never adds anyone to the waitlist: that is Request access (TEMPRA-125).
    let shown = "";
    if (await d.accounts.mayJoin(email, mode)) {
      const sent = await mailSignInLink(
        c as unknown as C,
        d,
        email,
        next,
        "Open this link to sign in to Tempra:",
      );
      if (sent === null) return couldNotSend(`/sign-in?next=${encodeURIComponent(next)}`);
      shown = sent;
    }
    // The same answer whether the email has an account, is invited, or asked too often: the page
    // reveals none of it.
    const lead =
      mode === "open"
        ? `A link is on its way to <strong>${esc(email)}</strong>.`
        : `If <strong>${esc(email)}</strong> can sign in here, a link is on its way.`;
    const after =
      mode === "invite" ? ` No account yet? <a href="/request-access">Request access</a>.` : "";
    return html(
      `<h1>Check your email</h1>
<p>${lead} It works once, within ${LINK_MINUTES} minutes.</p>
<p class="muted">Nothing? Check spam. ${RATE_HINT} <a href="/sign-in?next=${esc(encodeURIComponent(next))}">Back to sign in</a>.${after}</p>${devLink(shown)}`,
      200,
      {},
      "Check your email",
    );
  });

  // Request access (TEMPRA-125): joining is its own path while sign-up is by invite.
  app.get("/request-access", (c) => {
    const mode = signupMode(c.env.SIGNUP);
    if (mode === "open") return c.redirect("/sign-in", 302);
    if (mode === "closed") return closedPage();
    if (unavailable(c as unknown as C)) return notSetUp();
    return html(requestForm(), 200, {}, "Request access");
  });

  app.post("/request-access", async (c) => {
    if (!sameOrigin(c as unknown as C))
      return messagePage("Refused", "Ask from this site.", 403, SIGN_IN);
    const mode = signupMode(c.env.SIGNUP);
    if (mode === "open") return c.redirect("/sign-in", 303);
    if (mode === "closed") return closedPage();
    if (unavailable(c as unknown as C)) return notSetUp();
    const d = deps(c.env);
    const { email, ok } = formEmail(await c.req.formData());
    if (!ok) {
      return html(
        requestForm({ email, error: "That does not look like an email address." }),
        400,
        {},
        "Request access",
      );
    }
    let shown = "";
    if (await d.accounts.mayJoin(email, mode)) {
      // Already in: a sign-in link, in the same limits as sign-in.
      const sent = await mailSignInLink(
        c as unknown as C,
        d,
        email,
        "/",
        "You can already sign in to Tempra. Open this link to sign in:",
      );
      if (sent === null) return couldNotSend("/request-access");
      shown = sent;
    } else {
      const joined = await d.accounts.joinWaitlist(email, c.req.header("CF-Connecting-IP") ?? null);
      // After the response, so the page answers in the same time whatever the address is.
      if (joined.added)
        afterResponse(c as unknown as C, welcomeToWaitlist(c as unknown as C, d, email));
      if (joined.notify) {
        afterResponse(
          c as unknown as C,
          notifyOperator(c.env, d, email, new URL(c.req.url).origin),
        );
      }
    }
    return html(
      `<h1>Request received</h1>
<p>If <strong>${esc(email)}</strong> is new here, it is on the list and we've emailed to say so; we write again when you're in. If it can already sign in, we've emailed a sign-in link.</p>
<p class="muted">Nothing? Check spam. ${RATE_HINT} <a href="/">Back</a>.</p>${devLink(shown)}`,
      200,
      {},
      "Request received",
    );
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
      return messagePage("Refused", "Sign in from this site.", 403, SIGN_IN);
    const d = deps(c.env);
    const form = await c.req.formData();
    const next = safeNext(String(form.get("next") ?? ""));
    const email = (await d.sessions.consumeLink(String(form.get("t") ?? "")))?.email;
    if (!email) {
      return html(
        `<h1>This link has expired or was already used</h1><p>Sign-in links work once, within ${LINK_MINUTES} minutes.</p><p><a href="/sign-in?next=${esc(encodeURIComponent(next))}">Get a new link</a></p>`,
        400,
        {},
        "Link expired",
      );
    }
    // Checked again here: an invite may have been withdrawn since the link was sent.
    const mode = signupMode(c.env.SIGNUP);
    if (!(await d.accounts.mayJoin(email, mode))) {
      const onward =
        mode === "invite"
          ? `<a href="/request-access">Request access</a>`
          : `<a href="${LEGAL}">About Tempra</a>`;
      return html(
        `<h1>Not invited</h1><p>This address cannot sign in yet.</p><p>${onward}</p>`,
        403,
        {},
        "Not invited",
      );
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
    // Where to come back to after signing in again (consent's "Not you? Sign out").
    const form = await c.req.formData().catch(() => null);
    const next = safeNext(String(form?.get("next") ?? ""));
    const d = deps(c.env);
    const secret = readCookie(c.req.raw, SESSION_COOKIE);
    if (secret) {
      const user = everywhere ? await d.sessions.user(secret) : null;
      if (user) await d.sessions.endAll(user.id);
      else await d.sessions.end(secret);
    }
    return new Response(null, {
      status: 303,
      headers: {
        Location: next === "/" ? "/sign-in" : `/sign-in?next=${encodeURIComponent(next)}`,
        "Set-Cookie": clearedSessionCookie,
      },
    });
  };
  app.post("/sign-out", (c) => signOut(c as unknown as C, false));
  app.post("/sign-out/everywhere", (c) => signOut(c as unknown as C, true));
}
