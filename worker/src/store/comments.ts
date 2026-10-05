/**
 * Comment threads (tempra-dev: app/comments): the shapes the store takes and returns, and the
 * checks that need no database. The store records each action as a `comment` event and keeps
 * the `threads` and `comments` tables in step with it.
 */
import { MAX_QUOTE, type QuoteSelector } from "@tempra/editor/anchor";
import { OkfError } from "./errors";

/** Longest comment body, in characters. */
export const MAX_COMMENT = 10_000;

/** The anchor as stored: a quote selector and the sequence it was made at. */
export interface StoredAnchor extends QuoteSelector {
  seq: number;
}

export type CommentAction =
  | {
      kind: "open";
      path: string;
      body: string;
      /** The quoted body text; `from` (an offset in the body) picks among repeats. */
      anchor?: { quote: string; from?: number } | null;
    }
  | { kind: "reply"; thread: string; body: string }
  | { kind: "resolve"; thread: string; body?: string | null }
  | { kind: "reopen"; thread: string; body?: string | null };

export type ThreadStatus = "open" | "resolved";

export interface CommentView {
  id: string;
  actor: string;
  body: string;
  ts: string;
  seq: number;
}

export interface ThreadView {
  id: string;
  path: string;
  status: ThreadStatus;
  /** Who opened it. */
  actor: string;
  created_seq: number;
  /** The last action on it (a reply, resolve or reopen). */
  last_seq: number;
  last_actor: string;
  resolved_by: string | null;
  resolved_seq: number | null;
  replies: number;
  anchor: StoredAnchor | null;
  /** Where the quote is in the concept's current body; null when outdated or unanchored. */
  located: { from: number; to: number } | null;
  /** Anchored, but the quoted text is gone from the current body. */
  outdated: boolean;
  /** The opening comment, then the replies, oldest first. */
  comments: CommentView[];
}

export interface CommentResult {
  request_id: string;
  seq: number;
  thread: ThreadView;
}

/** A comment body, trimmed; refused when empty or too long. */
export function commentBody(raw: unknown, required: boolean): string | null {
  const body = typeof raw === "string" ? raw.trim() : "";
  if (!body) {
    if (required) throw new OkfError(400, "empty_comment", "A comment needs a body.");
    return null;
  }
  if (body.length > MAX_COMMENT) {
    throw new OkfError(
      400,
      "comment_too_long",
      `A comment is at most ${MAX_COMMENT} characters; this one is ${body.length}.`,
    );
  }
  return body;
}

/** A quote to anchor on: not empty, not too long. */
export function checkQuote(quote: unknown): string {
  if (typeof quote !== "string" || quote.length === 0) {
    throw new OkfError(400, "bad_anchor", "An anchor needs the quoted text.");
  }
  if (quote.length > MAX_QUOTE) {
    throw new OkfError(
      400,
      "bad_anchor",
      `Quote at most ${MAX_QUOTE} characters; comment on the concept instead.`,
    );
  }
  return quote;
}
