import * as app from "@tempra/app";
import { href as designHref } from "@tempra/design";
import { esc } from "./layout";

/** The app's client bundle, at a content-hashed URL like the design stylesheet. */
export const appHref = app.href;

export function appScript(): Response {
  return new Response(app.js, {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/**
 * The single page every rebuilt UI route answers with (TEMPRA-9): the design stylesheet, the
 * app's bundle and an empty root. Scripts only from this origin; styles from this origin plus a
 * per-response nonce, which Wordgard's runtime styles will use (Wordgard.cspNonce); no inline
 * scripts or styles. The page carries nothing private: the app reads everything through the API.
 */
export function spaShell(request: Request): Response {
  const url = new URL(request.url);
  // The change feed's WebSocket, on this host (wss:, or ws: for local http).
  const socket = `${url.protocol === "https:" ? "wss" : "ws"}://${url.host}`;
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="csp-nonce" content="${esc(nonce)}">
<title>Tempra</title>
<link rel="stylesheet" href="${designHref}">
<script type="module" src="${appHref}"></script></head>
<body><div id="root"></div></body></html>`;
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": [
        "default-src 'none'",
        "script-src 'self'",
        `style-src 'self' 'nonce-${nonce}'`,
        "img-src 'self' https:",
        `connect-src 'self' ${socket}`,
        "form-action 'self'",
        "frame-ancestors 'none'",
        "base-uri 'none'",
      ].join("; "),
      "X-Frame-Options": "DENY",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
      "Cache-Control": "no-store",
    },
  });
}
