import { bytesToHex, randomBytes } from "@noble/hashes/utils.js";
import type { Role } from "./accounts";
import { sha256Hex } from "./okf/hash";
import { OkfError } from "./store/errors";

/** A bearer token bound to one actor and one library (spec: Auth, identity and actors). */
export interface TokenInfo {
  id: string;
  actor: string;
  scope: "read" | "write";
  prefix: string | null;
  mcp_tiers: string;
  /** `owner` is the owner's handle: the library's path is {owner}/{slug}. */
  library: { id: string; slug: string; do_id: string; owner: string };
  /** The users row id of the human who minted the token, when known. */
  created_by?: string | null;
  /**
   * The role of the person it acts for in this library (tempra-dev: v2/sharing). `scope` is
   * already capped by it: a `read` member's token is read-only, and may still comment.
   */
  role: Role;
  /**
   * The handle of the person it acts for, whose account its requests and writes count against
   * (tempra-dev: v2/sharing); the library's owner when absent.
   */
  person?: string;
}

export type Authenticate = (secret: string) => Promise<TokenInfo>;

/** Only a hash of each secret is stored. */
export const hashToken = (secret: string) => sha256Hex(secret);

export function newTokenSecret(): string {
  return `okf_${bytesToHex(randomBytes(24))}`;
}

interface TokenRow {
  id: string;
  actor: string;
  scope: string;
  prefix: string | null;
  mcp_tiers: string;
  expires: string | null;
  revoked: string | null;
  created_by: string | null;
  library_id: string;
  slug: string;
  do_id: string;
  owner: string | null;
  owner_id: string | null;
  member_role: "read" | "write" | null;
  person: string | null;
  suspended: string | null;
}

const CACHE_MS = 30_000;

/** Looks tokens up in D1 by hash, with a short per-isolate cache so revocation lands within 30s. */
export function d1Authenticate(
  db: D1Database,
  now = () => Date.now(),
  cacheMs = CACHE_MS,
): Authenticate {
  const cache = new Map<string, { row: TokenRow | null; at: number }>();
  return async (secret) => {
    const hash = hashToken(secret);
    let hit = cache.get(hash);
    if (!hit || now() - hit.at >= cacheMs) {
      const row = await db
        .prepare(
          `SELECT t.id, t.actor, t.scope, t.prefix, t.mcp_tiers, t.expires, t.revoked, t.created_by,
                  l.id AS library_id, l.slug, l.do_id, u.handle AS owner, l.owner AS owner_id,
                  m.role AS member_role, p.handle AS person, u.suspended
           FROM tokens t JOIN libraries l ON l.id = t.library
           LEFT JOIN users u ON u.id = l.owner
           LEFT JOIN library_members m ON m.library = l.id AND m.user = t.created_by
           LEFT JOIN users p ON p.id = t.created_by
           WHERE t.hash = ?`,
        )
        .bind(hash)
        .first<TokenRow>();
      hit = { row, at: now() };
      if (cache.size > 1000) cache.clear();
      cache.set(hash, hit);
    }
    const row = hit.row;
    if (!row) throw new OkfError(401, "bad_token", "Unknown bearer token.");
    if (row.revoked) throw new OkfError(401, "token_revoked", "This token has been revoked.");
    if (row.suspended) throw new OkfError(401, "suspended", "This account is suspended.");
    if (row.expires && Date.parse(row.expires) <= now()) {
      throw new OkfError(401, "token_expired", "This token has expired.");
    }
    // A token acts for the person who minted it: the owner (or, for tokens minted before
    // creators were recorded, the owner's), else a member, at most at their role now.
    const role: Role | null =
      row.created_by === null || row.created_by === row.owner_id ? "owner" : row.member_role;
    if (!role) {
      throw new OkfError(401, "no_access", "This token's creator no longer has its library.");
    }
    return {
      id: row.id,
      actor: row.actor,
      scope: row.scope === "write" && role !== "read" ? "write" : "read",
      role,
      prefix: row.prefix || null,
      mcp_tiers: row.mcp_tiers,
      library: { id: row.library_id, slug: row.slug, do_id: row.do_id, owner: row.owner ?? "" },
      created_by: row.created_by,
      ...(row.person ? { person: row.person } : {}),
    };
  };
}
