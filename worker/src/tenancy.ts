import type { Accounts, LibraryRef, User } from "./accounts";
import type { TokenInfo } from "./auth";
import { OkfError } from "./store/errors";

/**
 * The one place that decides whether a caller may reach a library (v2 spec: Tenancy and
 * authorization). Routes resolve {owner}/{slug} through here and never compare IDs themselves.
 * A library the caller cannot reach is answered exactly like one that does not exist: 404.
 *
 * Phase A: a signed-in person reaches the libraries they own; a token reaches its own library;
 * an app connection reaches the libraries its grant selects (grantLibraries). Phase B adds
 * members with roles here, without touching routes.
 */
export type Caller = { user: User } | { token: TokenInfo };

export function noLibrary(owner: string, slug: string): OkfError {
  return new OkfError(404, "no_library", `There is no library ${owner}/${slug}.`);
}

export async function authorizeLibrary(
  accounts: Accounts,
  caller: Caller,
  owner: string,
  slug: string,
): Promise<LibraryRef> {
  if ("token" in caller) {
    const lib = caller.token.library;
    if (lib.owner && lib.owner === owner && lib.slug === slug) return lib;
    throw noLibrary(owner, slug);
  }
  const ref = await accounts.library(owner, slug);
  if (!ref || ref.ownerId !== caller.user.id) throw noLibrary(owner, slug);
  return { id: ref.id, slug: ref.slug, do_id: ref.do_id, owner: ref.owner };
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
}

/**
 * The libraries a connection reaches now, each as the token it acts with there; null when the
 * account is gone or suspended.
 */
export async function grantLibraries(
  accounts: Accounts,
  grant: AccountGrant,
): Promise<{ user: User; libraries: TokenInfo[] } | null> {
  const user = await accounts.account(grant.userId);
  if (!user) return null;
  const selected = grant.libraries === "all" ? null : new Set(grant.libraries);
  const libraries = (await accounts.libraries(user.id))
    .filter((l) => !selected || selected.has(l.id))
    .map(
      (l): TokenInfo => ({
        id: `grant:${grant.id}`,
        actor: grant.actor,
        scope: grant.scope,
        prefix: grant.prefix,
        mcp_tiers: grant.tiers,
        library: { id: l.id, slug: l.slug, do_id: l.do_id, owner: l.owner },
        created_by: user.id,
      }),
    );
  return { user, libraries };
}
