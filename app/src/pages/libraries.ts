import { plural } from "../ui";

/** A library as the list shows it (`GET /api/v1/libraries`). */
export interface Library {
  id: string;
  owner: string;
  slug: string;
  /** Shared libraries carry the person's role there (tempra-dev: v2/sharing). */
  role?: "owner" | "write" | "read";
  title?: string;
  description?: string;
  seq?: number;
  concepts?: number;
  attachments?: number;
  /** Its summary could not be read just now (TEMPRA-23): listed and linked, without counts. */
  unavailable?: boolean;
}

/** A library's address from its name: lowercase letters, digits and dashes, as the server checks. */
export function slugFrom(name: string): string {
  return name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 63)
    .replace(/-+$/, "");
}

/** A card's line of facts: the person's access when shared, its page count, a failed summary. */
export function cardFacts(l: Library): string[] {
  const shared = (l.role ?? "owner") !== "owner";
  const facts: string[] = [];
  if (shared) facts.push(l.role === "write" ? "Write" : "Read");
  if (typeof l.concepts === "number") facts.push(plural(l.concepts, "page"));
  if (l.unavailable) facts.push("couldn't load just now");
  return facts;
}
