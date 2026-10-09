import type { Accounts, LibraryRef, Role, User } from "./accounts";
import { agentId, type ClientSignals, connectionAgent } from "./agents";
import type { TokenInfo } from "./auth";
import { OkfError } from "./store/errors";

/**
 * The one place that decides whether a caller may reach a library (v2 spec: Tenancy and
 * authorization). Routes resolve {owner}/{slug} through here and never compare IDs themselves.
 * A library the caller cannot reach is answered exactly like one that does not exist: 404.
 *
 * A signed-in person reaches the libraries they own and those shared with them, with their role
 * (tempra-dev: v2/sharing); a token reaches its own library, at its creator's role; an app
 * connection reaches the libraries its grant selects (grantLibraries).
 */
export type Caller = { user: User } | { token: TokenInfo };

/** A library the caller may reach, with what they may do there. */
export type Authorized = LibraryRef & { role: Role };

export function noLibrary(owner: string, slug: string): OkfError {
  return new OkfError(404, "no_library", `There is no library ${owner}/${slug}.`);
}

export async function authorizeLibrary(
  accounts: Accounts,
  caller: Caller,
  owner: string,
  slug: string,
): Promise<Authorized> {
  if ("token" in caller) {
    const { library: lib, role } = caller.token;
    if (lib.owner && lib.owner === owner && lib.slug === slug) return { ...lib, role };
    throw noLibrary(owner, slug);
  }
  const found = await accounts.library(owner, slug);
  if (!found) throw noLibrary(owner, slug);
  const ref = { id: found.id, slug: found.slug, do_id: found.do_id, owner: found.owner };
  if (found.ownerId === caller.user.id) return { ...ref, role: "owner" };
  const role = await accounts.memberRole(found.id, caller.user.id);
  if (!role) throw noLibrary(owner, slug);
  return { ...ref, role };
}

/** Refuses anything but the library's owner (or a token acting for them). */
export function requireOwner(role: Role, what: string): void {
  if (role !== "owner") {
    throw new OkfError(403, "owner_only", `Only the library's owner can ${what}.`);
  }
}

/**
 * An app connection approved at /authorize: it belongs to the account, like a GitHub App
 * installation, and covers all of the account's libraries (including later ones) or a
 * selection of them by id. The libraries are resolved on every request, so new, deleted and
 * transferred libraries and a suspension take effect at once.
 */
export interface AccountGrant {
  /** Random per grant: the rate-limit key. */
  id: string;
  userId: string;
  actor: string;
  scope: "read" | "write";
  /** Writes stay under this directory, in every library. */
  prefix: string | null;
  tiers: "all" | "files";
  libraries: "all" | string[];
  /** What the app said about itself at consent (agents.ts); absent on older connections. */
  client?: ClientSignals;
}

/**
 * The libraries a connection reaches now, each as the token it acts with there; null when the
 * account is gone or suspended. "All libraries" means the account's own; a library shared with
 * it is reached only when the grant selects it, at the lower of the grant's scope and the
 * person's role now, so lowering or ending a membership applies on the next request
 * (tempra-dev: v2/sharing).
 */
export async function grantLibraries(
  accounts: Accounts,
  grant: AccountGrant,
): Promise<{ user: User; libraries: TokenInfo[] } | null> {
  const user = await accounts.account(grant.userId);
  if (!user) return null;
  const selected = grant.libraries === "all" ? null : new Set(grant.libraries);
  const agent = agentId(user.id, connectionAgent(grant.client ?? {}).platform);
  const libraries = (await accounts.reachable(user.id))
    .filter((l) => (selected ? selected.has(l.id) : l.role === "owner"))
    .map(
      ({ role, ...l }): TokenInfo => ({
        id: `grant:${grant.id}`,
        actor: grant.actor,
        scope: role === "read" ? "read" : grant.scope,
        prefix: grant.prefix,
        mcp_tiers: grant.tiers,
        library: { id: l.id, slug: l.slug, do_id: l.do_id, owner: l.owner },
        created_by: user.id,
        role,
        person: user.handle,
        agent,
      }),
    );
  return { user, libraries };
}
