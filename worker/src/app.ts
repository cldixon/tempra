import * as design from "@tempra/design";
import { type Doc, parseMarkdown } from "@tempra/editor/doc";
import { type Context, Hono } from "hono";
import { registerAccountApi } from "./account-api";
import { type Accounts, checkNewToken, humanActor, type MemberRole, type User } from "./accounts";
import { tokenAgent } from "./agents";
import type { Authenticate, TokenInfo } from "./auth";
import {
  type BlobStore,
  bundleFiles,
  bundleTar,
  type LibraryClient,
  mediaFor,
  putBlob,
} from "./client";
import { notificationsOf, registerInboxApi } from "./inbox-api";
import { registerLegalRoutes } from "./legal";
import { deleteLibrary } from "./lifecycle";
import { type Notifications, postComment } from "./notify";
import { messagePage } from "./oauth/pages";
import { type GrantProps, registerAppRoutes } from "./oauth/routes";
import { splitFrontmatter } from "./okf/concept";
import { normalizePath, underPrefix } from "./okf/paths";
import type { JsonObject } from "./okf/types";
import { fromThisSite } from "./origin";
import type { RestoreOutcome, RestoreRecord } from "./recovery";
import { readCookie, SESSION_COOKIE, type Sessions } from "./session";
import { type Mailer, registerSignInRoutes } from "./signin";
import { OkfError } from "./store/errors";
import type { ConceptContent, RequestContext, WriteOp, WriteResult } from "./store/store";
import {
  type AccountGrant,
  type Authorized,
  authorizeLibrary,
  createLibraryForGrant,
  requireOwner,
} from "./tenancy";
import { faviconResponse } from "./ui/favicon";
import { registerUiRoutes } from "./ui/routes";
import { appScript } from "./ui/spa";
import { STARTER } from "./ui/starter";
import { admit, admitSession, RETRY_AFTER_S, tokenAdmission, type UsageDeps } from "./usage";
import { maybeGunzip, readTar } from "./util/tar";
import { registerWaitlistRoutes } from "./waitlist";

/** What the app needs from the platform; production wires D1, the DO and R2, tests fakes. */
export interface Deps extends UsageDeps {
  authenticate: Authenticate;
  /** Users, libraries and tokens in D1, always scoped to one account. */
  accounts: Accounts;
  /** Magic links and browser sessions (v2 spec: Accounts and sign-in). */
  sessions: Sessions;
  /** Sends sign-in emails; without one, only local dev with DEV_SIGNIN=1 can sign in. */
  mailer?: Mailer | null;
  library(token: TokenInfo): LibraryClient;
  /** The library a signed download URL names, or null when no such library exists. */
  libraryByDoId(doId: string): Promise<LibraryClient | null>;
  blobs: BlobStore;
  /** Checks for /healthz: each dependency's name and "ok" or what failed. */
  health?: () => Promise<Record<string, string>>;
  /** Nightly exports in R2 (spec: Backups and recovery), for the UI. */
  exports?: ExportStore;
  /** Runs a library's daily maintainers now, by its Durable Object name. */
  maintain?: (doId: string) => Promise<unknown>;
  /** Point-in-time restore of a library, by its Durable Object name (spec: Backups and recovery). */
  recovery?: RecoveryDeps;
  /** Wipes a library's storage: its Durable Object, R2 exports and restore records (lifecycle.ts). */
  destroyLibrary?: (doId: string) => Promise<void>;
  /**
   * Hands a WebSocket upgrade to the library's Durable Object, which holds the change feed
   * (feed.ts); `prefix` limits it to a directory. `account` is whose cap on open sockets it
   * counts against (TEMPRA-80).
   */
  feed?: (
    doId: string,
    request: Request,
    opts: { prefix: string; account: string },
  ) => Promise<Response>;
  /** The inbox, read cursors and mail settings in D1 (notify.ts); absent, nobody is notified. */
  notifications?: Notifications | null;
}

export interface RecoveryDeps {
  /** Arms the restore and restarts the library into it; `undo` names an earlier restore. */
  restore(
    doId: string,
    target: { to: string } | { undo: string },
    actor: string,
  ): Promise<RestoreOutcome>;
  /** The library's restores, newest first. */
  list(doId: string): Promise<RestoreRecord[]>;
}

export interface ExportStore {
  /** A library's export folders, newest first, with their manifests. */
  list(libraryId: string): Promise<{ folder: string; manifest: Record<string, unknown> | null }[]>;
  get(key: string): Promise<{ body: ReadableStream | Uint8Array; size: number } | null>;
}

type Env = {
  Bindings: Cloudflare.Env;
  Variables: { token: TokenInfo; lib: LibraryClient; deps: Deps };
};
type C = Context<Env>;

/** A library's routes: {owner} is its owner's handle (v2 spec: Tenancy and authorization). */
const BASE = "/api/v1/libraries/:owner/:lib";

function tail(c: C, marker: string): string {
  const path = c.req.path;
  const i = path.indexOf(marker);
  const rest = i === -1 ? "" : path.slice(i + marker.length);
  return rest
    .split("/")
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    })
    .join("/");
}

function num(c: C, name: string): number | undefined {
  const v = c.req.query(name);
  if (v === undefined || v === "") return undefined;
  const n = Number(v);
  if (!Number.isInteger(n)) throw new OkfError(400, "bad_param", `\`${name}\` must be an integer.`);
  return n;
}

function bool(c: C, name: string): boolean | undefined {
  const v = c.req.query(name);
  if (v === undefined || v === "") return undefined;
  return v === "true" || v === "1";
}

/** How long the library list waits on one library's summary before listing it unavailable. */
export const SUMMARY_MS = 5000;

