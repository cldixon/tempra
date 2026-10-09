import type { TokenInfo } from "./auth";
import { OkfError } from "./store/errors";

/**
 * Rate limits and metering for tokens and connected apps (v2 spec: Limits, Metering). People in
 * the web UI are not rate limited; their writes are few and deliberate.
 */

export interface UsageEvent {
  /** A request, a write, a sign-in email, or a change-feed connection opened. */
  kind: "request" | "write" | "email" | "feed";
  /** The account: a library owner's handle, or an email for sign-in mail. */
  account: string;
  library?: string;
  bytes?: number;
}

export interface UsageDeps {
  /** True when the call may go ahead; absent means no limits (tests, local dev). */
  rateLimit?: (kind: "write" | "request", key: string) => Promise<boolean>;
  /** Records a data point; never throws, never blocks. */
  meter?: (e: UsageEvent) => void;
}

/** MCP tools that change a library. */
export const WRITE_TOOLS = new Set([
  "write",
  "edit",
  "move",
  "delete",
  "batch",
  "attach",
  "revert",
  "verify",
  "comment",
]);

/** Who a request counts against: a per-token (or per-connection) key and the account. */
export interface Admission {
  key: string;
  /** The account: the handle of the person the caller acts for. */
  account: string;
  library?: string;
}

export function tokenAdmission(token: TokenInfo): Admission {
  // Grants approved before A1 carry no owner handle; their library id stands in until reconnected.
  return {
    key: `${token.id}|${token.library.id}|${token.actor}`,
    // The person it acts for (a member's agents spend the member's budget, not the owner's).
    account: token.person || token.library.owner || token.library.id,
    library: token.library.id,
  };
}

/**
 * Counts a request (and a write); 429 when it is over a per-minute limit. `limited: false` meters
 * without limiting: a person in the web UI, whose requests are few and deliberate.
 */
export async function admit(
  d: UsageDeps,
  who: Admission,
  write: boolean,
  limited = true,
): Promise<void> {
  const { key, account, library } = who;
  if (limited && d.rateLimit && !(await d.rateLimit("request", key))) {
    throw new OkfError(429, "rate_limited", "Too many requests from this token; slow down.");
  }
  if (limited && write && d.rateLimit && !(await d.rateLimit("write", account))) {
    throw new OkfError(
      429,
      "rate_limited",
      "Too many writes to this account in the last minute; slow down.",
    );
  }
  d.meter?.({ kind: "request", account, library });
  if (write) d.meter?.({ kind: "write", account, library });
}

/** Whether a JSON-RPC body (one message or a batch) calls a tool that writes. */
export function mcpWrites(body: unknown): boolean {
  const msgs = Array.isArray(body) ? body : [body];
  return msgs.some((m) => {
    const msg = m as { method?: string; params?: { name?: string } };
    return msg?.method === "tools/call" && WRITE_TOOLS.has(String(msg.params?.name ?? ""));
  });
}
