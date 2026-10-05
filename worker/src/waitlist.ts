import type { Hono } from "hono";
import type { Deps } from "./app";
import { esc, messagePage } from "./oauth/pages";
import { fromThisSite } from "./origin";
import { html, operatorEmail, signedIn } from "./signin";

/**
 * The operator's review of the waitlist (v2 spec: Accounts and sign-in, The waitlist): who asked
 * to join, with Approve and Dismiss. Only the session whose email is OPERATOR_EMAIL sees it;
 * everyone else gets 404. A server page, like sign-in: it works with no script.
 */

type AppEnv = { Bindings: Cloudflare.Env };

const notFound = () => messagePage("Not found", "There is nothing here.", 404);

function reviewPage(entries: { email: string; created: string }[], done?: string): Response {
  const rows = entries
    .map(
      (e) => `<tr><td>${esc(e.email)}</td><td>${esc(e.created.slice(0, 10))}</td><td>
<form method="post" action="/waitlist"><input type="hidden" name="email" value="${esc(e.email)}">
<button type="submit" name="decision" value="invited">Approve</button>
<button type="submit" name="decision" value="dismissed">Dismiss</button></form></td></tr>`,
    )
    .join("\n");
  const list = entries.length
    ? `<table><thead><tr><th>Email</th><th>Asked</th><th></th></tr></thead><tbody>
${rows}
</tbody></table>`
    : "<p>Nobody is waiting.</p>";
  return html(
    `<h1>Waitlist</h1>${done ? `<p>${esc(done)}</p>` : ""}
<p>Approving invites the email and tells them they can sign in.</p>
${list}
<p><a href="/">Libraries</a></p>`,
    200,
    {},
    "Waitlist",
  );
}

export function registerWaitlistRoutes<E extends AppEnv>(
  app: Hono<E>,
  deps: (env: Cloudflare.Env) => Deps,
) {
  app.get("/waitlist", async (c) => {
    const d = deps(c.env);
    const user = await signedIn(c.req.raw, d);
    if (user instanceof Response) return user;
    if (user.email !== operatorEmail(c.env)) return notFound();
    return reviewPage(await d.accounts.waitlist());
  });

  app.post("/waitlist", async (c) => {
    const d = deps(c.env);
    const user = await signedIn(c.req.raw, d);
    if (user instanceof Response) return user;
    if (user.email !== operatorEmail(c.env)) return notFound();
    if (!fromThisSite(c.req.raw)) return messagePage("Refused", "Decide from this site.", 403);
    const form = await c.req.formData();
    const email = String(form.get("email") ?? "");
    const decision = String(form.get("decision") ?? "");
    if (decision !== "invited" && decision !== "dismissed") {
      return messagePage("Bad request", "Approve or dismiss.", 400);
    }
    const decided = await d.accounts.decideWaitlist(email, decision);
    let done = decided ? `${email} dismissed.` : `${email} was not waiting.`;
    if (decided && decision === "invited") {
      done = `${email} approved.`;
      if (d.mailer) {
        const origin = new URL(c.req.url).origin;
        try {
          await d.mailer.send({
            to: email,
            subject: "You're in: Tempra",
            text: `You asked to join Tempra, and you're in.\n\nSign in with this email at ${origin}/sign-in\n`,
          });
          d.meter?.({ kind: "email", account: email });
        } catch (e) {
          console.error(JSON.stringify({ mail_failed: "waitlist approval", error: String(e) }));
          done = `${email} approved, but the email to them failed; tell them yourself.`;
        }
      } else {
        done = `${email} approved. This deployment cannot send email; tell them yourself.`;
      }
    }
    return reviewPage(await d.accounts.waitlist(), done);
  });
}