/** `run()`, refused after `ms`: one slow library never holds a list of them. */
async function within<T>(ms: number, run: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([run(), late]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** A catch that logs and answers `fallback`, for a part a page can do without. */
const logged =
  <T>(what: string, fallback: T) =>
  (e: unknown): T => {
    console.error(what, e);
    return fallback;
  };

function etag(header: string | undefined): string | null {
  if (!header) return null;
  return header.trim().replace(/^W\//, "").replace(/^"|"$/g, "") || null;
}

function requestContext(c: C, note?: unknown): RequestContext {
  const header = c.req.header("X-Note");
  return {
    actor: c.var.token.actor,
    request_id: crypto.randomUUID(),
    note: typeof note === "string" && note ? note : header ? decodeURIComponent(header) : null,
    by: actedBy(c.var.token),
  };
}

/** The person and agent behind a token, for the ledger (tempra-dev: agents act for a person). */
export function actedBy(t: TokenInfo): RequestContext["by"] {
  if (!t.created_by) return null;
  return t.agent ? { person: t.created_by, agent: t.agent } : { person: t.created_by };
}

/** Content writes: write, edit, move, delete, attach, revert, import, verify. */
function requireWrite(c: C, ...paths: string[]) {
  const t = c.var.token;
  if (t.scope !== "write") throw readOnly(t);
  underTokenPrefix(t, paths);
}

/**
 * Comments (tempra-dev: v2/sharing): a separate permission from writing content, which every
 * caller that reaches the library has, read included; a prefix still limits where.
 */
function requireComment(c: C, path: string) {
  underTokenPrefix(c.var.token, [path]);
}

function readOnly(t: TokenInfo): OkfError {
  return new OkfError(
    403,
    "read_only",
    t.role === "read"
      ? "You have read access to this library: you can read and comment, not change it."
      : "This token is read-only: it can read and comment, not change content.",
  );
}

function underTokenPrefix(t: TokenInfo, paths: string[]) {
  if (t.prefix === null) return;
  const prefix = t.prefix;
  for (const p of paths) {
    const n = normalizePath(p) ?? "";
    if (!underPrefix(n, prefix)) {
      throw new OkfError(403, "outside_prefix", `This token may only write under ${prefix}/.`);
    }
  }
}

async function json<T>(c: C): Promise<T> {
  try {
    return (await c.req.json()) as T;
  } catch {
    throw new OkfError(400, "bad_json", "The request body must be JSON.");
  }
}

function isMarkdownRequest(c: C, path: string): boolean {
  const type = (c.req.header("Content-Type") ?? "").toLowerCase();
  if (type.startsWith("application/json") || type.startsWith("text/markdown")) return true;
  if (path.endsWith(".md")) return true;
  return false;
}

/** A batch op as sent over the wire; attachments reference an uploaded blob by hash. */
type WireOp =
  | {
      op: "write";
      path: string;
      content: ConceptContent;
      if_match?: string;
      if_none_match?: boolean;
    }
  | { op: "edit"; path: string; edits: { old: string; new: string }[]; if_match?: string }
  | { op: "move"; path: string; to: string }
  | { op: "delete"; path: string; if_match?: string }
  | {
      op: "attach";
      path: string;
      blob: string;
      media?: string;
      if_match?: string;
      if_none_match?: boolean;
    };

export function createApp(deps: (env: Cloudflare.Env) => Deps) {
  const app = new Hono<Env>();

  app.onError((err, c) => {
    if (err instanceof OkfError) {
      // Over a per-minute limit: when to try again, for scripts and the app's quiet backoff.
      if (err.status === 429) c.header("Retry-After", String(RETRY_AFTER_S));
      if (err.status === 429 && !c.req.path.startsWith("/api/")) {
        const res = messagePage("Slow down", err.message, 429);
        res.headers.set("Retry-After", String(RETRY_AFTER_S));
        return res;
      }
      return c.json(err.toJSON(), err.status as 400);
    }
    console.error(err);
    return c.json({ error: "Internal error.", code: "internal" }, 500);
  });

  app.notFound((c) => c.json({ error: "No such route.", code: "no_route" }, 404));

  // Spec: Observability. Public, and says only which dependency failed.
  app.get("/healthz", async (c) => {
    const health = deps(c.env).health;
    const checks = health ? await health() : {};
    const ok = Object.values(checks).every((v) => v === "ok");
    return c.json({ ok, checks }, ok ? 200 : 503);
  });

  // The shared design stylesheet (@tempra/design, TEMPRA-8), at a content-hashed URL: a new
  // stylesheet gets a new URL, so the old one can be cached for good.
  app.get("/_design/:file", (c) => {
    if (c.req.param("file") !== `tempra.${design.hash}.css`) return c.notFound();
    return c.body(design.css, 200, {
      "Content-Type": "text/css; charset=utf-8",
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    });
  });

  // The app's client bundle (TEMPRA-9), at a content-hashed URL like the stylesheet.
  app.get("/_app/:file", (c) => appScript(c.req.param("file")) ?? c.notFound());

  // The tab's icon, linked from every page's head.
  app.get("/favicon.svg", () => faviconResponse());

  // Everything below (pages, the API, downloads, feed upgrades) counts against a browser
  // session's limit when it carries the session cookie and no bearer token (TEMPRA-80); the
  // static files above do not. A request with a token is limited per token instead.
  app.use("*", async (c, next) => {
    const secret =
      c.req.header("Authorization") === undefined ? readCookie(c.req.raw, SESSION_COOKIE) : null;
    if (secret) await admitSession(deps(c.env), secret);
    await next();
  });

  app.use(`${BASE}/*`, async (c, next) => {
    const d = deps(c.env);
    const who = await principal(c, d);
    const ref = await authorizeLibrary(d.accounts, who, c.req.param("owner"), c.req.param("lib"));
    const token = "token" in who ? who.token : sessionToken(who.user, ref);
    // A person signed in to the app is metered here but limited only per session (above), so
    // agents spending the account's write budget never lock its owner out of the UI.
    const write = c.req.method !== "GET" && c.req.method !== "HEAD";
    await admit(d, tokenAdmission(token), write, "token" in who);
    c.set("deps", d);
    c.set("token", token);
    c.set("lib", d.library(token));
    await next();
  });

  // ------------------------------------------------------------------ files

  app.get(`${BASE}/files/*`, async (c) => {
    const path = tail(c, "/files/");
    const view = await c.var.lib.read(path, { at: num(c, "at"), computed: bool(c, "computed") });
    c.header("X-Seq", String(view.seq));
    const wantsJson = (c.req.header("Accept") ?? "").includes("application/json");
    if (view.kind === "attachment" && wantsJson) {
      // A description, not the bytes: what the app shows on an attachment's page.
      const { kind, path, seq, hash, size, media } = view;
      c.header("ETag", `"${hash}"`);
      return c.json({ kind, path, seq, hash, size, media: media ?? null });
    }
    if (view.kind === "attachment") {
      c.header("ETag", `"${view.hash}"`);
      c.header("Content-Type", view.media ?? "application/octet-stream");
      c.header("Content-Length", String(view.size));
      c.header("Content-Disposition", `attachment; filename="${view.path.split("/").pop()}"`);
      c.header("Content-Security-Policy", "default-src 'none'; sandbox");
      c.header("X-Content-Type-Options", "nosniff");
      if (c.req.method === "HEAD") return c.body(null);
      const obj = await c.var.deps.blobs.get(view.hash);
      if (!obj) throw new OkfError(500, "blob_missing", `Bytes for ${view.path} are missing.`);
      return c.body(obj.body as ReadableStream);
    }
    if (view.kind === "derived") {
      if (wantsJson) {
        // The app draws it like a concept body: as a tree.
        const doc = parseMarkdown(splitFrontmatter(view.markdown).body);
        return c.json({ kind: view.kind, path: view.path, seq: view.seq, doc });
      }
      return c.body(view.markdown, 200, { "Content-Type": "text/markdown; charset=utf-8" });
    }
    c.header("ETag", `"${view.hash}"`);
    if (wantsJson) {
      const { markdown: _, ...rest } = view;
      return c.json(rest);
    }
    return c.body(view.markdown, 200, { "Content-Type": "text/markdown; charset=utf-8" });
  });

  app.put(`${BASE}/files/*`, async (c) => {
    const path = tail(c, "/files/");
    requireWrite(c, path);
    const ifMatch = etag(c.req.header("If-Match"));
    const ifNoneMatch = c.req.header("If-None-Match")?.trim() === "*";
    let op: WriteOp;
    const xblob = c.req.header("X-Blob");
    if (xblob) {
      const head = await c.var.deps.blobs.head(xblob);
      if (!head) throw new OkfError(400, "blob_missing", `No uploaded bytes for ${xblob}.`);
      op = {
        op: "attach",
        path,
        blob: { hash: xblob, size: head.size, media: mediaFor(path, c.req.header("Content-Type")) },
        if_match: ifMatch,
        if_none_match: ifNoneMatch,
      };
    } else if (isMarkdownRequest(c, path)) {
      const type = (c.req.header("Content-Type") ?? "").toLowerCase();
      const content: ConceptContent = type.startsWith("application/json")
        ? await json<{ frontmatter: JsonObject; doc: Doc }>(c)
        : await c.req.text();
      op = { op: "write", path, content, if_match: ifMatch, if_none_match: ifNoneMatch };
    } else {
      const bytes = new Uint8Array(await c.req.arrayBuffer());
      const blob = await putBlob(
        c.var.deps.blobs,
        bytes,
        mediaFor(path, c.req.header("Content-Type")),
      );
      op = { op: "attach", path, blob, if_match: ifMatch, if_none_match: ifNoneMatch };
    }
    const res = await c.var.lib.apply(requestContext(c), [op]);
    return writeResponse(c, res);
  });

  app.patch(`${BASE}/files/*`, async (c) => {
    const path = tail(c, "/files/");
    requireWrite(c, path);
    const body = await json<{ edits: { old: string; new: string }[]; note?: string }>(c);
    const res = await c.var.lib.apply(requestContext(c, body.note), [
      { op: "edit", path, edits: body.edits, if_match: etag(c.req.header("If-Match")) },
    ]);
    return writeResponse(c, res);
  });

  app.delete(`${BASE}/files/*`, async (c) => {
    const path = tail(c, "/files/");
    requireWrite(c, path);
    const res = await c.var.lib.apply(requestContext(c), [
      { op: "delete", path, if_match: etag(c.req.header("If-Match")) },
    ]);
    return writeResponse(c, res);
  });

  app.post(`${BASE}/files/*`, async (c) => {
    const path = tail(c, "/files/");
    if (!path.endsWith("/move"))
      throw new OkfError(404, "no_route", "POST /files/{path}/move only.");
    const from = path.slice(0, -"/move".length);
    const body = await json<{ to: string; note?: string }>(c);
    if (typeof body.to !== "string") throw new OkfError(400, "bad_move", "Send { to }.");
    requireWrite(c, from, body.to);
    const res = await c.var.lib.apply(requestContext(c, body.note), [
      { op: "move", path: from, to: body.to },
    ]);
    return writeResponse(c, res);
  });

  app.post(`${BASE}/batch`, async (c) => {
    const body = await json<{ ops: WireOp[]; note?: string }>(c);
    if (!Array.isArray(body.ops)) throw new OkfError(400, "bad_batch", "Send { ops: [...] }.");
    requireWrite(c, ...body.ops.flatMap((o) => (o.op === "move" ? [o.path, o.to] : [o.path])));
    const ops: WriteOp[] = [];
    for (const o of body.ops) {
      if (o.op === "attach") {
        const head = await c.var.deps.blobs.head(o.blob);
        if (!head) throw new OkfError(400, "blob_missing", `No uploaded bytes for ${o.blob}.`);
        ops.push({
          op: "attach",
          path: o.path,
          blob: { hash: o.blob, size: head.size, media: o.media ?? mediaFor(o.path) },
          if_match: o.if_match,
          if_none_match: o.if_none_match,
        });
      } else ops.push(o as WriteOp);
    }
    const res = await c.var.lib.apply(requestContext(c, body.note), ops);
    return c.json(res);
  });

  // ------------------------------------------------------------------ queries

  app.get(`${BASE}/tree`, async (c) =>
    c.json(
      await c.var.lib.tree({
        prefix: c.req.query("prefix"),
        depth: num(c, "depth"),
        at: num(c, "at"),
      }),
    ),
  );

  // The whole library's index in one small answer, for the app's file tree (TEMPRA-19): every
  // file's path, kind, title and sequence, no bodies or other frontmatter.
  app.get(`${BASE}/outline`, async (c) => c.json(await c.var.lib.outline({ at: num(c, "at") })));

  app.get(`${BASE}/concepts`, async (c) =>
    c.json(
      await c.var.lib.concepts({
        type: c.req.query("type"),
        tag: c.req.query("tag"),
        status: c.req.query("status"),
        trust: c.req.query("trust"),
        stale: bool(c, "stale"),
        prefix: c.req.query("prefix"),
        at: num(c, "at"),
        limit: num(c, "limit"),
        offset: num(c, "offset"),
      }),
    ),
  );

  app.get(`${BASE}/search`, async (c) =>
    c.json(
      await c.var.lib.search(c.req.query("q") ?? "", {
        prefix: c.req.query("prefix"),
        limit: num(c, "limit"),
      }),
    ),
  );

  app.get(`${BASE}/grep`, async (c) =>
    c.json(
      await c.var.lib.grep(c.req.query("pattern") ?? "", {
        regex: bool(c, "regex"),
        prefix: c.req.query("prefix"),
        limit: num(c, "limit"),
        at: num(c, "at"),
      }),
    ),
  );

  app.get(`${BASE}/links/*`, async (c) =>
    c.json(await c.var.lib.links(tail(c, "/links/"), { at: num(c, "at") })),
  );

  // ------------------------------------------------------------------ ledger

  app.get(`${BASE}/events`, async (c) =>
    c.json(
      await c.var.lib.events({
        since: num(c, "since"),
        prefix: c.req.query("prefix"),
        actor: c.req.query("actor"),
        limit: num(c, "limit"),
      }),
    ),
  );

  app.get(`${BASE}/requests`, async (c) =>
    c.json(
      await c.var.lib.requests({
        before: num(c, "before"),
        prefix: c.req.query("prefix"),
        actor: c.req.query("actor"),
        from: c.req.query("from"),
        to: c.req.query("to"),
        limit: num(c, "limit"),
      }),
    ),
  );

  app.get(`${BASE}/requests/:id`, async (c) => c.json(await c.var.lib.request(c.req.param("id"))));

  app.get(`${BASE}/history/*`, async (c) => c.json(await c.var.lib.history(tail(c, "/history/"))));

  app.post(`${BASE}/revert`, async (c) => {
    const body = await json<{ path?: string; to_seq?: number; request_id?: string; note?: string }>(
      c,
    );
    let target: { path: string; to_seq: number } | { request_id: string };
    if (typeof body.request_id === "string") {
      if (c.var.token.prefix !== null) {
        throw new OkfError(
          403,
          "outside_prefix",
          "Prefix-scoped tokens revert one path at a time.",
        );
      }
      requireWrite(c);
      target = { request_id: body.request_id };
    } else if (typeof body.path === "string" && Number.isInteger(body.to_seq)) {
      requireWrite(c, body.path);
      target = { path: body.path, to_seq: body.to_seq as number };
    } else {
      throw new OkfError(400, "bad_revert", "Send { path, to_seq } or { request_id }.");
    }
    return c.json(await c.var.lib.revert(requestContext(c, body.note), target));
  });

  // ------------------------------------------------------------------ import and export

  app.post(`${BASE}/import`, async (c) => {
    const strip = num(c, "strip") ?? 0;
    const type = (c.req.header("Content-Type") ?? "").toLowerCase();
    let raw: { path: string; bytes: Uint8Array }[];
    if (type.startsWith("multipart/form-data")) {
      raw = [];
      const form = await c.req.formData();
      for (const [name, value] of form.entries()) {
        if (typeof value === "string") continue;
        raw.push({ path: name, bytes: new Uint8Array(await (value as Blob).arrayBuffer()) });
      }
    } else {
      raw = readTar(await maybeGunzip(new Uint8Array(await c.req.arrayBuffer())));
    }
    const files = await bundleFiles(c.var.deps.blobs, raw, strip);
    requireWrite(c, ...files.map((f) => f.path));
    const source = c.req.query("source") ?? "upload";
    const res = await c.var.lib.import(requestContext(c), files, source);
    return c.json(res);
  });

  app.get(`${BASE}/export`, async (c) => {
    const format = c.req.query("format") ?? "tar";
    if (format !== "tar") throw new OkfError(400, "bad_format", "Only format=tar is supported.");
    return exportTar(c.var.lib, c.var.deps.blobs, num(c, "at"), c.var.token.library.slug);
  });

  // ------------------------------------------------------------------ tier 2 extras

  app.get(`${BASE}/sources/*`, async (c) =>
    c.json(await c.var.lib.sources(tail(c, "/sources/"), { at: num(c, "at") })),
  );

  app.get(`${BASE}/diff`, async (c) => {
    const path = c.req.query("path");
    if (!path) throw new OkfError(400, "bad_param", "Send `path`.");
    return c.json(await c.var.lib.diff(path, { from: num(c, "from"), to: num(c, "to") }));
  });

  app.get(`${BASE}/stats`, async (c) => c.json(await c.var.lib.stats()));

  // Who has worked in the library: people and each of their agents, from the ledger's records
  // of who acted (TEMPRA-75), named from D1. Agents act for their person ("Claude for @alice").
  app.get(`${BASE}/agents`, async (c) => {
    const rows = await c.var.lib.contributors();
    const accounts = c.var.deps.accounts;
    const agents = new Map(
      (await accounts.agents(rows.flatMap((r) => (r.agent ? [r.agent] : [])))).map((a) => [
        a.id,
        a,
      ]),
    );
    const handles = new Map<string, string | null>();
    for (const id of new Set(rows.map((r) => r.person))) {
      handles.set(id, (await accounts.account(id))?.handle ?? null);
    }
    return c.json({
      contributors: rows.map((r) => {
        const a = r.agent ? agents.get(r.agent) : undefined;
        return {
          person: handles.get(r.person) ?? null,
          agent: r.agent
            ? {
                id: r.agent,
                name: a?.name ?? null,
                platform: a?.platform ?? null,
                client: a?.client ?? null,
              }
            : null,
          actor: r.actor,
          requests: r.requests,
          first_seq: r.first_seq,
          last_seq: r.last_seq,
          last_ts: r.last_ts,
        };
      }),
    });
  });

  // The change feed (tempra-dev: app/live): a WebSocket on which the library's Durable Object
  // pushes every committed event. Authorized and counted once, here, when it opens; a session
  // must open it from this site's own pages. GET /events?since=N is the catch-up.
  app.get(`${BASE}/feed`, async (c) => {
    if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") {
      throw new OkfError(426, "upgrade_required", "Open the feed as a WebSocket.");
    }
    const token = c.var.token;
    if (token.id.startsWith("session:") && !fromThisSite(c.req.raw)) {
      throw new OkfError(403, "cross_origin", "Open the feed from this site's own pages.");
    }
    const feed = c.var.deps.feed;
    if (!feed) throw new OkfError(501, "unavailable", "The change feed is not wired here.");
    const account = token.person || token.library.owner || token.library.id;
    c.var.deps.meter?.({ kind: "feed", account, library: token.library.id });
    return feed(token.library.do_id, c.req.raw, { prefix: c.req.query("prefix") ?? "", account });
  });

  // Counts for the library's home page: concepts, attachments, types, open work.
  app.get(`${BASE}/summary`, async (c) => c.json(await c.var.lib.summary()));

  // The daily health summary (TEMPRA-66): open work by kind and the newest unverified changes.
  app.get(`${BASE}/health`, async (c) => c.json(await c.var.lib.health()));

  // Needs you (layout take 3): what only the person asking can do here (replies waiting on
  // them, concepts to verify, concepts going stale), with the agents' housekeeping counted.
  app.get(`${BASE}/needs`, async (c) => {
    const t = c.var.token;
    // The person behind the caller, and the human: actor they write with in person.
    const actor = t.actor.startsWith("human:") ? t.actor : t.person ? humanActor(t.person) : null;
    return c.json(
      await c.var.lib.needs(
        { person: t.created_by ?? null, actor },
        { offset: num(c, "offset"), limit: num(c, "limit") },
      ),
    );
  });

  // One folder for the app's folder view: its subfolders, its concepts' rows and counts.
  app.get(`${BASE}/folder`, async (c) => c.json(await c.var.lib.folder(c.req.query("dir") ?? "")));

  app.get(`${BASE}/work`, async (c) =>
    c.json(
      await c.var.lib.work({
        kind: c.req.query("kind"),
        limit: num(c, "limit"),
        path: c.req.query("path"),
      }),
    ),
  );

  app.post(`${BASE}/verify/*`, async (c) => {
    const path = tail(c, "/verify/");
    requireWrite(c, path);
    return c.json(await c.var.lib.verify(requestContext(c), path));
  });

  // ------------------------------------------------------------------ comments

  // Threads on concepts (tempra-dev: app/comments). Every post is one `comment` event.
  app.get(`${BASE}/comments`, async (c) =>
    c.json(
      await c.var.lib.comments({
        path: c.req.query("path"),
        status: c.req.query("status"),
        limit: num(c, "limit"),
        before: num(c, "before"),
      }),
    ),
  );

  app.post(`${BASE}/comments`, async (c) => {
    const body = await json<{
      path?: string;
      body?: string;
      anchor?: { quote?: string; from?: number } | null;
    }>(c);
    if (typeof body.path !== "string") {
      throw new OkfError(400, "bad_request", "Give the concept's `path`.");
    }
    requireComment(c, body.path);
    const anchor = body.anchor
      ? {
          quote: String(body.anchor.quote ?? ""),
          from: typeof body.anchor.from === "number" ? body.anchor.from : undefined,
        }
      : null;
    const res = await postComment(c.var.deps, c.var.token, c.var.lib, requestContext(c), {
      kind: "open",
      path: body.path,
      body: String(body.body ?? ""),
      anchor,
    });
    return c.json(res, 201);
  });

  app.get(`${BASE}/comments/:thread`, async (c) =>
    c.json(await c.var.lib.thread(c.req.param("thread"))),
  );

  /** Reply (`POST /comments/{thread}`), resolve or reopen, each with an optional body. */
  const act = (kind: "reply" | "resolve" | "reopen") => async (c: C) => {
    const id = c.req.param("thread") ?? "";
    const { path } = await c.var.lib.thread(id);
    requireComment(c, path);
    // The body is optional for resolve and reopen: no JSON at all is fine.
    const sent = (await c.req.text()).trim();
    let raw: { body?: unknown } = {};
    try {
      raw = sent ? JSON.parse(sent) : {};
    } catch {
      throw new OkfError(400, "bad_json", "The request body must be JSON.");
    }
    const text = typeof raw.body === "string" ? raw.body : "";
    return c.json(
      await postComment(c.var.deps, c.var.token, c.var.lib, requestContext(c), {
        kind,
        thread: id,
        body: text,
      }),
    );
  };
  app.post(`${BASE}/comments/:thread`, act("reply"));
  app.post(`${BASE}/comments/:thread/resolve`, act("resolve"));
  app.post(`${BASE}/comments/:thread/reopen`, act("reopen"));

  // ------------------------------------------------------------------ members and invitations

  // Sharing (tempra-dev: v2/sharing, TEMPRA-61): who is in the library, and invitations. People
  // only, from the app's pages; managing them is the owner's, leaving is any member's.
  const sessionOnly = (c: C, what: string) => {
    if (!c.var.token.id.startsWith("session:")) {
      throw new OkfError(403, "session_only", `${what} only from the app's pages.`);
    }
  };
  const memberRole = (v: unknown): MemberRole => {
    if (v !== "read" && v !== "write") {
      throw new OkfError(400, "bad_role", "A member's role is read or write.");
    }
    return v;
  };

  app.get(`${BASE}/members`, async (c) => {
    const ref = c.var.token.library;
    const accounts = c.var.deps.accounts;
    const owner = c.var.token.role === "owner";
    return c.json({
      owner: ref.owner,
      role: c.var.token.role,
      members: (await accounts.members(ref.id)).map(({ handle, role, created }) => ({
        handle,
        role,
        created,
      })),
      // Pending invitations are the owner's to see.
      ...(owner ? { invitations: await accounts.libraryInvitations(ref.id) } : {}),
    });
  });

  app.post(`${BASE}/invitations`, async (c) => {
    sessionOnly(c, "Invitations are sent");
    requireOwner(c.var.token.role, "invite people");
    const body = await json<{ to?: string; role?: string }>(c);
    const role = memberRole(body.role);
    const to = String(body.to ?? "").trim();
    if (!to) throw new OkfError(400, "bad_request", "Give a handle or an email address.");
    const accounts = c.var.deps.accounts;
    const ref = c.var.token.library;
    const byEmail = to.includes("@") && !to.startsWith("@");
    const invitee = await accounts.findAccount(byEmail ? { email: to } : { handle: to });
    if (!invitee) {
      // An email is never confirmed or denied as an account: the answer is the same either way.
      if (byEmail) return c.json({ sent: "if_account" }, 202);
      throw new OkfError(404, "no_account", `There is no Tempra account @${to.replace(/^@/, "")}.`);
    }
    const inviter = c.var.token.created_by ?? "";
    const { renewed } = await accounts.invite(ref.id, invitee.id, role, inviter);
    if (!renewed) {
      // The invitation mails at once, below; the inbox keeps it too (TEMPRA-72).
      await c.var.deps.notifications
        ?.add([
          {
            user: invitee.id,
            library: ref.id,
            kind: "invitation",
            place: `${ref.owner}/${ref.slug}`,
            actor: c.var.token.actor,
            by_user: inviter || null,
            excerpt: `${role === "write" ? "Read and write" : "Read and comment"} access`,
          },
        ])
        .catch((e) =>
          console.error(JSON.stringify({ notify_failed: "invitation", error: String(e) })),
        );
      const origin = new URL(c.req.url).origin;
      const who = c.var.token.actor.replace(/^human:/, "@");
      await c.var.deps.mailer
        ?.send({
          to: invitee.email,
          subject: `${who} invited you to ${ref.owner}/${ref.slug} on Tempra`,
          text: `${who} invited you to the library ${ref.owner}/${ref.slug} with ${role} access${role === "read" ? " (read and comment)" : ""}.\n\nAccept or decline: ${origin}/invitations\n\nThe invitation is open for 14 days. If you did not expect it, ignore this email.\n`,
        })
        .then(() => c.var.deps.meter?.({ kind: "email", account: invitee.handle }))
        .catch((e) =>
          console.error(JSON.stringify({ mail_failed: "invitation", error: String(e) })),
        );
    }
    return c.json(
      byEmail ? { sent: "if_account" } : { sent: "invited", handle: invitee.handle },
      202,
    );
  });

  app.delete(`${BASE}/invitations/:id`, async (c) => {
    sessionOnly(c, "Invitations are withdrawn");
    requireOwner(c.var.token.role, "withdraw invitations");
    const ok = await c.var.deps.accounts.revokeInvitation(
      c.req.param("id"),
      c.var.token.library.id,
    );
    if (!ok) throw new OkfError(404, "not_found", "No such pending invitation.");
    return c.body(null, 204);
  });

  /** Tells a member the owner changed their access (TEMPRA-72); never fails the change. */
  const accessChanged = async (c: C, user: string, excerpt: string) => {
    const ref = c.var.token.library;
    await c.var.deps.notifications
      ?.add([
        {
          user,
          library: ref.id,
          kind: "access",
          place: `${ref.owner}/${ref.slug}`,
          actor: c.var.token.actor,
          by_user: c.var.token.created_by ?? null,
          excerpt,
          mail: true,
        },
      ])
      .catch((e) => console.error(JSON.stringify({ notify_failed: "access", error: String(e) })));
  };

  /** A member by handle, for changing their role or removing them. */
  const memberNamed = async (c: C) => {
    const accounts = c.var.deps.accounts;
    const person = await accounts.findAccount({ handle: c.req.param("member") ?? "" });
    const role = person ? await accounts.memberRole(c.var.token.library.id, person.id) : null;
    if (!person || !role) throw new OkfError(404, "not_found", "No such member.");
    return person;
  };

  app.put(`${BASE}/members/:member`, async (c) => {
    sessionOnly(c, "Members are managed");
    requireOwner(c.var.token.role, "change members' access");
    const person = await memberNamed(c);
    const role = memberRole((await json<{ role?: string }>(c)).role);
    await c.var.deps.accounts.share(
      c.var.token.library.id,
      person.id,
      role,
      c.var.token.created_by ?? null,
    );
    await accessChanged(
      c,
      person.id,
      role === "write" ? "Now read and write" : "Now read and comment",
    );
    return c.json({ handle: person.handle, role });
  });

  // The owner removes a member; a member leaves.
  app.delete(`${BASE}/members/:member`, async (c) => {
    sessionOnly(c, "Members are removed");
    const person = await memberNamed(c);
    const leaving = person.id === c.var.token.created_by;
    if (!leaving) requireOwner(c.var.token.role, "remove members");
    await c.var.deps.accounts.unshare(c.var.token.library.id, person.id);
    if (!leaving) await accessChanged(c, person.id, "Removed from the library");
    return c.body(null, 204);
  });

  // ------------------------------------------------------------------ read state and tally

  // "Seen up to seq N" (TEMPRA-72): the person's cursor in this library, on the server so it
  // follows them across devices. It only moves forward.
  app.get(`${BASE}/seen`, async (c) => {
    sessionOnly(c, "Read state is kept");
    const n = notificationsOf(c.var.deps);
    const seen = await n.seen(c.var.token.created_by ?? "");
    return c.json({ seq: seen[c.var.token.library.id] ?? null });
  });

  app.put(`${BASE}/seen`, async (c) => {
    sessionOnly(c, "Read state is kept");
    const seq = (await json<{ seq?: unknown }>(c)).seq;
    if (typeof seq !== "number" || !Number.isInteger(seq) || seq < 0) {
      throw new OkfError(400, "bad_request", "Send { seq: <ledger sequence> }.");
    }
    const n = notificationsOf(c.var.deps);
    return c.json({
      seq: await n.setSeen(c.var.token.created_by ?? "", c.var.token.library.id, seq),
    });
  });

  // The library's tally for the person (TEMPRA-72): changes by others since they last looked,
  // and unread items for them here. One call to the library and one to D1.
  app.get(`${BASE}/tally`, async (c) => {
    sessionOnly(c, "The tally is read");
    const n = notificationsOf(c.var.deps);
    const user = c.var.token.created_by ?? "";
    const [seen, unread] = await Promise.all([n.seen(user), n.unread(user)]);
    const since = seen[c.var.token.library.id] ?? null;
    const activity = await c.var.lib.activity({ since: since ?? 0, person: user });
    return c.json({
      seen: since,
      head: activity.head,
      changes: since === null ? 0 : activity.changes,
      for_you: unread.libraries[c.var.token.library.id] ?? 0,
    });
  });

  // ------------------------------------------------------------------ signed downloads

  /** Short-lived download URLs for exports and attachments; the signature is the credential. */
  app.get("/dl/:lib/:token", async (c) => {
    const d = deps(c.env);
    const lib = await d.libraryByDoId(c.req.param("lib"));
    const bad = new OkfError(403, "bad_download", "This download link is invalid or has expired.");
    if (!lib) throw bad;
    const payload = await lib.openDownload(c.req.param("token"));
    if (payload.k === "export")
      return exportTar(lib, d.blobs, payload.at, payload.name ?? "library");
    const obj = await d.blobs.get(payload.hash);
    if (!obj) throw new OkfError(404, "not_found", "The file's bytes are missing.");
    return c.body(obj.body as ReadableStream, 200, {
      "Content-Type": payload.media ?? "application/octet-stream",
      "Content-Disposition": `attachment; filename="${payload.path.split("/").pop()}"`,
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "X-Content-Type-Options": "nosniff",
    });
  });

  // ------------------------------------------------------------------ libraries and tokens

  /**
   * Management routes are human-only (spec: HTTP API): the signed-in person's session, or a
   * human: bearer token acting for the person who minted it, on that person's own libraries and
   * tokens.
   */
  const human = async (c: C) => {
    const d = deps(c.env);
    const who = await principal(c, d);
    if ("user" in who) {
      return { d, user: { id: who.user.id, handle: who.user.handle }, session: who.user };
    }
    const token = who.token;
    if (!token.actor.startsWith("human:") || !token.created_by) {
      throw new OkfError(403, "human_only", "Library and token management needs a human: token.");
    }
    // The person who minted it, never the library's owner as such: on a shared library they
    // are different people (tempra-dev: v2/sharing).
    const account = await d.accounts.account(token.created_by);
    if (!account) throw new OkfError(401, "no_account", "This token's account no longer exists.");
    return { d, user: { id: account.id, handle: account.handle }, session: null };
  };

  // Who the caller acts as: the signed-in person, or the person a human: token acts for.
  app.get("/api/v1/me", async (c) => {
    const { d, user } = await human(c);
    const account = await d.accounts.account(user.id);
    if (!account) throw new OkfError(401, "no_account", "This account no longer exists.");
    return c.json({ email: account.email, handle: account.handle, actor: account.actor });
  });

  app.get("/api/v1/libraries", async (c) => {
    const { d, user } = await human(c);
    const refs = await d.accounts.reachable(user.id);
    // The tally (TEMPRA-72): unread items and cursors from D1 in one go; changes since the
    // cursor ride on the summary call each library already gets. Each part fails on its own
    // (TEMPRA-23): without them the list still names every library.
    const n = d.notifications;
    const [seen, unread] = await Promise.all([
      n
        ? n.seen(user.id).catch(logged("seen", {} as Record<string, number>))
        : ({} as Record<string, number>),
      n ? n.unread(user.id).catch(logged("unread", null)) : null,
    ]);
    const libraries = await Promise.all(
      refs.map(async ({ id, slug, owner, do_id, role }) => {
        const row = { id, owner, slug, role };
        const since = seen[id];
        let s: Awaited<ReturnType<LibraryClient["summary"]>>;
        try {
          s = await within(SUMMARY_MS, async () => {
            const lib = await d.libraryByDoId(do_id);
            if (!lib) throw new Error("no library object");
            return lib.summary(since === undefined ? undefined : { since, person: user.id });
          });
        } catch (e) {
          // One library that fails (an error, a restart, too slow) is listed as unavailable,
          // still linked so its pages, Delete among them, stay reachable.
          console.error("library summary", `${owner}/${slug}`, e);
          return { ...row, unavailable: true };
        }
        const forYou = unread ? (unread.libraries[id] ?? 0) : undefined;
        return {
          ...row,
          seq: s.seq,
          concepts: s.concepts,
          attachments: s.attachments,
          open_work: s.open_work,
          tally: {
            changes: s.activity?.changes ?? 0,
            ...(forYou === undefined ? {} : { for_you: forYou }),
          },
          health: s.health,
        };
      }),
    );
    return c.json({ libraries });
  });

  app.post("/api/v1/libraries", async (c) => {
    type Body = { slug?: string; starter?: boolean; title?: string; description?: string };
    // An app connection's OAuth access token (TEMPRA-100): the same rules as its agent's
    // create_library over MCP. Our own bearer tokens never contain a colon.
    const oauthToken = /^Bearer\s+([^\s:]+:[^\s:]+:[^\s:]+)$/i.exec(
      c.req.header("Authorization") ?? "",
    )?.[1];
    if (oauthToken) {
      const d = deps(c.env);
      const grant = await connectionGrant(c, oauthToken);
      const account = await d.accounts.account(grant.userId);
      if (!account) throw new OkfError(401, "suspended", "This account is suspended or deleted.");
      await admit(d, { key: `grant:${grant.id}|${grant.actor}`, account: account.handle }, true);
      const body = await c.req.json<Body>().catch(() => ({}) as Body);
      const made = await createLibraryForGrant(d.accounts, grant, {
        slug: body.slug ?? "",
        title: body.title,
        description: body.description,
      });
      const { id, owner, slug } = made.library;
      return c.json({ id, owner, slug, title: made.title, description: made.description }, 201);
    }
    const { d, user, session } = await human(c);
    const body = await c.req.json<Body>().catch(() => ({}) as Body);
    const lib = await d.accounts.createLibrary(body.slug ?? "", user, {
      title: body.title,
      description: body.description,
    });
    // First run (v2 spec: Onboarding): a person's first library may begin with a note.
    if (body.starter && session) {
      const client = await d.libraryByDoId(lib.do_id);
      await client?.apply(
        {
          actor: session.actor,
          request_id: crypto.randomUUID(),
          note: "Starter note",
          by: { person: session.id },
        },
        [{ op: "write", path: "start-here.md", content: STARTER }],
      );
    }
    return c.json(
      {
        id: lib.id,
        owner: lib.owner,
        slug: lib.slug,
        title: lib.title,
        description: lib.description,
      },
      201,
    );
  });

  registerAccountApi(app, deps, async (c, d) => {
    const who = await principal(c as C, d);
    if (!("user" in who)) throw new OkfError(403, "session_only", "Sign in to the app.");
    return who.user;
  });

  registerInboxApi(app, deps, async (c, d) => {
    const who = await principal(c as C, d);
    if (!("user" in who)) throw new OkfError(403, "session_only", "Sign in to the app.");
    return who.user;
  });

  // The signed-in person's pending invitations, and their answer (TEMPRA-61).
  const invitee = async (c: C) => {
    const d = deps(c.env);
    const who = await principal(c, d);
    if (!("user" in who)) throw new OkfError(403, "session_only", "Sign in to the app.");
    return { d, user: who.user };
  };

  app.get("/api/v1/invitations", async (c) => {
    const { d, user } = await invitee(c);
    return c.json({ invitations: await d.accounts.invitations(user.id) });
  });

  for (const answer of ["accept", "decline"] as const) {
    app.post(`/api/v1/invitations/:id/${answer}`, async (c) => {
      const { d, user } = await invitee(c);
      const done = await d.accounts.decideInvitation(
        c.req.param("id"),
        user.id,
        answer === "accept",
      );
      if (!done) throw new OkfError(404, "not_found", "No such open invitation for you.");
      await d.notifications
        ?.settle(user.id, "invitation", `${done.owner}/${done.slug}`)
        .catch((e) => console.error(JSON.stringify({ notify_failed: "settle", error: String(e) })));
      return c.json({ ...done, accepted: answer === "accept" });
    });
  }

  app.get("/api/v1/tokens", async (c) => {
    const { d, user } = await human(c);
    return c.json({ tokens: await d.accounts.tokens(user.id) });
  });

  app.post("/api/v1/tokens", async (c) => {
    const { d, user, session } = await human(c);
    const body = await c.req
      .json<{
        library?: string;
        actor?: string;
        scope?: string;
        prefix?: string | null;
        expires?: string | null;
        mcp_tiers?: string;
      }>()
      .catch(() => ({}) as Record<string, undefined>);
    // One of the person's own libraries by slug, or any they reach by id or owner/slug: a
    // member mints on a shared library for their own agents (tempra-dev: v2/sharing).
    const lib = (await d.accounts.reachable(user.id)).find(
      (l) =>
        l.id === body.library ||
        `${l.owner}/${l.slug}` === body.library ||
        (l.role === "owner" && l.slug === body.library),
    );
    if (!lib) throw new OkfError(404, "no_library", `There is no library ${body.library ?? ""}.`);
    // A person signed in to the app may mint a token as themselves (human:); a token may not.
    const fields = checkNewToken(
      {
        actor: body.actor ?? "",
        scope: body.scope ?? "",
        prefix: body.prefix,
        expires: body.expires,
        mcpTiers: body.mcp_tiers,
      },
      session ? session.actor : null,
    );
    if (lib.role === "read" && fields.scope === "write") {
      throw new OkfError(
        403,
        "read_only",
        `You have read access to ${lib.owner}/${lib.slug}: mint a read token (it may still comment).`,
      );
    }
    // A token for an agent names that agent (agents.ts): the person's agent for its app.
    if (!fields.actor.startsWith("human:")) {
      await d.accounts.recordAgent(user.id, tokenAgent(fields.actor));
    }
    const minted = await d.accounts.createToken({
      ...fields,
      libraryId: lib.id,
      createdBy: user.id,
    });
    const library = lib.role === "owner" ? lib.slug : `${lib.owner}/${lib.slug}`;
    return c.json({ id: minted.id, secret: minted.secret, library, ...fields }, 201);
  });

  app.delete("/api/v1/tokens/:id", async (c) => {
    const { d, user } = await human(c);
    await d.accounts.revokeToken(c.req.param("id"), user.id);
    return c.body(null, 204);
  });

  // Point-in-time restore (spec: Backups and recovery), as the UI's Recovery page.
  const recoveryFor = (c: C) => {
    const token = c.var.token;
    if (!token.actor.startsWith("human:")) {
      throw new OkfError(403, "human_only", "Point-in-time restore needs a human: token.");
    }
    const recovery = c.var.deps.recovery;
    requireOwner(token.role, "restore it");
    if (!recovery) throw new OkfError(501, "unavailable", "Restore is not wired here.");
    return { recovery, ref: token.library, token };
  };

  app.get(`${BASE}/restores`, async (c) => {
    const { recovery, ref } = recoveryFor(c);
    const restores = await recovery.list(ref.do_id);
    // Bookmarks stay server-side: undo goes by id.
    return c.json({
      restores: restores.map(({ bookmark: _b, undo_bookmark: _u, ...r }) => r),
    });
  });

  // Nightly exports and running the maintainers now (spec: Backups and recovery), as the app's
  // Import & export page. People only, like restore.
  const peopleOnly = (c: C) => {
    if (!c.var.token.actor.startsWith("human:")) {
      throw new OkfError(403, "human_only", "This needs a human: token, or the app.");
    }
    return c.var.token.library;
  };

  app.get(`${BASE}/exports`, async (c) => {
    const ref = peopleOnly(c);
    const list = c.var.deps.exports ? await c.var.deps.exports.list(ref.do_id) : [];
    return c.json({
      exports: list.map((e) => ({
        // YYYY-MM-DD, or YYYY-MM-DD-pre-restore-HHMMSSmmm-xxxx before a restore.
        date: e.folder.split("/").at(-2) ?? "",
        seq: typeof e.manifest?.seq === "number" ? e.manifest.seq : null,
        files: typeof e.manifest?.files === "number" ? e.manifest.files : null,
      })),
    });
  });

  app.post(`${BASE}/maintain`, async (c) => {
    const ref = peopleOnly(c);
    requireOwner(c.var.token.role, "run its maintainers");
    if (!c.var.deps.maintain)
      throw new OkfError(501, "unavailable", "Maintenance is not wired here.");
    const res = (await c.var.deps.maintain(ref.do_id)) as { export: { key?: string } };
    return c.json({ export: res.export.key ?? null });
  });

  // Deleting a library: only from the app's pages, typing its name (v2 spec: Accounts).
  app.post(`${BASE}/delete`, async (c) => {
    if (!c.var.token.id.startsWith("session:")) {
      throw new OkfError(403, "session_only", "A library is deleted only from the app's pages.");
    }
    requireOwner(c.var.token.role, "delete it");
    const ref = c.var.token.library;
    const body = await c.req.json<{ confirm?: string }>().catch(() => ({}) as { confirm?: string });
    if (String(body.confirm ?? "").trim() !== ref.slug) {
      throw new OkfError(400, "not_confirmed", `Type ${ref.slug} to confirm.`);
    }
    const user = await c.var.deps.accounts.account(c.var.token.created_by ?? "");
    if (!user) throw new OkfError(401, "no_account", "This account no longer exists.");
    await deleteLibrary(c.var.deps, c.env.OAUTH_PROVIDER, user, ref);
    return c.body(null, 204);
  });

  app.post(`${BASE}/restore`, async (c) => {
    const { recovery, ref, token } = recoveryFor(c);
    const body = await c.req
      .json<{ to?: string; undo?: string }>()
      .catch(() => ({}) as { to?: string; undo?: string });
    if (!body.to === !body.undo) {
      throw new OkfError(
        400,
        "bad_request",
        "Send { to: <ISO 8601 time> } or { undo: <restore id> }.",
      );
    }
    const outcome = await recovery.restore(
      ref.do_id,
      body.undo ? { undo: body.undo } : { to: body.to as string },
      token.actor,
    );
    if (!outcome.ok) throw new OkfError(outcome.status, outcome.code, outcome.message);
    const { bookmark: _b, undo_bookmark: _u, ...record } = outcome.record;
    return c.json(record, 201);
  });

  // ------------------------------------------------------------------ MCP

  // ------------------------------------------------------------------ apps (OAuth consent)

  // /mcp itself is served by the OAuth provider (worker.ts), which checks tokens first.
  registerLegalRoutes(app);
  registerSignInRoutes(app, deps);
  registerWaitlistRoutes(app, deps);
  registerAppRoutes(app, deps);
  registerUiRoutes(app, deps);

  return app;
}

/**
 * Who is calling a REST route: a bearer token when the request sends one, otherwise the
 * signed-in person's session (the app's own pages, TEMPRA-9). A session may change state only
 * from this site's pages: cookies are SameSite=Lax, and writes must also pass fromThisSite.
 */
async function principal(c: C, d: Deps): Promise<{ token: TokenInfo } | { user: User }> {
  if (c.req.header("Authorization") !== undefined)
    return { token: await d.authenticate(bearer(c)) };
  const secret = readCookie(c.req.raw, SESSION_COOKIE);
  const user = secret ? await d.sessions.user(secret) : null;
  if (!user) throw new OkfError(401, "no_token", "Send Authorization: Bearer <token>, or sign in.");
  if (c.req.method !== "GET" && c.req.method !== "HEAD" && !fromThisSite(c.req.raw)) {
    throw new OkfError(
      403,
      "cross_origin",
      "Changes must be submitted from this site's own pages.",
    );
  }
  return { user };
}

/**
 * The app connection behind an OAuth access token, checked as the provider checks one on /mcp:
 * live (not expired or revoked) and issued for this origin's MCP resource. Only connections
 * approved since account-level access carry a grant; anything else is refused.
 */
async function connectionGrant(c: C, token: string): Promise<AccountGrant> {
  const summary = await c.env.OAUTH_PROVIDER.unwrapToken<GrantProps>(token).catch(() => null);
  const resource = `${new URL(c.req.url).origin}/mcp`;
  if (!summary || summary.audience !== resource) {
    throw new OkfError(401, "invalid_token", "This access token is not valid here.");
  }
  const grant = summary.grant.props?.grant;
  if (grant && grant.userId !== summary.userId) {
    throw new OkfError(401, "invalid_token", "This access token is not valid here.");
  }
  if (!grant) {
    throw new OkfError(
      403,
      "create_not_allowed",
      "This connection reaches one library and cannot create libraries; reconnect the app.",
    );
  }
  return grant;
}

/**
 * The signed-in person acting on a library they may reach, as the token the routes act with:
 * attributed to their human: actor, with their role there (a `read` member reads and comments).
 */
function sessionToken(user: User, { role, ...library }: Authorized): TokenInfo {
  return {
    id: `session:${user.id}`,
    actor: user.actor,
    scope: role === "read" ? "read" : "write",
    prefix: null,
    mcp_tiers: "all",
    library,
    created_by: user.id,
    role,
    person: user.handle,
  };
}

function bearer(c: C): string {
  const m = /^Bearer\s+(\S+)$/i.exec(c.req.header("Authorization") ?? "");
  if (!m?.[1]) throw new OkfError(401, "no_token", "Send Authorization: Bearer <token>.");
  return m[1];
}

/** A conformant bundle as a tar, attachments read from blob storage. */
async function exportTar(
  lib: LibraryClient,
  blobs: BlobStore,
  at: number | undefined,
  name: string,
) {
  const bundle = await bundleTar(lib, blobs, at);
  return new Response(bundle.bytes as unknown as ArrayBuffer, {
    headers: {
      "Content-Type": "application/x-tar",
      "Content-Disposition": `attachment; filename="${name}-${bundle.seq}.tar"`,
      "X-Seq": String(bundle.seq),
    },
  });
}

function writeResponse(c: C, res: WriteResult) {
  const r = res.results[res.results.length - 1];
  if (!r) throw new OkfError(500, "internal", "Write returned no result.");
  if (r.hash) c.header("ETag", `"${r.hash}"`);
  c.header("X-Seq", String(r.seq));
  return c.json({
    path: r.path,
    hash: r.hash,
    seq: r.seq,
    request_id: res.request_id,
    lint: r.lint,
    ...(r.notices ? { notices: r.notices } : {}),
    ...(r.normalized ? { normalized: r.normalized } : {}),
    // A directory move: every file it moved.
    ...(res.results.length > 1
      ? {
          files: res.results.map((x) => ({ path: x.path, from: x.from, seq: x.seq, hash: x.hash })),
        }
      : {}),
  });
}
