import * as app from "@tempra/app";
import { href as designHref } from "@tempra/design";
import type { LibraryClient } from "../client";
import { basename, dirname } from "../okf/paths";
import type { JsonObject } from "../okf/types";
import { esc } from "./layout";
import { linkTarget, renderBody } from "./markdown";
import { anchorId, type SourcesData, Urls, withoutTitleHeading } from "./views";

/** Maps a link or image in the body of the file at `from` to a UI URL. */
export function bodyUrl(urls: Urls, from: string) {
  return (target: string, kind: "link" | "image"): string | null => {
    const t = linkTarget(from, target);
    if (!t) return null;
    if (t.kind !== "internal") return t.href;
    const name = basename(t.path);
    if (t.dir || t.path === "") return urls.tree(t.path) + (t.anchor ?? "");
    if (name === "index.md") return urls.tree(dirname(t.path)) + (t.anchor ?? "");
    return kind === "image" ? urls.download(t.path) : urls.file(t.path, t.anchor);
  };
}

/**
 * What the app shows for a file (GET /api/v1/libraries/{owner}/{slug}/render/{path}): a concept's
 * or synthesized file's body as HTML from the server's renderer (no raw HTML, safe URLs only,
 * links pointing at UI pages), until the Wordgard reader replaces it (TEMPRA-11). A concept's
 * sources and footnote definitions come with it; an attachment is described, not rendered.
 */
export async function renderView(lib: LibraryClient, urls: Urls, path: string) {
  const [view, head] = await Promise.all([lib.read(path, { at: urls.at }), lib.headSeq()]);
  if (view.kind === "attachment") {
    const { kind, size, media, hash, seq } = view;
    return { kind, path: view.path, head, seq, size, media: media ?? null, hash };
  }
  if (view.kind === "derived") {
    const rendered = renderBody(view.markdown, {
      url: bodyUrl(urls, view.path),
      footnote: () => null,
    });
    return { kind: view.kind, path: view.path, head, seq: view.seq, html: rendered.html };
  }
  const sources = (await lib.sources(view.path, { at: urls.at })) as SourcesData;
  const ids = new Set(
    sources.sources
      .map((s: JsonObject) => s.id)
      .filter((id): id is string => typeof id === "string"),
  );
  const fm = view.frontmatter;
  const title = typeof fm.title === "string" && fm.title ? fm.title : basename(view.path);
  const rendered = renderBody(withoutTitleHeading(view.body, title), {
    url: bodyUrl(urls, view.path),
    footnote: (label, defined) =>
      ids.has(label) ? `#${anchorId("src", label)}` : defined ? `#${anchorId("fn", label)}` : null,
  });
  return {
    kind: view.kind,
    path: view.path,
    head,
    seq: view.seq,
    html: rendered.html,
    /** Footnote definitions as HTML, by label. */
    footnotes: Object.fromEntries(rendered.footnotes),
    sources,
  };
}

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
export function spaShell(): Response {
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
        "connect-src 'self'",
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

export { Urls };
