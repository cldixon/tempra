import type { Context, Hono } from "hono";
import type { User } from "../accounts";
import type { Deps } from "../app";
import type { LibraryClient } from "../client";
import { isRouteName } from "../handles";
import { VARIANT_EDGES } from "../images";
import { esc, messagePage, type Onward, PAGE_HEADERS, page } from "../oauth/pages";
import { basename, dirname } from "../okf/paths";
import { fromThisSite } from "../origin";
import { byteRange } from "../range";
import { LINK_MINUTES, readCookie, SESSION_COOKIE } from "../session";
import { signedIn } from "../signin";
import { OkfError } from "../store/errors";
import { type Authorized, authorizeLibrary, requireOwner } from "../tenancy";
import { spaShell } from "./spa";
import { Urls } from "./urls";

type AppEnv = { Bindings: Cloudflare.Env };
type C = Context<AppEnv>;

interface Page {
  c: C;
  user: User;
  deps: Deps;
}

/** The part of the request path after `marker`, URL-decoded per segment. */
function tail(c: C, marker: string): string {
  const path = c.req.path;
  const i = path.indexOf(marker);
  return decodePath(i === -1 ? "" : path.slice(i + marker.length));
}

/** A URL path URL-decoded per segment, without trailing slashes. */
function decodePath(rest: string): string {
  return rest
    .split("/")
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    })
    .join("/")
    .replace(/\/+$/, "");
}

function atParam(c: C): number | undefined {
  const v = c.req.query("at");
  if (v === undefined || v === "") return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) {
    throw new OkfError(400, "bad_param", "`at` must be a sequence number.");
  }
  return n;
}

/** Session cookies are SameSite=Lax; writes also insist on a same-origin request. */
function requireSameOrigin(c: C) {
  if (!fromThisSite(c.req.raw)) {
    throw new OkfError(
      403,
      "cross_origin",
      "Changes must be submitted from this site's own pages.",
    );
  }
}

function errorPage(status: number, message: string, onward?: Onward): Response {
  const title =
    status === 404 ? "Not found" : status === 403 ? "Not allowed" : "Something went wrong";
  return messagePage(title, message, status, onward);
}

/**
 * Wraps a page handler: sign-in first, and OKF errors as HTML pages. A library path whose owner is
 * one of the service's route names (`/api/...`, `/.well-known/...`) is not a page: plain 404. One
 * whose owner is a handle released by a rename redirects to the account's current handle.
 */
function ui(deps: (env: Cloudflare.Env) => Deps, handler: (p: Page) => Promise<Response>) {
  return async (c: C) => {
    const owner = c.req.param("owner");
    if (owner !== undefined && isRouteName(owner)) return c.notFound();
    const d = deps(c.env);
    const user = await signedIn(c.req.raw, d);
    if (user instanceof Response) return user;
    try {
      return await handler({ c, user, deps: d });
    } catch (e) {
      if (e instanceof OkfError) {
        if (e.status === 404 && owner !== undefined && c.req.method === "GET") {
          const now = await d.accounts.heldHandle(owner);
          if (now && now !== owner) {
            const url = new URL(c.req.url);
            const rest = url.pathname.slice(`/${encodeURIComponent(owner)}`.length);
            return c.redirect(`/${encodeURIComponent(now)}${rest}${url.search}`, 301);
          }
        }
        return errorPage(e.status, e.message);
      }
      throw e;
    }
  };
}

/**
 * Where a URL from before the move to the root (/app/...) lives now (v2 spec: URLs). Library pages
 * moved from /app/libraries/{owner}/{lib}/{page}/... to /{owner}/{lib}/-/{page}/...
 */
export function legacyUrl(path: string): string {
  const rest = path.replace(/^\/app\/?/, "");
  if (rest === "" || rest === "libraries" || rest === "libraries/") return "/";
  if (rest === "grants" || rest.startsWith("grants/")) return "/agents";
  const m = rest.match(/^libraries\/([^/]+)\/([^/]+)(?:\/(.*))?$/);
  if (!m) return `/${rest}`;
  const [, owner, lib, page = ""] = m;
  const base = `/${owner}/${lib}/`;
  if (page === "") return base;
  if (page.startsWith("tree/")) return `${base}${page.slice(5)}`;
  if (page.startsWith("files/")) return `${base}${page.slice(6)}`;
  return `${base}-/${page}`;
}

