import * as app from "@tempra/app";
import { href as designHref } from "@tempra/design";

/** The app's client bundle, at a content-hashed URL like the design stylesheet. */
export const appHref = app.href;

/** The bundle's entry at its hashed name, or a chunk it imports on demand; null for anything else. */
export function appScript(file: string): Response | null {
  const js =
    `/_app/${file}` === appHref
      ? app.js
      : Object.hasOwn(app.chunks, file)
        ? app.chunks[file]
        : undefined;
  if (js === undefined) return null;
  return new Response(js, {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/**
 * The single page every rebuilt UI route answers with (TEMPRA-9): the design stylesheet, the
 * app's bundle and an empty root. Scripts and styles only from this origin; no inline scripts or
 * styles (the reader's popovers get their coordinates through the CSSOM, which CSP leaves alone).
 * The page carries nothing private: the app reads everything through the API.
 */
export function spaShell(request: Request, opts: { theme?: string | null } = {}): Response {
  const url = new URL(request.url);
  // The account's theme on the root (take 4): the tokens' light-dark() values follow it from the
  // first paint; absent, the system decides.
  const theme =
    opts.theme === "light" || opts.theme === "dark" ? ` data-theme="${opts.theme}"` : "";
  // The change feed's WebSocket, on this host (wss:, or ws: for local http).
  const socket = `${url.protocol === "https:" ? "wss" : "ws"}://${url.host}`;
  const html = `<!doctype html>
<html lang="en"${theme}><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tempra</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="${designHref}">
<script type="module" src="${appHref}"></script></head>
<body><div id="root"></div></body></html>`;
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": [
        "default-src 'none'",
        "script-src 'self'",
        "style-src 'self'",
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
