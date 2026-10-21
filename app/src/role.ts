import { useEffect } from "react";
import { api, useLoad } from "./api";

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
const LIBRARIES_EVENT = "tempra:libraries";

export const librariesChanged = () => window.dispatchEvent(new Event(LIBRARIES_EVENT));

/**
 * The person's libraries, own and shared (one load, shared by the workspace's parts; each part
 * reloads when told the libraries changed, since each holds its own copy of the answer).
 */
export function useLibraries() {
  const loaded = useLoad("workspace libraries", () =>
    api<{ libraries: ReachableLibrary[] }>("/api/v1/libraries"),
  );
  const { reload } = loaded;
  useEffect(() => {
    window.addEventListener(LIBRARIES_EVENT, reload);
    return () => window.removeEventListener(LIBRARIES_EVENT, reload);
  }, [reload]);
  return loaded;
}

/** The person's role in this library; null while it loads. */
export function useRole(lib: { owner: string; slug: string }): Role | null {
  const libs = useLibraries();
  if (libs.state !== "ready") return null;
  const found = libs.data.libraries.find((l) => l.owner === lib.owner && l.slug === lib.slug);
  return found?.role ?? "owner";
}

/** How a library is named to this person: its slug when theirs, owner/slug when shared. */
export const libraryName = (l: ReachableLibrary) =>
  (l.role ?? "owner") === "owner" ? l.slug : `${l.owner}/${l.slug}`;
