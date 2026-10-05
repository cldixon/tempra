import { href as designHref } from "@tempra/design";
import { esc } from "../oauth/pages";

export { esc };

export interface Shell {
  title: string;
  /** Signed-in email, shown in the header. */
  user: string;
  body: string;
}

export function layout(s: Shell): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(s.title)} - Tempra</title>
<link rel="stylesheet" href="${designHref}"></head>
<body>${s.user ? `<header>Tempra: <a href="/">Libraries</a> | <a href="/connect">Connect</a> | <a href="/tokens">Tokens</a> | <a href="/apps">Connected apps</a> | <a href="/account">${esc(s.user)}</a></header><hr>` : ""}
<main>${s.body}</main></body></html>`;
}

/**
 * Security headers for every UI page: no scripts, images from here or https, and styles only from
 * the shared design stylesheet (TEMPRA-8: style-src 'self', no inline styles).
 */
export function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'self'; img-src 'self' https:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
      "X-Frame-Options": "DENY",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
      "Cache-Control": "no-store",
    },
  });
}
