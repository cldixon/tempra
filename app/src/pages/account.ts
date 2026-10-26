import { api } from "../api";
import type { Me } from "../ui";

/*
 * The account's pages (TEMPRA-14; take 4): first run, Agents, Invitations, Account and
 * Notifications. The pure parts they share; each page is its own component beside this file.
 */

/** The landing page's legal pages (TEMPRA-14). */
export const LEGAL = "https://tempra.dev";

export const post = (url: string, body: unknown, method = "POST") =>
  api(url, { method, body: JSON.stringify(body) });

// ---------------------------------------------------------------- agents

export interface TokenRow {
  id: string;
  library: string;
  actor: string;
  scope: string;
  prefix: string | null;
  expires: string | null;
  mcp_tiers: string;
  created_by: string | null;
  revoked: string | null;
}

export interface Minted {
  secret: string;
  actor: string;
  library: string;
}

/** Apps connected over OAuth (claude.ai, Claude Code) and what each may reach. */
export interface AppGrant {
  id: string;
  app: string;
  actor: string | null;
  libraries: "all" | string[];
  access: "read" | "write";
  prefix: string | null;
  tiers: "all" | "files";
  /** May create libraries owned by the person (TEMPRA-100). */
  create_libraries?: boolean;
  created: string;
}

/** A token that can act now: not revoked, not expired. */
export const liveToken = (t: TokenRow, now: number) =>
  !t.revoked && (t.expires === null || Date.parse(t.expires) > now);

/**
 * The library New token starts on: `?library=` (owner/slug) when the person may mint on it (their
 * own libraries are listed by slug alone), else the first.
 */
export function chosenLibrary(
  libraries: string[],
  library: string | null,
  me: Me | null,
): string | undefined {
  if (!library) return libraries[0];
  if (libraries.includes(library)) return library;
  const own =
    me && library.startsWith(`${me.handle}/`) ? library.slice(me.handle.length + 1) : null;
  return own && libraries.includes(own) ? own : libraries[0];
}

// ---------------------------------------------------------------- invitations

export interface PendingInvitation {
  id: string;
  owner: string;
  slug: string;
  role: "read" | "write";
  /** Who invited. */
  handle: string;
  created?: string;
  expires: string;
}

// ---------------------------------------------------------------- the account page

export interface AccountData {
  email: string;
  handle: string;
  actor: string;
  sessions: {
    id: string;
    created: string;
    last_seen: string;
    user_agent: string | null;
    current: boolean;
  }[];
  usage: { libraries: number; tokens: number };
  limits: { libraries: number; tokens: number };
}

export const DONE: Record<string, string> = {
  email: "Your email is changed.",
};

// ---------------------------------------------------------------- notification mail

export interface MailPrefs {
  immediate: boolean;
  digest: boolean;
  libraries: { library: string; immediate: boolean | null; digest: boolean | null }[];
}

/** A library's setting as the select shows it: following the account, on or off. */
export const choice = (v: boolean | null) => (v === null ? "" : v ? "on" : "off");
export const fromChoice = (v: string) => (v === "" ? null : v === "on");
