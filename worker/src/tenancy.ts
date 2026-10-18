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
  /**
   * "Create libraries", chosen at consent (TEMPRA-100): the connection may create libraries
   * owned by its person. Absent on connections approved before the choice existed, which
   * therefore cannot (tempra-dev: decisions/create-libraries-least-privilege).
   */
  create?: boolean;
}

/** The token a connection acts with in one library it reaches. */
function grantToken(
  grant: AccountGrant,
  user: User,
  l: LibraryRef,
  role: Role,
  agent: string,
): TokenInfo {
  return {
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
  };
}

/** The agent a connection acts as: its person's agent on its platform (agents.ts). */
export function grantAgent(grant: AccountGrant, userId: string): string {
  return agentId(userId, connectionAgent(grant.client ?? {}).platform);
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
  // A selected connection also reaches what it created since consent (grant_libraries), read
  // by its own grant id and person, so it can never pick up another connection's libraries.
  const selected =
    grant.libraries === "all"
      ? null
      : new Set([...grant.libraries, ...(await accounts.grantLibraries(grant.id, user.id))]);
  const agent = grantAgent(grant, user.id);
  const libraries = (await accounts.reachable(user.id))
    .filter((l) => (selected ? selected.has(l.id) : l.role === "owner"))
    .map(({ role, ...l }) => grantToken(grant, user, l, role, agent));
  return { user, libraries };
}

/**
 * Why a connection may not create a library, or null when it may (TEMPRA-100, tempra-dev:
 * v2/sharing): only a read-and-write connection with all tools that was granted "Create
 * libraries" at consent. Least privilege: connections approved before the choice existed, and
 * file-tools-only ones, cannot.
 */
export function cannotCreate(grant: AccountGrant): string | null {
  if (grant.scope !== "write") {
    return "This connection has read access; it cannot create libraries.";
  }
  if (grant.tiers !== "all") {
    return "This connection has file tools only; it cannot create libraries.";
  }
  if (grant.create !== true) {
    return "This connection was not allowed to create libraries. Ask the person to reconnect this app and keep Create libraries chosen, or to create the library in the app.";
  }
  return null;
}

/**
 * Creates a library for the person a connection acts for, owned by them exactly as if they made
 * it in the app, and returns the token the connection acts with there. A "selected" connection
 * gets the new library added to its own grant, in the same D1 transaction. The owner is always
 * the grant's own person: nothing in the input names an owner.
 */
export async function createLibraryForGrant(
  accounts: Accounts,
  grant: AccountGrant,
  input: { slug: string; title?: string | null; description?: string | null },
): Promise<{
  library: LibraryRef;
  token: TokenInfo;
  title: string | null;
  description: string | null;
}> {
  const why = cannotCreate(grant);
  if (why) throw new OkfError(403, "create_not_allowed", why);
  const user = await accounts.account(grant.userId);
  if (!user) throw new OkfError(401, "suspended", "This account is suspended or deleted.");
  const { title, description, ...library } = await accounts.createLibrary(input.slug, user, {
    title: input.title,
    description: input.description,
    ...(grant.libraries === "all" ? {} : { grant: grant.id }),
  });
  return {
    library,
    token: grantToken(grant, user, library, "owner", grantAgent(grant, user.id)),
    title,
    description,
  };
}
