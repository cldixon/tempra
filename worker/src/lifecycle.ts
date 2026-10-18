import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import type { LibraryRef, User } from "./accounts";
import type { Deps } from "./app";

/**
 * Deleting a library or a whole account (v2 spec: A2). Rows go first, so nothing can reach the
 * library while its storage is wiped. Attachment bytes are shared by hash across libraries and
 * stay in R2 until a blob sweep exists (v2 spec: Open questions, blob GC).
 */

async function grantsOf(oauth: OAuthHelpers, userId: string) {
  const grants = [];
  let cursor: string | undefined;
  do {
    const page = await oauth.listUserGrants(userId, { cursor, limit: 100 });
    grants.push(...page.items);
    cursor = page.cursor;
  } while (cursor);
  return grants;
}

export async function deleteLibrary(
  deps: Pick<Deps, "accounts" | "destroyLibrary">,
  oauth: OAuthHelpers,
  user: Pick<User, "id">,
  ref: LibraryRef,
): Promise<void> {
  // A connection that selected only this library (or, before account-level access, was bound
  // to it) has nothing left to reach. Connections to all libraries stay.
  const remaining = new Set((await deps.accounts.libraries(user.id)).map((l) => l.id));
  remaining.delete(ref.id);
  for (const g of await grantsOf(oauth, user.id)) {
    const m = g.metadata as
      | { library?: string; libraries?: "all" | string[]; grant?: string }
      | undefined;
    // A selected connection also reaches the libraries it created (TEMPRA-100).
    const created = m?.grant ? await deps.accounts.grantLibraries(m.grant, user.id) : [];
    const orphaned = Array.isArray(m?.libraries)
      ? ![...m.libraries, ...created].some((id) => remaining.has(id))
      : m?.libraries === undefined && m?.library === ref.slug;
    if (orphaned) await oauth.revokeGrant(g.id, user.id);
  }
  await deps.accounts.deleteLibrary(ref.id);
  await deps.destroyLibrary?.(ref.do_id);
}

export async function deleteAccount(
  deps: Pick<Deps, "accounts" | "destroyLibrary">,
  oauth: OAuthHelpers,
  user: User,
): Promise<void> {
  for (const ref of await deps.accounts.libraries(user.id)) {
    await deleteLibrary(deps, oauth, user, ref);
  }
  for (const g of await grantsOf(oauth, user.id)) await oauth.revokeGrant(g.id, user.id);
  await deps.accounts.deleteUser(user);
}
