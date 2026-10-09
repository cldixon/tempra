import { hashToken, newTokenSecret } from "./auth";
import { checkHandle, HANDLE_HOLD_DAYS, handleFromEmail } from "./handles";
import { type Limits, limitsFrom, overLimit } from "./limits";
import { sha256Hex } from "./okf/hash";
import { normalizeDir } from "./okf/paths";
import { OkfError } from "./store/errors";

/** A library, addressed as {owner}/{slug} (v2 spec: Tenancy and authorization). */
export interface LibraryRef {
  id: string;
  slug: string;
  do_id: string;
  /** The owner's handle. */
  owner: string;
}

/**
 * What a caller may do in a library (tempra-dev: v2/sharing): `read` reads and comments, `write`
 * also writes content and verifies, the owner also deletes, transfers, restores and shares.
 */
export type Role = "owner" | "write" | "read";
/** A member's role; the owner is `libraries.owner`, never a member. */
export type MemberRole = Exclude<Role, "owner">;

/** A library the account reaches, as its owner or as a member. */
export type ReachableLibrary = LibraryRef & { role: Role };

/** A member of a library, as its owner sees the list. */
export interface Member {
  user: string;
  handle: string;
  role: MemberRole;
  created: string;
}

export interface User {
  id: string;
  email: string;
  actor: string;
  handle: string;
}

/** A bearer token as the Tokens page lists it; the secret itself is never stored. */
export interface TokenRow {
  id: string;
  library: string;
  actor: string;
  scope: "read" | "write";
  prefix: string | null;
  expires: string | null;
  mcp_tiers: string;
  created_by: string | null;
  revoked: string | null;
}

export interface NewToken {
  libraryId: string;
  actor: string;
  scope: "read" | "write";
  prefix: string | null;
  expires: string | null;
  mcpTiers: "all" | "files";
  /** The users row id of the human who minted it. */
  createdBy: string | null;
}

/**
 * The account layer (v2 spec: Accounts, Tenancy). Every query that lists or changes libraries
 * or tokens is scoped to one user; nothing here returns another account's rows.
 */
export interface Accounts {
  /** The users row for a verified email, created (with a free handle) on first sign-in. */
  user(email: string): Promise<User>;
  /**
   * Whether this email may sign in under the deployment's SIGNUP mode (v2 spec: A4): an existing
   * account always may; open lets anyone in, invite only emails on the invite list.
   */
  mayJoin(email: string, mode: SignupMode): Promise<boolean>;
  /**
   * Records an email that asked to sign in without an invite. True when it is new and the
   * operator should be told: it takes one of the day's notices (WAITLIST_NOTICES_PER_DAY).
   */
  joinWaitlist(email: string, ip: string | null): Promise<boolean>;
  /** Emails waiting for the operator's decision, oldest first. */
  waitlist(): Promise<WaitlistEntry[]>;
  /**
   * Decides a waiting email: `invited` also puts it on the invite list. False when it is not
   * waiting (unknown, or decided already).
   */
  decideWaitlist(email: string, decision: "invited" | "dismissed"): Promise<boolean>;
  /** The account by its users row id; null when there is none or it is suspended. */
  account(userId: string): Promise<User | null>;
  /** The libraries the user owns, by name. */
  libraries(userId: string): Promise<LibraryRef[]>;
  /**
   * The libraries the user reaches: their own, then those shared with them, each with the
   * user's role (tempra-dev: v2/sharing). Owner-only screens and limits use `libraries`.
   */
  reachable(userId: string): Promise<ReachableLibrary[]>;
  /** The user's role as a member of a library; null when they are not one. */
  memberRole(libraryId: string, userId: string): Promise<MemberRole | null>;
  /** A library's members, by handle. */
  members(libraryId: string): Promise<Member[]>;
  /**
   * Makes a user a member of a library, or changes their role; 409 for the library's owner.
   * Invitations (TEMPRA-61) come later; until then the operator shares with `bun run admin`.
   */
  share(
    libraryId: string,
    userId: string,
    role: MemberRole,
    grantedBy: string | null,
  ): Promise<void>;
  /** Ends a membership; false when there was none. */
  unshare(libraryId: string, userId: string): Promise<boolean>;
  /** A library by its path, with its owner's users row id; null when there is none. */
  library(owner: string, slug: string): Promise<(LibraryRef & { ownerId: string }) | null>;
  createLibrary(slug: string, owner: Pick<User, "id" | "handle">): Promise<LibraryRef>;
  /** Tokens on the user's libraries, newest first, with the library's slug and the minter's email. */
  tokens(userId: string): Promise<TokenRow[]>;
  /** Stores a new token's hash; returns the secret, which is shown once and never again. */
  createToken(t: NewToken): Promise<{ id: string; secret: string }>;
  /** Revokes a token on one of the user's libraries; 404 for anything else. */
  revokeToken(id: string, userId: string): Promise<void>;
  /** The account's limits: defaults with its overrides. */
  limits(userId: string): Promise<Limits>;
  /** What the account uses against its limits. */
  usage(userId: string): Promise<{ libraries: number; tokens: number }>;
  /** Moves the account to a new, confirmed email address; 409 if another account has it. */
  setEmail(userId: string, email: string): Promise<void>;
  /**
   * Changes the user's handle and, for future writes, their human: actor; 409 if another account
   * has it or holds it. The old handle is held for this account (v2 spec: Handles). The operator
   * may assign a reserved handle (`reserved: "allow"`).
   */
  setHandle(userId: string, handle: string, opts?: { reserved?: "allow" }): Promise<User>;
  /** The current handle of the account that released `handle` within the hold, if any. */
  heldHandle(handle: string): Promise<string | null>;
  /** Removes a library's rows and its tokens. Its storage is wiped separately (lifecycle.ts). */
  deleteLibrary(libraryId: string): Promise<void>;
  /** Removes the user's rows (they own no libraries by now), keeps a tombstone, holds the handle. */
  deleteUser(user: Pick<User, "id" | "email" | "handle">): Promise<void>;
}

