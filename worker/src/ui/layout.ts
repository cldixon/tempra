import { esc, page } from "../oauth/pages";

export { esc };

export interface Shell {
  title: string;
  /** Signed-in email (kept for the callers; the shell shows the wordmark only, no script). */
  user: string;
  body: string;
}

/** A server page in the same shell as sign-in and consent (oauth/pages.ts). */
export function layout(s: Shell): string {
  return page(s.title, s.body);
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
