import type { Touched } from "../activity";
import { ApiError } from "../api";
import type { Role } from "../role";
import { day, localTime } from "../ui";
import { dirOf, folderName } from "../urls";

/**
 * A library's management pages (TEMPRA-14; take 4 follow-ups, TEMPRA-124 and 135): import and
 * export, recovery, revert and restore, connecting an agent, members, deleting it.
 * Each acts through the REST API as the signed-in person, and speaks to people: agents by name,
 * pages by title, local times, no sequence numbers or storage words. The pure parts they share.
 */

/**
 * An owner-only page's load (OwnerOnly): made once the role is known to be owner, so nobody else
 * asks the server for what it would refuse. Key the load by the role, so it runs again then.
 */
export const forOwner = <T>(role: Role | null, load: () => Promise<T>): Promise<T> =>
  role === "owner" ? load() : Promise.reject(new ApiError(403, "owner_only", "Owner only."));

// ---------------------------------------------------------------- import and export

export interface Nightly {
  date: string;
  seq: number | null;
  files: number | null;
}

/**
 * An export's name as a person reads it: "Sep 30", or "Sep 30, 2026, 6:02 PM, before a restore"
 * (local time) for the copy a restore saves first.
 */
export function exportLabel(folder: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})-pre-restore-(\d{2})(\d{2})(\d{2})\d{3}(-[0-9a-f]{4})?$/.exec(
    folder,
  );
  if (m) return `${localTime(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`)}, before a restore`;
  return /^\d{4}-\d{2}-\d{2}$/.test(folder) ? day(`${folder}T00:00:00Z`, "UTC") : folder;
}

// ---------------------------------------------------------------- recovery

export interface RestoreRow {
  id: string;
  kind: "restore" | "undo";
  to: string;
  requested_at: string;
  actor: string;
  seq_before: number;
  export: string;
  undoes?: string;
}

/** A restore id (20260930T180211042Z) as an ISO time, to the second. */
export function restoreTime(id: string): string {
  return id.replace(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})\d{3}Z(-[0-9a-f]{4})?$/,
    "$1-$2-$3T$4:$5:$6Z",
  );
}

// ---------------------------------------------------------------- revert and restore

export const WHAT_WORDS: Record<Touched["what"], string> = {
  added: "Added",
  edited: "Edited",
  rewrote: "Rewrote",
  moved: "Moved",
  deleted: "Deleted",
  reverted: "Reverted",
};

/** Where a moved page was: its folder by name. */
export const folderOf = (path: string) => (dirOf(path) ? folderName(dirOf(path)) : "the top level");

export interface HistoryRow {
  seq: number;
  ts: string;
  op: string;
}

/**
 * The version shown at `to`: the latest content event up to it, numbered from the first; null
 * when there is none.
 */
export function versionAt(events: HistoryRow[], to: number): { n: number; ts: string } | null {
  const versions = events.filter((e) => e.op !== "verify" && e.op !== "comment" && e.op !== "move");
  let i = versions.length - 1;
  while (i >= 0 && (versions[i]?.seq ?? 0) > to) i--;
  const v = versions[i];
  return v ? { n: i + 1, ts: v.ts } : null;
}

// ---------------------------------------------------------------- members

export interface MembersData {
  owner: string;
  role: Role;
  members: { handle: string; role: "read" | "write"; created: string }[];
  /** The owner's view only. */
  invitations?: { id: string; handle: string; role: "read" | "write"; expires: string }[];
}

export const ROLE_WORDS = { read: "Read and comment", write: "Read and write" } as const;
