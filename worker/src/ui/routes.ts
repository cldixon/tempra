import type { Context, Hono } from "hono";
import type { LibraryRef, User } from "../accounts";
import type { Deps } from "../app";
import type { LibraryClient } from "../client";
import { isRouteName } from "../handles";
import { basename, dirname } from "../okf/paths";
import { fromThisSite } from "../origin";

import { signedIn } from "../signin";
import { OkfError } from "../store/errors";
import { authorizeLibrary } from "../tenancy";
import { esc, htmlResponse, layout } from "./layout";
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

function errorPage(user: User | null, status: number, message: string): Response {
  const title = status === 404 ? "Not found" : "Something went wrong";
  return htmlResponse(
    layout({
      title,
      user: user?.email ?? "",
      body: `<h1>${esc(title)}</h1><p>${esc(message)}</p><p><a href="/">Libraries</a></p>`,
    }),
    status,
  );
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
        return errorPage(user, e.status, e.message);
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
  if (rest === "grants" || rest.startsWith("grants/")) return `/apps${rest.slice(6)}`;
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
async function openLibrary(p: Page): Promise<{ urls: Urls; lib: LibraryClient; ref: LibraryRef }> {
  const owner = p.c.req.param("owner") ?? "";
  const slug = p.c.req.param("lib") ?? "";
  const ref = await authorizeLibrary(p.deps.accounts, { user: p.user }, owner, slug);
  const lib = await p.deps.libraryByDoId(ref.do_id);
  if (!lib) throw new OkfError(404, "no_library", `There is no library ${owner}/${slug}.`);
  return { urls: new Urls(ref.owner, ref.slug, atParam(p.c)), lib, ref };
}

function emailConfirmPage(t: string): string {
  return `<h1>Confirm your new email</h1>
<form method="post" action="/account/email/confirm">
<input type="hidden" name="t" value="${esc(t)}">
<p><button class="primary" type="submit">Confirm</button></p>
</form>`;
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
  const shell = (p: Page) => Promise.resolve(spaShell(p.c.req.raw));
  const library = async (p: Page) => {
    await openLibrary(p);
    return spaShell(p.c.req.raw);
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
    "/connect",
    "/tokens",
    "/account",
    "/apps",
    "/invitations",
    "/inbox",
  ]) {
    get(path, shell);
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
    return spaShell(p.c.req.raw);
  };
  get("/:owner/:lib/-/files/*", (p) => file(p, tail(p.c, "/-/files/")));
  for (const page of [
    "diff/*",
    "ledger",
    "revert/:request",
    "restore/*",
    "work",
    "transfer",
    "recovery",
    "connect",
    "delete",
    "members",
  ]) {
    get(`/:owner/:lib/-/${page}`, library);
  }

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

  // Export: a redirect to a signed download, like the API's and MCP's export links.
  get("/:owner/:lib/-/export", async (p) => {
    const { urls, lib, ref } = await openLibrary(p);
    const at = urls.at ?? (await lib.headSeq());
    const token = await lib.signDownload({ k: "export", at, name: urls.slug });
    return p.c.redirect(`/dl/${encodeURIComponent(ref.do_id)}/${token}`, 302);
  });

  // A nightly export's files, streamed from R2 (spec: Backups and recovery).
  get("/:owner/:lib/-/exports/:date/:file", async (p) => {
    const { ref } = await openLibrary(p);
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
  get("/account/email/confirm", async (p) =>
    htmlResponse(
      layout({
        title: "Confirm email",
        user: p.user.email,
        body: emailConfirmPage(p.c.req.query("t") ?? ""),
      }),
    ),
  );

  app.post(
    "/account/email/confirm",
    ui(deps, async (p) => {
      requireSameOrigin(p.c);
      const t = String((await p.c.req.formData()).get("t") ?? "");
      const link = await p.deps.sessions.consumeLink(t, "email-change", p.user.id);
      if (!link || link.user !== p.user.id) {
        throw new OkfError(400, "bad_link", "That link has expired or is not for this account.");
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
