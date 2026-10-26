/**
 * What the signed-in person may do in a library (tempra-dev: v2/sharing): `read` reads and
 * comments, `write` also edits and verifies, the owner also manages it. The server enforces all
 * of it; the app only leaves out what would be refused.
 */
export type Role = "owner" | "write" | "read";

/** A library the person reaches, as GET /api/v1/libraries lists it. */
export interface ReachableLibrary {
  id: string;
  owner: string;
  slug: string;
  role?: Role;
  /** Its title and description, when set (TEMPRA-102). */
  title?: string;
  description?: string;
}

/** Said on window when the libraries changed (a title set, one made): every list reloads. */
export const LIBRARIES_EVENT = "tempra:libraries";

export const librariesChanged = () => window.dispatchEvent(new Event(LIBRARIES_EVENT));

/**
 * How a library is named to people, the one way the app does it (TEMPRA-131, X-2): its title,
 * else its slug; its owner after it only when it is shared with the person ("Notes (@ann)"). A
 * library the list does not know (yet) is named as the person's own.
 */
export function libraryLabel(l: {
  owner: string;
  slug: string;
  title?: string | null;
  role?: Role | null;
}): string {
  const name = l.title || l.slug;
  return (l.role ?? "owner") === "owner" ? name : `${name} (@${l.owner})`;
}

/** Whether the person reaches a library as a member, not as its owner. */
export const isShared = (l: { role?: Role | null }) => (l.role ?? "owner") !== "owner";
