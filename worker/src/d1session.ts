import { AsyncLocalStorage } from "node:async_hooks";
import { readCookie } from "./session";

/**
 * D1 read replication through the Sessions API (TEMPRA-85, tempra-dev `v2/read-replication.md`).
 *
 * Each request runs its D1 queries in one session, opened by `withD1Session` and held in an
 * AsyncLocalStorage, so every handle `routedDb` builds (the isolate-wide ones too: token lookups,
 * the quotas) reads through it. Outside a request (crons, queues, the Library DO) queries go to the
 * binding as before. Browsers' reads start at the bookmark their last write left in a cookie, or at
 * any copy; writes and requests with `Authorization` start at the primary. Correct with
 * replication on or off: without replicas every query reaches the primary anyway.
 */

/** The browser's last write's bookmark: no secret, only a point in the database's history. */
export const BOOKMARK_COOKIE = "__Host-tempra_d1";
const BOOKMARK_MAX_AGE = 86_400;
/** D1's bookmarks are hex groups joined by dashes (`0000007b-0000b26e-00001538-0c3e…`). */
const BOOKMARK = /^[0-9a-f]{1,64}(?:-[0-9a-f]{1,64}){1,7}$/i;

type Session = Pick<D1DatabaseSession, "prepare" | "batch" | "getBookmark">;
/** What withSession takes: a bookmark or one of D1's two constraints. */
export type SessionStart = string;

const current = new AsyncLocalStorage<Session>();

const reads = (request: Request) => request.method === "GET" || request.method === "HEAD";

/** A bookmark-shaped cookie value, or null. */
export function cookieBookmark(request: Request): string | null {
  const b = readCookie(request, BOOKMARK_COOKIE);
  return b && b.length <= 256 && BOOKMARK.test(b) ? b : null;
}

/**
 * Where a request's session starts: the primary for writes and for tokens and apps (no bookmark to
 * carry, and what auth reads is cached), a browser's read at its bookmark or anywhere.
 */
export function sessionStart(request: Request): SessionStart {
  if (!reads(request) || request.headers.has("Authorization")) return "first-primary";
  return cookieBookmark(request) ?? "first-unconstrained";
}

/** The Set-Cookie that carries a bookmark to the browser's next requests. */
export function bookmarkCookie(bookmark: string): string {
  return `${BOOKMARK_COOKIE}=${bookmark}; Path=/; Max-Age=${BOOKMARK_MAX_AGE}; HttpOnly; Secure; SameSite=Lax`;
}

/**
 * The response with the session's bookmark for the browser, after a browser's write only (reads
 * finishing out of order would overwrite a newer write's bookmark), and only when it is newer than
 * the one the request brought (bookmarks sort as strings, oldest first).
 */
export function carryBookmark(
  request: Request,
  response: Response,
  bookmark: string | null,
): Response {
  if (reads(request) || request.method === "OPTIONS") return response;
  if (request.headers.has("Authorization") || !bookmark) return response;
  const had = cookieBookmark(request);
  if (had && had >= bookmark) return response;
  const cookie = bookmarkCookie(bookmark);
  try {
    response.headers.append("Set-Cookie", cookie);
    return response;
  } catch {
    // Immutable headers (a fetched or redirect response): copy it.
    const copy = new Response(response.body, response);
    copy.headers.append("Set-Cookie", cookie);
    return copy;
  }
}

/** Runs one request in a D1 session on `db` and hands its bookmark to the browser. */
export async function withD1Session(
  db: Pick<D1Database, "withSession">,
  request: Request,
  handle: () => Promise<Response>,
): Promise<Response> {
  if (typeof db.withSession !== "function") return handle();
  const session = db.withSession(sessionStart(request));
  const response = await current.run(session, handle);
  return carryBookmark(request, response, session.getBookmark());
}

/**
 * A D1 handle that runs each query in the current request's session, or on `db` itself outside
 * one. `exec`, `dump` and `withSession` stay the binding's.
 */
export function routedDb(db: D1Database): D1Database {
  const target = () => current.getStore() ?? db;
  const routed: Pick<D1Database, "prepare" | "batch" | "exec" | "withSession" | "dump"> = {
    prepare: (query) => target().prepare(query),
    batch: <T = unknown>(statements: D1PreparedStatement[]) => target().batch<T>(statements),
    exec: (query) => db.exec(query),
    withSession: (start) => db.withSession(start),
    dump: () => db.dump(),
  };
  return routed as D1Database;
}
