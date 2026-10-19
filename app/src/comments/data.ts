/**
 * Comments on a concept (tempra-dev: app/comments, TEMPRA-13): threads live in the ledger; this
 * loads a concept's with `GET …/comments?path=` (reloaded when the feed says one changed), finds
 * each quote in the body on screen, and keeps the draft started from the selection toolbar.
 */
import { type DocText, locate, type QuoteSelector } from "@tempra/editor";
import { useCallback, useEffect, useState } from "react";
import type { ActedBy } from "../agents";
import { api, useLoad } from "../api";
import type { Highlight } from "../Reader";
import type { Urls } from "../urls";

export interface CommentT {
  id: string;
  actor: string;
  /** Who wrote it, by id (TEMPRA-77); absent on comments from before it was kept. */
  by?: ActedBy;
  body: string;
  ts: string;
  seq: number;
}

export interface Thread {
  id: string;
  path: string;
  status: "open" | "resolved";
  actor: string;
  created_seq: number;
  last_seq: number;
  resolved_by: string | null;
  replies: number;
  anchor: (QuoteSelector & { seq: number }) | null;
  comments: CommentT[];
  /** Every action in order: open, reply, resolve and reopen, with the comment each added. */
  actions?: {
    kind: "open" | "reply" | "resolve" | "reopen";
    actor: string;
    by?: ActedBy;
    ts: string;
    seq: number;
    comment: string | null;
  }[];
}

/** Where a thread's quote is in the body on screen, as text offsets. */
export interface Placed extends Thread {
  at: { from: number; to: number } | null;
}

/** A concept's threads, open and resolved (a concept rarely has more than a page of them). */
export function useThreads(urls: Urls, path: string | null) {
  return useLoad(`comments ${urls.api("comments")} ${path ?? ""}`, async () =>
    path === null
      ? { threads: [] as Thread[] }
      : api<{ threads: Thread[] }>(urls.api("comments", { path, status: "all", limit: 200 })),
  );
}

/** Each thread's quote found in the version on screen, as the server would find it. */
export function placeThreads(threads: Thread[], text: DocText): Placed[] {
  return threads.map((t) => ({ ...t, at: t.anchor ? locate(text, t.anchor) : null }));
}

/** The highlights for the reader: open threads whose quote is on screen, and the draft. */
export function highlightsOf(
  placed: Placed[],
  active: string | null,
  draft: Draft | null,
): Highlight[] {
  const marks: Highlight[] = placed
    .filter((t) => t.status === "open" && t.at && t.at.to > t.at.from)
    .map((t) => ({
      id: t.id,
      from: t.at?.from ?? 0,
      to: t.at?.to ?? 0,
      active: t.id === active,
    }));
  if (draft) marks.push({ id: "draft", from: draft.from, to: draft.to, draft: true });
  return marks;
}

/** A comment being written on a quote: the text quoted, and where it is in the document's text. */
export interface Draft {
  quote: string;
  from: number;
  to: number;
}

/**
 * The draft comment's quote: started from the reader's selection toolbar, kept (highlighted)
 * while the comment is written, until it is posted or dropped.
 */
export function useDraft(text: DocText) {
  const [draft, setDraft] = useState<Draft | null>(null);
  // A new version of the body: the old offsets no longer apply.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when the body changes.
  useEffect(() => setDraft(null), [text]);
  const start = useCallback(
    ({ from, to }: { from: number; to: number }) => {
      if (from < 0 || to <= from) return;
      const quote = text.text.slice(from, to);
      if (quote.trim()) setDraft({ quote, from, to });
    },
    [text],
  );
  const clear = useCallback(() => setDraft(null), []);
  return { draft, start, clear };
}

/**
 * Open threads in the order the margin shows them: threads on the whole concept (and those whose
 * quote is gone) first, beside the title, then the rest in document order.
 */
export function marginOrder(placed: Placed[]): Placed[] {
  return placed
    .filter((t) => t.status === "open")
    .sort((a, b) => (a.at?.from ?? -1) - (b.at?.from ?? -1) || a.created_seq - b.created_seq);
}
