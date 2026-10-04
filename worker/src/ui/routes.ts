import type { Context, Hono } from "hono";
import { checkNewToken, type LibraryRef, type User } from "../accounts";
import type { Deps } from "../app";
import { bundleFiles, type LibraryClient } from "../client";
import { isRouteName } from "../handles";
import { deleteAccount, deleteLibrary } from "../lifecycle";
import { basename, dirname } from "../okf/paths";
import { fromThisSite } from "../origin";
import { clearedSessionCookie, readCookie, SESSION_COOKIE, sessionId } from "../session";
import { sendLink, signedIn } from "../signin";
import { OkfError } from "../store/errors";
import { authorizeLibrary } from "../tenancy";
import { maybeGunzip, readTar } from "../util/tar";
import {
  type AgentWrite,
  accountConnectPage,
  accountPage,
  connectPage,
  deleteLibraryPage,
  emailConfirmPage,
  STARTER,
  welcomePage,
} from "./account";
import { esc, htmlResponse, layout } from "./layout";
import { spaShell } from "./spa";
import {
  type LedgerRequest,
  libNav,
  type NightlyExport,
  type RestoreRow,
  recoveryPage,
  restorePage,
  revertPage,
  type TokenForm,
  type TokenListRow,
  tokenCreatedPage,
  tokensPage,
  transferPage,
  Urls,
  type WorkItem,
  workPage,
} from "./views";

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