/** The library at /{owner}/{slug}/, if the signed-in person may open it. */
async function openLibrary(p: Page): Promise<{ urls: Urls; lib: LibraryClient; ref: Authorized }> {
  const owner = p.c.req.param("owner") ?? "";
  const slug = p.c.req.param("lib") ?? "";
  const ref = await authorizeLibrary(p.deps.accounts, { user: p.user }, owner, slug);
  const lib = await p.deps.libraryByDoId(ref.do_id);
  if (!lib) throw new OkfError(404, "no_library", `There is no library ${owner}/${slug}.`);
  return { urls: new Urls(ref.owner, ref.slug, atParam(p.c)), lib, ref };
}

/** Raster images the Images binding scales for the reader; GIF keeps its frames as stored. */
const SCALABLE = new Set(["image/png", "image/jpeg", "image/webp"]);

/**
 * An image of the library, for the reader (TEMPRA-162; tempra-dev: app/media, How people see):
 * only a hash this library stored as an attachment, now or before (a hash is not a capability),
 * shown inline and cached for good by the browser alone (the hash names the bytes). With `w`, one
 * of VARIANT_EDGES, a raster image comes scaled to that long edge, as AVIF when the browser takes
 * it and WebP otherwise, never enlarged: an image already within it, an SVG, a GIF, or one the
 * binding cannot scale comes as stored.
 */