const AGENT_ACTOR = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/;
const PROCESS_ACTOR = /^process:[a-z0-9][a-z0-9._-]*$/;

/**
 * Checks a new token's fields (spec: Auth, identity and actors). The actor is `<app>/<label>`,
 * `process:<id>`, or `human:` only when `human` is the signed-in human's own actor.
 */
export function checkNewToken(
  input: {
    actor: string;
    scope: string;
    prefix?: string | null;
    expires?: string | null;
    mcpTiers?: string;
  },
  human: string | null,
): Omit<NewToken, "libraryId" | "createdBy"> {
  const actor = input.actor.trim().toLowerCase();
  if (actor.startsWith("human:")) {
    if (actor !== human) {
      throw new OkfError(
        403,
        "human_actor",
        human
          ? `A human: token can only carry your own actor, ${human}.`
          : "human: tokens are minted only in the web UI, by the signed-in human.",
      );
    }
  } else if (!AGENT_ACTOR.test(actor) && !PROCESS_ACTOR.test(actor)) {
    throw new OkfError(
      400,
      "bad_actor",
      "The actor must look like app/label (e.g. claude-code/laptop) or process:name (e.g. process:nightly-verify).",
    );
  }
  if (input.scope !== "read" && input.scope !== "write") {
    throw new OkfError(400, "bad_scope", "`scope` is read or write.");
  }
  const rawPrefix = (input.prefix ?? "").trim();
  if (rawPrefix.includes(".."))
    throw new OkfError(400, "bad_prefix", "The directory cannot contain '..'.");
  let expires: string | null = null;
  const e = (input.expires ?? "").trim();
  if (e) {
    // A date means the end of that day, UTC.
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(e) ? `${e}T23:59:59Z` : e;
    const t = Date.parse(iso);
    if (Number.isNaN(t) || !/(?:Z|[+-]\d\d:\d\d)$/.test(iso)) {
      throw new OkfError(
        400,
        "bad_expires",
        "`expires` is a date (2026-12-31) or an ISO 8601 datetime with an offset.",
      );
    }
    if (t <= Date.now()) throw new OkfError(400, "bad_expires", "`expires` is in the past.");
    expires = new Date(t).toISOString();
  }
  return {
    actor,
    scope: input.scope,
    prefix: normalizeDir(rawPrefix) || null,
    expires,
    mcpTiers: input.mcpTiers === "files" ? "files" : "all",
  };
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function checkSlug(slug: string): string {
  const s = slug.trim().toLowerCase();
  if (!SLUG.test(s)) {
    throw new OkfError(
      400,
      "bad_slug",
      "A library name uses lowercase letters, digits and hyphens, up to 63 characters.",
    );
  }
  return s;
}

export type SignupMode = "open" | "invite" | "closed";

export interface WaitlistEntry {
  email: string;
  created: string;
}

/** At most this many waitlist notices a day reach the operator; the digest counts the rest. */
export const WAITLIST_NOTICES_PER_DAY = 10;

/** The deployment's SIGNUP var; anything unknown counts as invite. */
export function signupMode(value: string | undefined): SignupMode {
  return value === "open" || value === "closed" ? value : "invite";
}

/** The ledger actor of a person: `human:<handle>` (spec: Auth, identity and actors). */
export const humanActor = (handle: string) => `human:${handle}`;

export { checkHandle } from "./handles";

/** The oldest release time a hold still counts from. */
const holdCutoff = () => new Date(Date.now() - HANDLE_HOLD_DAYS * 86_400_000).toISOString();

export function d1Accounts(db: D1Database): Accounts {
  const limitsOf = async (userId: string) => {
    const row = await db
      .prepare("SELECT limits FROM users WHERE id = ?")
      .bind(userId)
      .first<{ limits: string | null }>();
    return limitsFrom(row?.limits);
  };
  const byEmail = (email: string) =>
    db
      .prepare("SELECT id, email, actor, handle FROM users WHERE email = ?")
      .bind(email)
      .first<User>();
  return {
    async user(email) {
      const found = await byEmail(email);
      if (found) return found;
      const base = handleFromEmail(email);
      for (let n = 1; n <= 20; n++) {
        const handle = n === 1 ? base : `${base}-${n}`;
        const user = {
          id: `user_${crypto.randomUUID()}`,
          email,
          actor: humanActor(handle),
          handle,
        };
        // Ignored when the email (a concurrent sign-up) or the handle is taken or held.
        const r = await db
          .prepare(
            `INSERT OR IGNORE INTO users (id, email, actor, handle, created)
             SELECT ?1, ?2, ?3, ?4, ?5
             WHERE NOT EXISTS (SELECT 1 FROM handle_holds WHERE handle = ?4 AND released > ?6)`,
          )
          .bind(
            user.id,
            user.email,
            user.actor,
            user.handle,
            new Date().toISOString(),
            holdCutoff(),
          )
          .run();
        if (r.meta.changes) return user;
        const raced = await byEmail(email);
        if (raced) return raced;
      }
      throw new OkfError(500, "internal", "Could not find a free handle.");
    },
    async mayJoin(email, mode) {
      if (mode === "open" || (await byEmail(email))) return true;
      if (mode === "closed") return false;
      const invited = await db
        .prepare("SELECT 1 AS x FROM invites WHERE email = ?")
        .bind(email)
        .first();
      return invited !== null;
    },
    async joinWaitlist(email, ip) {
      const now = new Date();
      const added = await db
        .prepare("INSERT OR IGNORE INTO waitlist (email, created, ip) VALUES (?, ?, ?)")
        .bind(email, now.toISOString(), ip)
        .run();
      if (!added.meta.changes) return false;
      const dayAgo = new Date(now.getTime() - 86_400_000).toISOString();
      const claimed = await db
        .prepare(
          `UPDATE waitlist SET notified = ?1 WHERE email = ?2
             AND (SELECT COUNT(*) FROM waitlist WHERE notified > ?3) < ?4`,
        )
        .bind(now.toISOString(), email, dayAgo, WAITLIST_NOTICES_PER_DAY)
        .run();
      return claimed.meta.changes > 0;
    },
    async waitlist() {
      const r = await db
        .prepare(
          `SELECT email, created FROM waitlist w WHERE decision IS NULL
             AND NOT EXISTS (SELECT 1 FROM invites i WHERE i.email = w.email)
             AND NOT EXISTS (SELECT 1 FROM users u WHERE u.email = w.email)
           ORDER BY created`,
        )
        .all<WaitlistEntry>();
      return r.results;
    },
    async decideWaitlist(email, decision) {
      const now = new Date().toISOString();
      const decide = db
        .prepare(
          "UPDATE waitlist SET decision = ?, decided = ? WHERE email = ? AND decision IS NULL",
        )
        .bind(decision, now, email);
      const [r] = await db.batch(
        decision === "invited"
          ? [
              decide,
              db
                .prepare(
                  "INSERT OR IGNORE INTO invites (email, created) SELECT email, ? FROM waitlist WHERE email = ? AND decision = 'invited'",
                )
                .bind(now, email),
            ]
          : [decide],
      );
      return (r?.meta.changes ?? 0) > 0;
    },
    async account(userId) {
      return db
        .prepare("SELECT id, email, actor, handle FROM users WHERE id = ? AND suspended IS NULL")
        .bind(userId)
        .first<User>();
    },
    async libraries(userId) {
      const r = await db
        .prepare(
          `SELECT l.id, l.slug, l.do_id, u.handle AS owner
           FROM libraries l JOIN users u ON u.id = l.owner
           WHERE l.owner = ? ORDER BY l.slug`,
        )
        .bind(userId)
        .all<LibraryRef>();
      return r.results;
    },
    async reachable(userId) {
      const r = await db
        .prepare(
          `SELECT l.id, l.slug, l.do_id, u.handle AS owner, 'owner' AS role, 0 AS shared
           FROM libraries l JOIN users u ON u.id = l.owner WHERE l.owner = ?1
           UNION ALL
           SELECT l.id, l.slug, l.do_id, u.handle AS owner, m.role, 1 AS shared
           FROM library_members m JOIN libraries l ON l.id = m.library
           JOIN users u ON u.id = l.owner
           WHERE m.user = ?1 AND u.suspended IS NULL
           ORDER BY shared, owner, slug`,
        )
        .bind(userId)
        .all<ReachableLibrary & { shared: number }>();
      return r.results.map(({ shared: _, ...l }) => l);
    },
    async memberRole(libraryId, userId) {
      const row = await db
        .prepare("SELECT role FROM library_members WHERE library = ? AND user = ?")
        .bind(libraryId, userId)
        .first<{ role: MemberRole }>();
      return row?.role ?? null;
    },
    async members(libraryId) {
      const r = await db
        .prepare(
          `SELECT m.user, u.handle, m.role, m.created FROM library_members m
           JOIN users u ON u.id = m.user WHERE m.library = ? ORDER BY u.handle`,
        )
        .bind(libraryId)
        .all<Member>();
      return r.results;
    },
    async share(libraryId, userId, role, grantedBy) {
      if (role !== "read" && role !== "write") {
        throw new OkfError(400, "bad_role", "A member's role is read or write.");
      }
      const r = await db
        .prepare(
          `INSERT INTO library_members (library, user, role, granted_by, created)
           SELECT ?1, ?2, ?3, ?4, ?5
           WHERE EXISTS (SELECT 1 FROM libraries WHERE id = ?1 AND owner != ?2)
           ON CONFLICT (library, user) DO UPDATE SET role = excluded.role`,
        )
        .bind(libraryId, userId, role, grantedBy, new Date().toISOString())
        .run();
      if (!r.meta.changes) {
        throw new OkfError(409, "is_owner", "The library's owner cannot also be a member.");
      }
    },
    async unshare(libraryId, userId) {
      const r = await db
        .prepare("DELETE FROM library_members WHERE library = ? AND user = ?")
        .bind(libraryId, userId)
        .run();
      return r.meta.changes > 0;
    },
    async library(owner, slug) {
      return db
        .prepare(
          `SELECT l.id, l.slug, l.do_id, u.handle AS owner, u.id AS ownerId
           FROM libraries l JOIN users u ON u.id = l.owner
           WHERE u.handle = ? AND l.slug = ? AND u.suspended IS NULL`,
        )
        .bind(owner, slug)
        .first<LibraryRef & { ownerId: string }>();
    },
    async createLibrary(slugInput, owner) {
      const slug = checkSlug(slugInput);
      const { libraries: max } = await limitsOf(owner.id);
      const id = `lib_${crypto.randomUUID()}`;
      // The count is checked in the same statement, so two creates cannot both slip under it.
      const r = await db
        .prepare(
          `INSERT OR IGNORE INTO libraries (id, slug, owner, visibility, created, do_id)
           SELECT ?1, ?2, ?3, 'private', ?4, ?1
           WHERE (SELECT COUNT(*) FROM libraries WHERE owner = ?3) < ?5`,
        )
        .bind(id, slug, owner.id, new Date().toISOString(), max)
        .run();
      if (!r.meta.changes) {
        const exists = await db
          .prepare("SELECT 1 AS x FROM libraries WHERE owner = ? AND slug = ?")
          .bind(owner.id, slug)
          .first();
        if (exists) {
          throw new OkfError(409, "library_exists", `You already have a library named ${slug}.`);
        }
        throw overLimit("libraries", max);
      }
      return { id, slug, do_id: id, owner: owner.handle };
    },
    async tokens(userId) {
      const r = await db
        .prepare(
          `SELECT t.id, l.slug AS library, t.actor, t.scope, t.prefix, t.expires, t.mcp_tiers,
                  u.email AS created_by, t.revoked
           FROM tokens t JOIN libraries l ON l.id = t.library
           LEFT JOIN users u ON u.id = t.created_by
           WHERE l.owner = ?
           ORDER BY t.rowid DESC`,
        )
        .bind(userId)
        .all<TokenRow>();
      return r.results;
    },
    async createToken(t) {
      const id = `tok_${crypto.randomUUID()}`;
      const secret = newTokenSecret();
      const owner = await db
        .prepare("SELECT owner FROM libraries WHERE id = ?")
        .bind(t.libraryId)
        .first<{ owner: string }>();
      if (!owner) throw new OkfError(404, "no_library", "No such library.");
      const { tokens: max } = await limitsOf(owner.owner);
      const r = await db
        .prepare(
          `INSERT INTO tokens (id, hash, library, actor, scope, prefix, expires, mcp_tiers, created_by)
           SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9
           WHERE (SELECT COUNT(*) FROM tokens WHERE revoked IS NULL
                  AND (expires IS NULL OR expires > ?10)
                  AND library IN (SELECT id FROM libraries WHERE owner = ?11)) < ?12`,
        )
        .bind(
          id,
          hashToken(secret),
          t.libraryId,
          t.actor,
          t.scope,
          t.prefix,
          t.expires,
          t.mcpTiers,
          t.createdBy,
          new Date().toISOString(),
          owner.owner,
          max,
        )
        .run();
      if (!r.meta.changes) throw overLimit("active tokens", max);
      return { id, secret };
    },
    limits: limitsOf,
    async usage(userId) {
      const row = await db
        .prepare(
          `SELECT (SELECT COUNT(*) FROM libraries WHERE owner = ?1) AS libraries,
                  (SELECT COUNT(*) FROM tokens WHERE revoked IS NULL
                     AND (expires IS NULL OR expires > ?2)
                     AND library IN (SELECT id FROM libraries WHERE owner = ?1)) AS tokens`,
        )
        .bind(userId, new Date().toISOString())
        .first<{ libraries: number; tokens: number }>();
      return { libraries: row?.libraries ?? 0, tokens: row?.tokens ?? 0 };
    },
    async setEmail(userId, email) {
      const r = await db
        .prepare(
          `UPDATE users SET email = ?1 WHERE id = ?2
           AND NOT EXISTS (SELECT 1 FROM users WHERE email = ?1 AND id != ?2)`,
        )
        .bind(email, userId)
        .run();
      if (!r.meta.changes) {
        throw new OkfError(409, "email_taken", "Another account uses that email address.");
      }
    },
    async revokeToken(id, userId) {
      const r = await db
        .prepare(
          `UPDATE tokens SET revoked = ? WHERE id = ? AND revoked IS NULL
           AND library IN (SELECT id FROM libraries WHERE owner = ?)`,
        )
        .bind(new Date().toISOString(), id, userId)
        .run();
      if (!r.meta.changes) throw new OkfError(404, "not_found", "No such active token.");
    },
    async setHandle(userId, handleInput, opts = {}) {
      const handle = checkHandle(handleInput, opts);
      const byId = () =>
        db
          .prepare("SELECT id, email, actor, handle FROM users WHERE id = ?")
          .bind(userId)
          .first<User>();
      const before = await byId();
      if (!before) throw new OkfError(404, "not_found", "No such account.");
      if (before.handle === handle) return before;
      const now = new Date().toISOString();
      const [r] = await db.batch([
        db
          .prepare(
            `UPDATE users SET handle = ?1, actor = ?2 WHERE id = ?3
             AND NOT EXISTS (SELECT 1 FROM users WHERE handle = ?1 AND id != ?3)
             AND NOT EXISTS (SELECT 1 FROM handle_holds
                             WHERE handle = ?1 AND user != ?3 AND released > ?4)`,
          )
          .bind(handle, humanActor(handle), userId, holdCutoff()),
        // Only when the rename went through: the old handle is held, a reclaimed one released.
        db
          .prepare(
            `INSERT OR REPLACE INTO handle_holds (handle, user, released)
             SELECT ?1, ?2, ?3 WHERE EXISTS (SELECT 1 FROM users WHERE id = ?2 AND handle = ?4)`,
          )
          .bind(before.handle, userId, now, handle),
        db
          .prepare(
            "DELETE FROM handle_holds WHERE handle = ?1 AND EXISTS (SELECT 1 FROM users WHERE id = ?2 AND handle = ?1)",
          )
          .bind(handle, userId),
      ]);
      if (!r?.meta.changes)
        throw new OkfError(409, "handle_taken", `The handle ${handle} is taken.`);
      return (await byId()) ?? before;
    },
    async heldHandle(handle) {
      const row = await db
        .prepare(
          `SELECT u.handle FROM handle_holds h JOIN users u ON u.id = h.user
           WHERE h.handle = ? AND h.released > ? AND u.suspended IS NULL`,
        )
        .bind(handle, holdCutoff())
        .first<{ handle: string }>();
      return row?.handle ?? null;
    },
    async deleteLibrary(libraryId) {
      await db.batch([
        db.prepare("DELETE FROM tokens WHERE library = ?").bind(libraryId),
        db.prepare("DELETE FROM library_members WHERE library = ?").bind(libraryId),
        db.prepare("DELETE FROM libraries WHERE id = ?").bind(libraryId),
      ]);
    },
    async deleteUser(user) {
      await db.batch([
        db.prepare("DELETE FROM sessions WHERE user = ?").bind(user.id),
        db.prepare("DELETE FROM sign_in_links WHERE email = ?").bind(user.email),
        // Tokens left now are on others' libraries (theirs went with their libraries): a token
        // with no creator would act for the owner, so these are revoked first.
        db
          .prepare("UPDATE tokens SET revoked = ? WHERE created_by = ? AND revoked IS NULL")
          .bind(new Date().toISOString(), user.id),
        db.prepare("UPDATE tokens SET created_by = NULL WHERE created_by = ?").bind(user.id),
        db.prepare("DELETE FROM library_members WHERE user = ?").bind(user.id),
        db.prepare("DELETE FROM users WHERE id = ?").bind(user.id),
        db
          .prepare("INSERT OR REPLACE INTO handle_holds (handle, user, released) VALUES (?, ?, ?)")
          .bind(user.handle, user.id, new Date().toISOString()),
        db
          .prepare("INSERT INTO deleted_accounts (email_hash, deleted) VALUES (?, ?)")
          .bind(sha256Hex(user.email), new Date().toISOString()),
      ]);
    },
  };
}