function intParam(c: C, name: string): number | undefined {
  const v = c.req.query(name);
  if (v === undefined || v === "") return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) {
    throw new OkfError(400, "bad_param", `\`${name}\` must be a sequence number.`);
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

/** A write from the UI: attributed to the signed-in human, with the note from the form. */
async function humanContext(p: Page) {
  const form = await p.c.req.formData();
  const note = String(form.get("note") ?? "").trim();
  return { actor: p.user.actor, request_id: crypto.randomUUID(), note: note || null };
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function errorPage(user: User | null, status: number, message: string): Response {
  const title = status === 404 ? "Not found" : "Something went wrong";
  return htmlResponse(
    layout({
      title,
      user: user?.email ?? "",
      body: `<h1>${esc(title)}</h1><p>${esc(message)}</p><p><a href="/">Back to libraries</a></p>`,
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

function show(p: Page, title: string, body: string): Response {
  return htmlResponse(layout({ title, user: p.user.email, body }));
}

/**
 * The built-in UI's reading pages (spec: Built-in UI): library list, directory and concept views,
 * attachments, raw sources, all for the signed-in owner and all accepting ?at=N.
 */
export function registerUiRoutes<E extends AppEnv>(
  app: Hono<E>,
  deps: (env: Cloudflare.Env) => Deps,
) {
  const get = (path: string, handler: (p: Page) => Promise<Response>) =>
    app.get(path, ui(deps, handler) as never);

  // Rebuilt pages are drawn by the app (TEMPRA-9): the server checks sign-in and, for a library's
  // pages, that the person may open it (404 otherwise), then answers with the app's shell.
  const spa = async (p: Page, library: boolean) => {
    if (library) await openLibrary(p);
    return spaShell(p.c.req.raw);
  };
  get("/", async (p) => {
    // First run: no libraries yet (v2 spec: Onboarding).
    if ((await p.deps.accounts.libraries(p.user.id)).length === 0) {
      return p.c.redirect("/welcome", 302);
    }
    return spa(p, false);
  });
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

  const directory = (p: Page) => spa(p, true);
  get("/:owner/:lib/", (p) => directory(p));
  get("/:owner/:lib/-/tree/*", (p) => directory(p));

  // A directory's index.md is the directory page itself.
  const file = async (p: Page, path: string) => {
    const { urls } = await openLibrary(p);
    if (basename(path) === "index.md") return p.c.redirect(urls.tree(dirname(path)));
    return spaShell(p.c.req.raw);
  };
  get("/:owner/:lib/-/files/*", (p) => file(p, tail(p.c, "/-/files/")));

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

  // ---------------------------------------------------------------- history and the ledger

  get("/:owner/:lib/-/diff/*", (p) => spa(p, true));

  get("/:owner/:lib/-/ledger", (p) => spa(p, true));

  // Revert a request (spec: The ledger): a confirmation page, then a same-origin POST.
  get("/:owner/:lib/-/revert/:request", async (p) => {
    const { urls, lib } = await openLibrary(p);
    const request = (await lib.request(p.c.req.param("request") ?? "")) as LedgerRequest;
    const content = request.events.filter((e) => e.op !== "verify" && e.op !== "move").slice(0, 20);
    const diffs = await Promise.all(
      content.map(async (e) => ({
        path: e.path,
        diff: (await lib.diff(e.path, { to: e.seq })).diff,
      })),
    );
    return show(
      p,
      `Revert · ${urls.slug}`,
      libNav(urls, "ledger") + revertPage({ urls, request, diffs, actor: p.user.actor }),
    );
  });

  const post = (path: string, handler: (p: Page) => Promise<Response>) =>
    app.post(
      path,
      ui(deps, async (p) => {
        requireSameOrigin(p.c);
        return handler(p);
      }) as never,
    );

  post("/:owner/:lib/-/revert/:request", async (p) => {
    const { urls, lib } = await openLibrary(p);
    const ctx = await humanContext(p);
    const res = await lib.revert(ctx, { request_id: p.c.req.param("request") ?? "" });
    return p.c.redirect(`${urls.ledger()}?done=revert&n=${res.results.length}`, 303);
  });

  // Restore one file to an earlier version: the same revert, for a path.
  get("/:owner/:lib/-/restore/*", async (p) => {
    const { urls, lib } = await openLibrary(p);
    const path = tail(p.c, "/-/restore/");
    const to = intParam(p.c, "to");
    if (to === undefined) throw new OkfError(400, "bad_param", "`to` is required.");
    const head = await lib.headSeq();
    const d = await lib.diff(path, { from: head, to });
    return show(
      p,
      `Restore ${d.path} · ${urls.slug}`,
      libNav(urls, "files") +
        restorePage({ urls, path: d.path, to, diff: d.diff, actor: p.user.actor }),
    );
  });

  post("/:owner/:lib/-/restore/*", async (p) => {
    const { urls, lib } = await openLibrary(p);
    const path = tail(p.c, "/-/restore/");
    const to = intParam(p.c, "to");
    if (to === undefined) throw new OkfError(400, "bad_param", "`to` is required.");
    const ctx = await humanContext(p);
    await lib.revert(ctx, { path, to_seq: to });
    return p.c.redirect(`${urls.pinned(undefined).file(path)}?done=restore`, 303);
  });

  // ---------------------------------------------------------------- slice 3: verify, work, transfer

  post("/new", async (p) => {
    const slug = String((await p.c.req.formData()).get("slug") ?? "");
    try {
      const lib = await p.deps.accounts.createLibrary(slug, p.user);
      return p.c.redirect(new Urls(lib.owner, lib.slug).tree(""), 303);
    } catch (e) {
      if (e instanceof OkfError && e.status < 500) {
        const body = `<h1>New library</h1><div class="notice">${esc(e.message)}</div><p><a href="/">Back to libraries</a></p>`;
        return htmlResponse(layout({ title: "New library", user: p.user.email, body }), 400);
      }
      throw e;
    }
  });

  // Human verification of the current version (spec: OKF conformance, What the service stamps).
  post("/:owner/:lib/-/verify/*", async (p) => {
    const { urls, lib } = await openLibrary(p);
    const path = tail(p.c, "/-/verify/");
    const res = await lib.verify(await humanContext(p), path);
    const verified = res.results[0]?.path ?? path;
    return p.c.redirect(`${urls.pinned(undefined).file(verified)}?done=verify`, 303);
  });

  get("/:owner/:lib/-/work", async (p) => {
    const { urls, lib } = await openLibrary(p);
    const kind = p.c.req.query("kind") || undefined;
    const res = await lib.work({ kind, limit: 200 });
    return show(
      p,
      `Work queue · ${urls.slug}`,
      libNav(urls, "work") +
        workPage({ urls, items: res.items as WorkItem[], total: res.total, kind }),
    );
  });

  const transfer = async (p: Page, status: number, extra: { result?: string; error?: string }) => {
    const { urls, lib, ref } = await openLibrary(p);
    const [head, exports] = await Promise.all([
      lib.headSeq(),
      p.deps.exports ? p.deps.exports.list(ref.do_id) : Promise.resolve([]),
    ]);
    const nightly: NightlyExport[] = exports.map((e) => ({
      date: e.folder.split("/").at(-2) ?? "",
      seq: typeof e.manifest?.seq === "number" ? e.manifest.seq : null,
      files: typeof e.manifest?.files === "number" ? e.manifest.files : null,
    }));
    const body = libNav(urls, "transfer") + transferPage({ urls, head, nightly, ...extra });
    return htmlResponse(
      layout({ title: `Import & export · ${urls.slug}`, user: p.user.email, body }),
      status,
    );
  };

  get("/:owner/:lib/-/transfer", (p) => transfer(p, 200, {}));

  post("/:owner/:lib/-/maintain", async (p) => {
    const { ref } = await openLibrary(p);
    if (!p.deps.maintain) throw new OkfError(501, "unavailable", "Maintenance is not wired here.");
    const res = (await p.deps.maintain(ref.do_id)) as { export: { key?: string } };
    return transfer(p, 200, {
      result: res.export.key
        ? `Exported to R2 at <code>${esc(res.export.key)}</code>.`
        : "Nothing changed since the last export, so none was written.",
    });
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

  // Point-in-time restore (spec: Backups and recovery).
  const recovery = async (
    p: Page,
    status: number,
    extra: { result?: string; error?: string; to?: string },
  ) => {
    const { urls, lib, ref } = await openLibrary(p);
    const [head, recent, restores] = await Promise.all([
      lib.headSeq(),
      lib.requests({ limit: 10 }),
      p.deps.recovery ? p.deps.recovery.list(ref.do_id) : Promise.resolve([]),
    ]);
    const rows: RestoreRow[] = restores.map((r) => ({
      ...r,
      export: r.export.split("/").at(-2) ?? "",
    }));
    const body =
      libNav(urls, "recovery") +
      recoveryPage({
        urls,
        head,
        recent: recent.requests as LedgerRequest[],
        restores: rows,
        ...extra,
      });
    return htmlResponse(
      layout({ title: `Recovery · ${urls.slug}`, user: p.user.email, body }),
      status,
    );
  };

  get("/:owner/:lib/-/recovery", (p) => recovery(p, 200, {}));

  post("/:owner/:lib/-/recovery", async (p) => {
    const { urls, ref } = await openLibrary(p);
    if (!p.deps.recovery) throw new OkfError(501, "unavailable", "Restore is not wired here.");
    const form = await p.c.req.formData();
    const undo = String(form.get("undo") ?? "");
    const rawTo = String(form.get("to") ?? "").trim();
    // datetime-local sends no offset (and no seconds when they are zero); the field is UTC.
    const to =
      rawTo && !/(Z|[+-]\d{2}:\d{2})$/.test(rawTo)
        ? `${rawTo}${/T\d{2}:\d{2}$/.test(rawTo) ? ":00" : ""}Z`
        : rawTo;
    if (String(form.get("confirm") ?? "").trim() !== urls.slug) {
      return recovery(p, 400, {
        to: rawTo,
        error: `Type the library's name, ${urls.slug}, to confirm.`,
      });
    }
    const outcome = await p.deps.recovery.restore(
      ref.do_id,
      undo ? { undo } : { to },
      p.user.actor,
    );
    if (!outcome.ok) return recovery(p, outcome.status, { to: rawTo, error: outcome.message });
    const r = outcome.record;
    return recovery(p, 200, {
      result:
        r.kind === "undo"
          ? `Undone: ${esc(urls.slug)} is back to how it was before that restore.`
          : `Restored ${esc(urls.slug)} to ${esc(r.to)}. What was there before is exported to R2 at <code>${esc(r.export)}</code>.`,
    });
  });

  // Export: a redirect to a signed download, like the API's and MCP's export links.
  get("/:owner/:lib/-/export", async (p) => {
    const { urls, lib, ref } = await openLibrary(p);
    const at = intParam(p.c, "at") ?? (await lib.headSeq());
    const token = await lib.signDownload({ k: "export", at, name: urls.slug });
    return p.c.redirect(`/dl/${encodeURIComponent(ref.do_id)}/${token}`, 302);
  });

  post("/:owner/:lib/-/import", async (p) => {
    const { lib } = await openLibrary(p);
    const form = await p.c.req.formData();
    const file = form.get("bundle");
    const strip = Number(form.get("strip") ?? 0) || 0;
    const note = String(form.get("note") ?? "").trim();
    if (!file || typeof file === "string") {
      return transfer(p, 400, { error: "Choose a .tar or .tar.gz file to import." });
    }
    let raw: { path: string; bytes: Uint8Array }[];
    try {
      raw = readTar(await maybeGunzip(new Uint8Array(await (file as Blob).arrayBuffer())));
    } catch {
      return transfer(p, 400, { error: "That file is not a readable tar or tar.gz archive." });
    }
    try {
      const files = await bundleFiles(p.deps.blobs, raw, strip);
      const name = (file as File).name || "upload";
      const ctx = {
        actor: p.user.actor,
        request_id: crypto.randomUUID(),
        note: note || `Import ${name}`,
      };
      const res = await lib.import(ctx, files, `upload:${name}`);
      const linted = res.warnings.length;
      return transfer(p, 200, {
        result: `Imported ${esc(plural(res.files, "file"))} from ${esc(name)} as one request (up to seq ${res.seq})${linted ? `; ${esc(plural(linted, "file"))} with lint, see the <a href="work">work queue</a>` : ""}. <a href="ledger">See it in the ledger</a>.`,
      });
    } catch (e) {
      if (e instanceof OkfError && e.status < 500)
        return transfer(p, e.status, { error: e.message });
      throw e;
    }
  });

  // ---------------------------------------------------------------- tokens (spec: Auth, identity and actors)

  const tokens = async (
    p: Page,
    opts: { form?: TokenForm; error?: string; notice?: string } = {},
  ) => {
    const [rows, libs] = await Promise.all([
      p.deps.accounts.tokens(p.user.id),
      p.deps.accounts.libraries(p.user.id),
    ]);
    const body = tokensPage({
      tokens: rows as TokenListRow[],
      libraries: libs.map((l) => l.slug),
      human: p.user.actor,
      form: opts.form ?? {
        library: p.c.req.query("library") ?? libs[0]?.slug ?? "",
        actor: "",
        scope: "write",
        prefix: "",
        expires: "",
        tiers: "all",
      },
      error: opts.error,
      notice: opts.notice,
    });
    return htmlResponse(
      layout({ title: "Tokens", user: p.user.email, body }),
      opts.error ? 400 : 200,
    );
  };

  get("/tokens", (p) =>
    tokens(p, { notice: p.c.req.query("done") === "revoke" ? "Token revoked." : undefined }),
  );

  post("/tokens", async (p) => {
    const f = await p.c.req.formData();
    const s = (k: string) => String(f.get(k) ?? "").trim();
    const form: TokenForm = {
      library: s("library"),
      actor: s("actor"),
      scope: s("scope") === "read" ? "read" : "write",
      prefix: s("prefix"),
      expires: s("expires"),
      tiers: s("tiers") === "files" ? "files" : "all",
    };
    try {
      const lib = (await p.deps.accounts.libraries(p.user.id)).find((l) => l.slug === form.library);
      if (!lib) throw new OkfError(400, "no_library", "Pick a library.");
      const fields = checkNewToken(
        {
          actor: form.actor,
          scope: form.scope,
          prefix: form.prefix,
          expires: form.expires,
          mcpTiers: form.tiers,
        },
        p.user.actor,
      );
      const minted = await p.deps.accounts.createToken({
        ...fields,
        libraryId: lib.id,
        createdBy: p.user.id,
      });
      const body = tokenCreatedPage({
        origin: new URL(p.c.req.url).origin,
        secret: minted.secret,
        actor: fields.actor,
        library: lib.slug,
      });
      return htmlResponse(layout({ title: "Token created", user: p.user.email, body }));
    } catch (e) {
      if (e instanceof OkfError && e.status < 500) return tokens(p, { form, error: e.message });
      throw e;
    }
  });

  post("/tokens/:id/revoke", async (p) => {
    await p.deps.accounts.revokeToken(p.c.req.param("id") ?? "", p.user.id);
    return p.c.redirect("/tokens?done=revoke", 303);
  });

  // ---------------------------------------------------------------- first run, connect, account (v2 A2)

  const welcome = (
    p: Page,
    form: { handle: string; library: string; starter: boolean },
    error?: OkfError,
  ) =>
    htmlResponse(
      layout({
        title: "Welcome",
        user: p.user.email,
        body: welcomePage({ ...form, error: error?.message }),
      }),
      error?.status ?? 200,
    );

  get("/welcome", async (p) =>
    welcome(p, { handle: p.user.handle, library: "notes", starter: true }),
  );

  post("/welcome", async (p) => {
    const f = await p.c.req.formData();
    const form = {
      handle: String(f.get("handle") ?? "").trim(),
      library: String(f.get("library") ?? "").trim(),
      starter: f.get("starter") === "1",
    };
    let user = p.user;
    try {
      if (form.handle.toLowerCase() !== user.handle) {
        user = await p.deps.accounts.setHandle(user.id, form.handle);
      }
      const ref = await p.deps.accounts.createLibrary(form.library, user);
      if (form.starter) {
        const lib = await p.deps.libraryByDoId(ref.do_id);
        await lib?.apply(
          { actor: user.actor, request_id: crypto.randomUUID(), note: "Starter note" },
          [{ op: "write", path: "start-here.md", content: STARTER }],
        );
      }
      return p.c.redirect(new Urls(ref.owner, ref.slug).connect(), 303);
    } catch (e) {
      if (e instanceof OkfError && e.status < 500) return welcome({ ...p, user }, form, e);
      throw e;
    }
  });

  get("/connect", async (p) => {
    const mcp = `${new URL(p.c.req.url).origin}/mcp`;
    return htmlResponse(
      layout({ title: "Connect an agent", user: p.user.email, body: accountConnectPage({ mcp }) }),
    );
  });

  get("/:owner/:lib/-/connect", async (p) => {
    const { urls, lib } = await openLibrary(p);
    // The newest change by an agent, not a person: "waiting for your agent" (v2 spec: Onboarding).
    const recent = (await lib.requests({ limit: 50 })).requests as LedgerRequest[];
    const agent = recent.find((r) => !r.actor.startsWith("human:"));
    const latest: AgentWrite | null = agent
      ? { actor: agent.actor, ts: agent.ts, note: agent.note }
      : null;
    const mcp = `${new URL(p.c.req.url).origin}/mcp`;
    return show(
      p,
      `Connect · ${urls.slug}`,
      libNav(urls, "connect") + connectPage({ urls, mcp, latest }),
    );
  });

  get("/:owner/:lib/-/delete", async (p) => {
    const { urls } = await openLibrary(p);
    return show(p, `Delete · ${urls.slug}`, libNav(urls, "delete") + deleteLibraryPage({ urls }));
  });

  post("/:owner/:lib/-/delete", async (p) => {
    const { urls, ref } = await openLibrary(p);
    const confirm = String((await p.c.req.formData()).get("confirm") ?? "").trim();
    if (confirm !== ref.slug) {
      const body =
        libNav(urls, "delete") + deleteLibraryPage({ urls, error: `Type ${ref.slug} to confirm.` });
      return htmlResponse(
        layout({ title: `Delete · ${urls.slug}`, user: p.user.email, body }),
        400,
      );
    }
    await deleteLibrary(p.deps, p.c.env.OAUTH_PROVIDER, p.user, ref);
    return p.c.redirect("/", 303);
  });

  const account = async (
    p: Page,
    status = 200,
    msg: { notice?: string; error?: string; devLink?: string } = {},
  ) => {
    const secret = readCookie(p.c.req.raw, SESSION_COOKIE);
    const [sessions, usage, limits] = await Promise.all([
      p.deps.sessions.list(p.user.id),
      p.deps.accounts.usage(p.user.id),
      p.deps.accounts.limits(p.user.id),
    ]);
    const body = accountPage({
      user: p.user,
      sessions,
      current: secret ? sessionId(secret) : null,
      usage,
      limits,
      ...msg,
    });
    return htmlResponse(layout({ title: "Account", user: p.user.email, body }), status);
  };

  get("/account", (p) => account(p));

  post("/account/handle", async (p) => {
    const handle = String((await p.c.req.formData()).get("handle") ?? "");
    try {
      const user = await p.deps.accounts.setHandle(p.user.id, handle);
      return account({ ...p, user }, 200, { notice: `Handle is now ${user.handle}.` });
    } catch (e) {
      if (e instanceof OkfError && e.status < 500)
        return account(p, e.status, { error: e.message });
      throw e;
    }
  });

  // Changing the email: a link to the new address confirms it (v2 spec: Accounts, A3).
  post("/account/email", async (p) => {
    const email = String((await p.c.req.formData()).get("email") ?? "")
      .trim()
      .toLowerCase();
    if (!/^[^\s@]+@[^\s@]+$/.test(email) || email.length > 254) {
      return account(p, 400, { error: "That does not look like an email address." });
    }
    if (email === p.user.email) return account(p, 400, { error: "That is your email already." });
    const ip = p.c.req.header("CF-Connecting-IP") ?? null;
    const secret = await p.deps.sessions.createLink(email, ip, { user: p.user.id });
    if (!secret) return account(p, 429, { error: "Too many links asked for. Try again later." });
    const link = `${new URL(p.c.req.url).origin}/account/email/confirm?t=${secret}`;
    const sent = await sendLink(p.c.req.raw, p.c.env, p.deps, {
      to: email,
      link,
      subject: "Confirm your new Tempra email",
      text: `Open this link to make this your Tempra sign-in email:\n\n${link}\n\nIt works once, within 15 minutes. If you did not ask for it, ignore this email.\n`,
    });
    if (sent === null) return account(p, 502, { error: "Could not send email. Try again later." });
    return account(p, 200, { notice: `Check ${email} for a link.`, devLink: sent || undefined });
  });

  get("/account/email/confirm", async (p) =>
    show(p, "Confirm email", emailConfirmPage(p.c.req.query("t") ?? "")),
  );

  post("/account/email/confirm", async (p) => {
    const t = String((await p.c.req.formData()).get("t") ?? "");
    const link = await p.deps.sessions.consumeLink(t, "email-change", p.user.id);
    if (!link || link.user !== p.user.id) {
      return account(p, 400, { error: "That link has expired or is not for this account." });
    }
    const old = p.user.email;
    try {
      await p.deps.accounts.setEmail(p.user.id, link.email);
    } catch (e) {
      if (e instanceof OkfError && e.status < 500)
        return account(p, e.status, { error: e.message });
      throw e;
    }
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
    return account({ ...p, user: { ...p.user, email: link.email } }, 200, {
      notice: `Your email is now ${link.email}.`,
    });
  });

  post("/account/sessions/end", async (p) => {
    const id = String((await p.c.req.formData()).get("id") ?? "");
    await p.deps.sessions.endById(p.user.id, id);
    return p.c.redirect("/account", 303);
  });

  post("/account/delete", async (p) => {
    const confirm = String((await p.c.req.formData()).get("confirm") ?? "").trim();
    if (confirm !== p.user.handle) {
      return account(p, 400, { error: `Type ${p.user.handle} to confirm.` });
    }
    await deleteAccount(p.deps, p.c.env.OAUTH_PROVIDER, p.user);
    return new Response(
      layout({ title: "Account deleted", user: "", body: "<h1>Account deleted</h1>" }),
      {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Set-Cookie": clearedSessionCookie,
          "Cache-Control": "no-store",
        },
      },
    );
  });

  // Directories and files at their own paths, after every fixed page (v2 spec: URLs): a trailing
  // slash is a directory. Registered last, so /{owner}/{lib}/-/... pages always win.
  get("/:owner/:lib/*", (p) => {
    if (p.c.req.path.endsWith("/")) return directory(p);
    const prefix = `/${p.c.req.param("owner")}/${p.c.req.param("lib")}/`;
    return file(p, decodePath(p.c.req.path.slice(encodeURI(prefix).length)));
  });
}