async function imageResponse(
  p: Page,
  lib: LibraryClient,
  hash: string,
  w: string | undefined,
): Promise<Response> {
  const img = await lib.imageBlob(hash);
  if (!img) throw new OkfError(404, "not_found", "This library has no such image.");
  let edge: number | null = null;
  if (w !== undefined) {
    edge = Number(w);
    if (!(VARIANT_EDGES as readonly number[]).includes(edge)) {
      throw new OkfError(400, "bad_param", `\`w\` must be one of ${VARIANT_EDGES.join(", ")}.`);
    }
  }
  const headers: Record<string, string> = {
    "Cache-Control": "private, max-age=31536000, immutable",
    "Content-Disposition": "inline",
    "X-Content-Type-Options": "nosniff",
  };
  const long = img.width && img.height ? Math.max(img.width, img.height) : null;
  if (edge !== null) {
    // What is served depends on Accept from here, even when it is the original.
    headers.Vary = "Accept";
    const images = p.deps.images;
    if (images && SCALABLE.has(img.media) && (long === null || edge < long)) {
      const avif = (p.c.req.header("Accept") ?? "").includes("image/avif");
      const scaled =
        (avif ? await images.scaled(hash, { maxEdge: edge, format: "avif" }) : null) ??
        (await images.scaled(hash, { maxEdge: edge, format: "webp" }));
      if (scaled) {
        return new Response(scaled.bytes, {
          headers: {
            ...headers,
            "Content-Type": scaled.media,
            "Content-Length": String(scaled.bytes.byteLength),
          },
        });
      }
    }
  }
  const obj = await p.deps.blobs.get(hash);
  if (!obj) throw new OkfError(404, "not_found", "The image's bytes are missing.");
  if (img.media === "image/svg+xml") {
    headers["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
  }
  return new Response(obj.body as ReadableStream | Uint8Array, {
    headers: { ...headers, "Content-Type": img.media, "Content-Length": String(obj.size) },
  });
}

/**
 * A video or audio file of the library, for the reader (TEMPRA-164; tempra-dev: app/media, How
 * people see): only a hash this library stored, as for images, inline and cached for good, and
 * served in ranges, as a video's seeking asks: 206 with `Content-Range` for one range, 416 for a
 * range past the end, the whole file otherwise.
 */
async function mediaResponse(p: Page, lib: LibraryClient, hash: string): Promise<Response> {
  const blob = await lib.mediaBlob(hash);
  if (!blob) throw new OkfError(404, "not_found", "This library has no such video or audio.");
  const headers: Record<string, string> = {
    "Cache-Control": "private, max-age=31536000, immutable",
    "Content-Disposition": "inline",
    "Content-Type": blob.media,
    "Accept-Ranges": "bytes",
    "X-Content-Type-Options": "nosniff",
  };
  const range = byteRange(p.c.req.header("Range"), blob.size);
  if (range === "unsatisfiable") {
    return new Response(null, {
      status: 416,
      headers: { ...headers, "Content-Range": `bytes */${blob.size}` },
    });
  }
  const part = range ? { offset: range.start, length: range.end - range.start + 1 } : undefined;
  const obj = await p.deps.blobs.get(hash, part);
  if (!obj) throw new OkfError(404, "not_found", "The file's bytes are missing.");
  if (!range) {
    return new Response(obj.body as ReadableStream | Uint8Array, {
      headers: { ...headers, "Content-Length": String(blob.size) },
    });
  }
  return new Response(obj.body as ReadableStream | Uint8Array, {
    status: 206,
    headers: {
      ...headers,
      "Content-Range": `bytes ${range.start}-${range.end}/${blob.size}`,
      "Content-Length": String(range.end - range.start + 1),
    },
  });
}

const ACCOUNT: Onward = { href: "/account", label: "Go to your account" };

/**
 * The email-change link's page (V-3). The link works only in the session of the account that
 * asked for it, so opened signed out or as someone else it says so, and how to go on, before the
 * person signs in (or up) with the new address by mistake. It shows the new address, which the
 * link's holder was sent, and never the account's current one unless that account is signed in.
 */
function emailChangePage(
  t: string,
  link: { email: string; user: string | null } | null,
  user: User | null,
  self: string,
): Response {
  if (!link) {
    return serverPage(
      "Link expired",
      `<h1>This link has expired or was already used</h1>
<p>Email links work once, within ${LINK_MINUTES} minutes. Ask for a new one from your account.</p>
<p><a href="/account">Go to your account</a></p>`,
      400,
    );
  }
  const next = encodeURIComponent(self);
  if (!user) {
    return serverPage(
      "Sign in first",
      `<h1>Sign in first</h1>
<p>This link makes <strong>${esc(link.email)}</strong> the email a Tempra account signs in with. Sign in with the email that account uses now, not the new one, and you come back here to confirm.</p>
<p><a class="button primary" href="/sign-in?next=${esc(next)}">Sign in</a></p>`,
    );
  }
  if (link.user !== user.id) {
    return serverPage(
      "Another account",
      `<h1>This link is for another account</h1>
<p>You are signed in as ${esc(user.email)}. Sign out, then sign in with the email the other account uses now, not ${esc(link.email)}.</p>
<form method="post" action="/sign-out"><input type="hidden" name="next" value="${esc(self)}">
<p><button class="primary" type="submit">Sign out</button></p></form>`,
      403,
    );
  }
  return serverPage(
    "Confirm email",
    `<h1>Confirm your new email</h1>
<p>Sign in with <strong>${esc(link.email)}</strong> from now on, in place of ${esc(user.email)}.</p>
<form method="post" action="/account/email/confirm">
<input type="hidden" name="t" value="${esc(t)}">
<div class="actions"><button class="primary" type="submit">Confirm</button><a class="button" href="/account">Back to Account</a></div>
</form>`,
  );
}

/** A server page with the strict headers (oauth/pages.ts). */
function serverPage(title: string, body: string, status = 200): Response {
  return new Response(page(title, body), { status, headers: { ...PAGE_HEADERS } });
}

/**
 * The app's pages (TEMPRA-9, TEMPRA-14): the server checks sign-in and, for a library's pages,
 * that the person may open it (404 otherwise), then answers with the app's shell; the app draws
 * the page from the REST API. Downloads, the raw markdown and the email-change link stay here;
 * sign-in and app consent are their own server pages (signin.ts, oauth/).
 */
export function registerUiRoutes<E extends AppEnv>(
  app: Hono<E>,
  deps: (env: Cloudflare.Env) => Deps,
) {
  const get = (path: string, handler: (p: Page) => Promise<Response>) =>
    app.get(path, ui(deps, handler) as never);
  const shell = (p: Page) => Promise.resolve(spaShell(p.c.req.raw, { theme: p.user.theme }));
  const library = async (p: Page) => {
    await openLibrary(p);
    return shell(p);
  };

  get("/", async (p) => {
    // First run: no libraries yet, own or shared (v2 spec: Onboarding; tempra-dev: v2/sharing).
    if ((await p.deps.accounts.reachable(p.user.id)).length === 0) {
      return p.c.redirect("/welcome", 302);
    }
    return shell(p);
  });
  for (const path of [
    "/welcome",
    "/agents",
    "/account",
    "/notifications",
    "/invitations",
    "/inbox",
  ]) {
    get(path, shell);
  }
  // Agents (2026-10-23) took the place of Connect an agent, Tokens and Connected apps; a link to
  // a library's tokens opens New token for it.
  for (const path of ["/connect", "/tokens", "/apps"]) {
    app.get(path, (c) => {
      const library = c.req.query("library");
      const to =
        path === "/tokens" && library
          ? `/agents?new=token&library=${encodeURIComponent(library)}`
          : "/agents";
      return c.redirect(to, 301);
    });
  }

  // The UI lived under /app until it moved to the root (v2 spec: URLs). 308 keeps a form post's
  // method and body; bookmarks and emailed links land on the page's new URL.
  const moved = (c: C) => {
    const url = new URL(c.req.url);
    return c.redirect(legacyUrl(url.pathname) + url.search, 308);
  };
  app.all("/app", moved as never);
  app.all("/app/*", moved as never);
  app.get("/:owner/:lib", (c) => {
    if (isRouteName(c.req.param("owner"))) return c.notFound();
    const url = new URL(c.req.url);
    return c.redirect(`${url.pathname}/${url.search}`, 301);
  });

  get("/:owner/:lib/", library);
  get("/:owner/:lib/-/tree/*", library);

  // A directory's index.md is the directory page itself.
  const file = async (p: Page, path: string) => {
    const { urls } = await openLibrary(p);
    if (basename(path) === "index.md") return p.c.redirect(urls.tree(dirname(path)));
    return shell(p);
  };
  get("/:owner/:lib/-/files/*", (p) => file(p, tail(p.c, "/-/files/")));
  for (const page of [
    "diff/*",
    "ledger",
    "revert/:request",
    "restore/*",
    "settings",
    "activity",
    "transfer",
    "recovery",
    "connect",
    "delete",
    "members",
  ]) {
    get(`/:owner/:lib/-/${page}`, library);
  }

  // For agents is retired (TEMPRA-144): the agents' housekeeping is theirs, through `work`; its
  // URL lands on the library's home, after the same check as the library's pages.
  get("/:owner/:lib/-/work", async (p) => {
    const { ref } = await openLibrary(p);
    return p.c.redirect(`/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.slug)}/`, 308);
  });

  // Needs you retired into the Inbox (take 4, TEMPRA-116): its URL lands on the Inbox filtered
  // to the library, after the same check as the library's pages.
  get("/:owner/:lib/-/needs", async (p) => {
    const { ref } = await openLibrary(p);
    const library = `${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.slug)}`;
    return p.c.redirect(`/inbox?library=${library}`, 308);
  });

  // The markdown exactly as an export writes it (spec: raw-source view).
  get("/:owner/:lib/-/raw/*", async (p) => {
    const { urls, lib } = await openLibrary(p);
    const view = await lib.read(tail(p.c, "/-/raw/"), { at: urls.at });
    if (view.kind === "attachment") return p.c.redirect(urls.download(view.path));
    return new Response(view.markdown, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
      },
    });
  });

  // Attachment bytes: a redirect to a short-lived signed URL, as the API and MCP hand out.
  get("/:owner/:lib/-/download/*", async (p) => {
    const { urls, lib, ref } = await openLibrary(p);
    const view = await lib.read(tail(p.c, "/-/download/"), { at: urls.at });
    if (view.kind !== "attachment") return p.c.redirect(urls.raw(view.path));
    const token = await lib.signDownload({
      k: "file",
      path: view.path,
      hash: view.hash,
      media: view.media ?? null,
    });
    return p.c.redirect(`/dl/${encodeURIComponent(ref.do_id)}/${token}`, 302);
  });

  // The reader's images by hash (TEMPRA-162; tempra-dev: app/media, How people see).
  get("/:owner/:lib/-/image/:hash", async (p) => {
    const { lib } = await openLibrary(p);
    return imageResponse(p, lib, p.c.req.param("hash") ?? "", p.c.req.query("w"));
  });

  // The reader's video and audio by hash, in ranges (TEMPRA-164).
  get("/:owner/:lib/-/media/:hash", async (p) => {
    const { lib } = await openLibrary(p);
    return mediaResponse(p, lib, p.c.req.param("hash") ?? "");
  });

  // Export: a redirect to a signed download, like the API's and MCP's export links.
  get("/:owner/:lib/-/export", async (p) => {
    const { urls, lib, ref } = await openLibrary(p);
    const at = urls.at ?? (await lib.headSeq());
    const token = await lib.signDownload({ k: "export", at, name: urls.slug });
    return p.c.redirect(`/dl/${encodeURIComponent(ref.do_id)}/${token}`, 302);
  });

  // The ledger as it stands, as JSON lines: Activity's Download (TEMPRA-115; tempra-dev:
  // app/activity). Every event in sequence order, each line as the nightly ledger.jsonl writes
  // its events (`{"t":"event",…}`); blob rows stay in the nightly dump, which restores need.
  // Read a page at a time up to the head when the download began, so a big ledger streams.
  get("/:owner/:lib/-/ledger.jsonl", async (p) => {
    const { lib, ref } = await openLibrary(p);
    const head = await lib.headSeq();
    const lines = new TextEncoder();
    let since = 0;
    const body = new ReadableStream<Uint8Array>({
      async pull(out) {
        const page = await lib.events({ since, limit: 1000 });
        const events = page.events.filter((e) => e.seq <= head);
        if (events.length > 0) {
          out.enqueue(
            lines.encode(events.map((e) => `${JSON.stringify({ t: "event", ...e })}\n`).join("")),
          );
          since = events.at(-1)?.seq ?? since;
        }
        if (page.next === null || since >= head || events.length === 0) out.close();
      },
    });
    return new Response(body, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Content-Disposition": `attachment; filename="${ref.slug}-ledger.jsonl"`,
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
      },
    });
  });

  // A nightly export's files, streamed from R2 (spec: Backups and recovery); the owner's alone.
  get("/:owner/:lib/-/exports/:date/:file", async (p) => {
    const { ref } = await openLibrary(p);
    requireOwner(ref.role, "download its exports");
    const date = p.c.req.param("date") ?? "";
    const file = p.c.req.param("file") ?? "";
    const types: Record<string, string> = {
      "bundle.tar": "application/x-tar",
      "ledger.jsonl": "application/x-ndjson",
      "manifest.json": "application/json",
    };
    const type = types[file];
    const obj =
      type && /^\d{4}-\d{2}-\d{2}(-pre-restore-\d{9}(-[0-9a-f]{4})?)?$/.test(date) && p.deps.exports
        ? await p.deps.exports.get(`exports/${ref.do_id}/${date}/${file}`)
        : null;
    if (!obj || !type) throw new OkfError(404, "not_found", "No such export.");
    return new Response(obj.body as BodyInit, {
      headers: {
        "Content-Type": type,
        "Content-Disposition": `attachment; filename="${ref.slug}-${date}-${file}"`,
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
      },
    });
  });

  // Changing the email (v2 spec: Accounts, A3): the link mailed to the new address lands here, a
  // server page like sign-in's, and a same-site post confirms it.
  // Opened signed out it does not send the person to sign-in blindly (V-3): it says which
  // account to sign in with first. Only looking: the link is used up by the post.
  app.get("/account/email/confirm", async (c) => {
    const d = deps(c.env);
    const t = c.req.query("t") ?? "";
    const secret = readCookie(c.req.raw, SESSION_COOKIE);
    const [link, user] = await Promise.all([
      t ? d.sessions.peekLink(t, "email-change") : null,
      secret ? d.sessions.user(secret) : null,
    ]);
    const url = new URL(c.req.url);
    return emailChangePage(t, link, user, url.pathname + url.search);
  });

  app.post(
    "/account/email/confirm",
    ui(deps, async (p) => {
      requireSameOrigin(p.c);
      const t = String((await p.c.req.formData()).get("t") ?? "");
      const link = await p.deps.sessions.consumeLink(t, "email-change", p.user.id);
      if (!link || link.user !== p.user.id) {
        return errorPage(
          400,
          "That link has expired, was already used, or is for another account.",
          ACCOUNT,
        );
      }
      const old = p.user.email;
      await p.deps.accounts.setEmail(p.user.id, link.email);
      // Tell the old address, so a takeover does not go unnoticed.
      await p.deps.mailer
        ?.send({
          to: old,
          subject: "Your Tempra email changed",
          text: `Your Tempra account now signs in with ${link.email}.\n`,
        })
        .catch((e) =>
          console.error(JSON.stringify({ mail_failed: "email change notice", error: String(e) })),
        );
      return p.c.redirect("/account?done=email", 303);
    }) as never,
  );

  // Directories and files at their own paths, after every fixed page (v2 spec: URLs): a trailing
  // slash is a directory. Registered last, so /{owner}/{lib}/-/... pages always win.
  get("/:owner/:lib/*", (p) => {
    if (p.c.req.path.endsWith("/")) return library(p);
    const prefix = `/${p.c.req.param("owner")}/${p.c.req.param("lib")}/`;
    return file(p, decodePath(p.c.req.path.slice(encodeURI(prefix).length)));
  });
}
