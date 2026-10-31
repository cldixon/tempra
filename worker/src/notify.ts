import { bytesToHex, randomBytes } from "@noble/hashes/utils.js";
import type { Accounts, LibraryRef } from "./accounts";
import type { TokenInfo } from "./auth";
import type { LibraryClient } from "./client";
import {
  AGENT_ACTOR,
  agentEnabled,
  type ManagedAgent,
  type ManagedDeps,
  replying,
  TEMPRA,
} from "./managed/agent";
import { lintRenders, mergeImportLint, mergeOpLint, type RenderLintDeps } from "./render-lint";
import type { CommentAction, CommentResult, Mention } from "./store/comments";
import type { ImportResult, OpResult, RenderJob, RequestContext, WriteNotice } from "./store/store";
import { tokenAdmission } from "./usage";

/**
 * Notifications (TEMPRA-58 design, TEMPRA-72, TEMPRA-73; TEMPRA-173, TEMPRA-189): items addressed
 * to one person are fanned out into D1 by the Worker once a write has committed in the library,
 * so the inbox and its count are one D1 query, never a call to every library the person reaches.
 * An item is open until it is done: opened, or resolved by what it asks for (one state, TEMPRA-189).
 * What happens in a library is never an item; the person looks at Activity.
 *
 * Who is told (TEMPRA-173; tempra-dev: decisions/notifications-from-zero): a person hears of
 * three things only, an invitation, a mention and a reply. A reply goes to everyone who opened or
 * wrote in the thread, a mention to the person mentioned; never to the person who acted in the
 * app themselves (their agents acting for them do notify them), and only to people who can reach
 * the library at that moment. Items are closed by what resolves them: a resolved thread, an
 * answered invitation; open items follow a moved page. A fourth, `quota` (TEMPRA-232, the
 * decision's addendum of 2026-10-31), is about the account, on no library: once at 80% and once
 * at 100% of each monthly quota (quota.ts makes it, and mails it at once), done once opened.
 */

export type ItemKind = "reply" | "mention" | "invitation" | "quota";

/** Kinds that are mailed at once (batched): the ones addressed to the person. */
export const MAILED: ReadonlySet<ItemKind> = new Set(["reply", "mention"]);

export interface NewItem {
  user: string;
  library: string | null;
  kind: ItemKind;
  /** The library as {owner}/{slug} when it happened. */
  place: string;
  path?: string | null;
  thread?: string | null;
  seq?: number | null;
  actor: string;
  by_user?: string | null;
  excerpt?: string;
  /** Whether the item may be mailed (prefs are checked when the batch goes out). */
  mail?: boolean;
  /**
   * `verify`: one open item per (user, library, key); another add updates it (its excerpt, time
   * and count, unread again) instead of adding a row.
   */
  key?: string | null;
  title?: string | null;
  by_agent?: string | null;
  count?: number | null;
}

export interface Item {
  id: string;
  library: string | null;
  kind: ItemKind;
  place: string;
  path: string | null;
  thread: string | null;
  seq: number | null;
  actor: string;
  excerpt: string;
  created: string;
  read_at: string | null;
  done_at: string | null;
  title: string | null;
  by_user: string | null;
  by_agent: string | null;
  count: number | null;
}

/** What a committed write changes for a library's open items: see `closeAfterWrite`. */
export interface Closes {
  /** Moved: open items on the old path follow the page. */
  moved: { from: string; to: string }[];
}

/**
 * An account's mail setting (TEMPRA-189): one switch for mentions and replies, on by default
 * (stored as the account's `immediate`). Invitations always mail.
 */
export interface Prefs {
  email: boolean;
}

export const DEFAULT_PREFS: Prefs = { email: true };

/** Notification mails a person gets a day, at most. */
export const MAILS_PER_DAY = 20;

export interface Notifications {
  add(items: NewItem[]): Promise<void>;
  /**
   * The inbox, newest first (by when the item was made or last updated): open items, or with
   * `done` only done ones, or with `all` both; `library` limits it to one library (its id);
   * `before` is `next`. `open` counts the open items under the same library filter.
   */
  inbox(
    user: string,
    opts?: { all?: boolean; done?: boolean; library?: string; before?: string; limit?: number },
  ): Promise<{ items: Item[]; next: string | null; open: number }>;
  /** Carries a library's open items along with the pages a committed write moved. */
  closeAfterWrite(library: string, closes: Closes): Promise<void>;
  /** Closes a resolved thread's reply and mention items, for everyone. */
  closeThread(library: string, thread: string): Promise<void>;
  /** How many items wait on the person: the bell's count. */
  openCount(user: string): Promise<number>;
  /** Marks an item done (opened, or by hand); false when it is not the person's. */
  markDone(user: string, id: string, done?: boolean): Promise<boolean>;
  /** Marks done every item of a kind from a place ({owner}/{slug}): an answered invitation. */
  settle(user: string, kind: ItemKind, place: string): Promise<void>;
  prefs(user: string): Promise<Prefs>;
  setPrefs(user: string, prefs: Prefs): Promise<void>;
  /** The account's one-click unsubscribe key, made on first use. */
  unsubscribeKey(user: string): Promise<string>;
  /** Turns all notification mail off for the key's account; its user, or null for no such key. */
  unsubscribe(key: string): Promise<string | null>;
  /** People with mail waiting: their pending items, oldest first. */
  pendingMail(): Promise<{ user: string; items: (Item & { user: string })[] }[]>;
  setMail(ids: string[], state: "sent" | "skipped"): Promise<void>;
  /** Takes one of the day's mails for the person; false when they are at the cap. */
  takeMailSlot(user: string, day: string, cap?: number): Promise<boolean>;
  recordFailure(day: string): Promise<void>;
  failures(day: string): Promise<number>;
}

const bool = (v: number | null | undefined) => (v === null || v === undefined ? null : v === 1);
const flag = (v: boolean | null | undefined) => (v === null || v === undefined ? null : v ? 1 : 0);

export function d1Notifications(db: D1Database): Notifications {
  const items = `SELECT id, library, kind, place, path, thread, seq, actor, excerpt, created, read_at, done_at, title, by_user, by_agent, count FROM notifications`;
  const COLS =
    "id, user, library, kind, place, path, thread, seq, actor, by_user, excerpt, created, mail, key, title, by_agent, count";
  const MARKS = COLS.split(",")
    .map((_, n) => `?${n + 1}`)
    .join(", ");
  return {
    async add(list) {
      if (list.length === 0) return;
      const now = new Date().toISOString();
      const values = (i: NewItem) => [
        crypto.randomUUID(),
        i.user,
        i.library,
        i.kind,
        i.place,
        i.path ?? null,
        i.thread ?? null,
        i.seq ?? null,
        i.actor,
        i.by_user ?? null,
        (i.excerpt ?? "").slice(0, 280),
        now,
        i.mail ? "pending" : null,
        i.key ?? null,
        i.title ?? null,
        i.by_agent ?? null,
        i.count ?? null,
      ];
      const statement = (i: NewItem) => {
        if (!i.key) {
          return db
            .prepare(`INSERT INTO notifications (${COLS}) VALUES (${MARKS})`)
            .bind(...values(i));
        }
        // Keyed: the open item with this key is updated rather than a second row added.
        return db
          .prepare(
            `INSERT INTO notifications (${COLS}) VALUES (${MARKS})
             ON CONFLICT (user, library, key) WHERE key IS NOT NULL AND done_at IS NULL
             DO UPDATE SET excerpt = excluded.excerpt, created = excluded.created, read_at = NULL,
               seq = excluded.seq, actor = excluded.actor, by_user = excluded.by_user,
               by_agent = excluded.by_agent, title = excluded.title, count = excluded.count`,
          )
          .bind(...values(i));
      };
      await db.batch(list.map(statement));
    },
    async inbox(user, opts = {}) {
      const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
      // Newest first by when the item was made or last updated; the cursor is (created, rowid).
      const [at, n] = (opts.before ?? "").split("~");
      const before = at && Number(n) > 0 ? [at, at, Number(n)] : [];
      const state = opts.done ? "AND done_at IS NOT NULL" : opts.all ? "" : "AND done_at IS NULL";
      const lib = opts.library ? "AND library = ?" : "";
      const libArgs = opts.library ? [opts.library] : [];
      const [r, open] = await Promise.all([
        db
          .prepare(
            `SELECT rowid AS n, ${items.slice("SELECT ".length)} WHERE user = ? ${state} ${lib}
             ${before.length ? "AND (created < ? OR (created = ? AND rowid < ?))" : ""}
             ORDER BY created DESC, rowid DESC LIMIT ?`,
          )
          .bind(user, ...libArgs, ...before, limit + 1)
          .all<Item & { n: number }>(),
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM notifications WHERE user = ? AND done_at IS NULL ${lib}`,
          )
          .bind(user, ...libArgs)
          .first<{ n: number }>(),
      ]);
      const page = r.results.slice(0, limit).map(({ n: _, ...i }) => i);
      const last = r.results[limit - 1];
      return {
        items: page,
        next: r.results.length > limit && last ? `${last.created}~${last.n}` : null,
        open: open?.n ?? 0,
      };
    },
    async closeAfterWrite(library, closes) {
      const now = new Date().toISOString();
      const done = "done_at = ?1, read_at = COALESCE(read_at, ?1)";
      const open = "library = ?2 AND path = ?3 AND done_at IS NULL";
      const stmts: D1PreparedStatement[] = [];
      for (const m of closes.moved) {
        // Open items follow the page; a keyed one that would meet an open one at the new path
        // is closed instead, so the key stays unique.
        stmts.push(
          db
            .prepare(
              `UPDATE notifications SET ${done} WHERE ${open} AND key IS NOT NULL AND EXISTS (
                 SELECT 1 FROM notifications o WHERE o.user = notifications.user
                   AND o.library = notifications.library AND o.done_at IS NULL
                   AND o.key = notifications.kind || ':' || ?4)`,
            )
            .bind(now, library, m.from, m.to),
          db
            .prepare(
              `UPDATE notifications SET path = ?3,
                 key = CASE WHEN key IS NULL THEN NULL ELSE kind || ':' || ?3 END
               WHERE library = ?1 AND path = ?2 AND done_at IS NULL`,
            )
            .bind(library, m.from, m.to),
        );
      }
      if (stmts.length) await db.batch(stmts);
    },
    async closeThread(library, thread) {
      const now = new Date().toISOString();
      await db
        .prepare(
          `UPDATE notifications SET done_at = ?1, read_at = COALESCE(read_at, ?1)
           WHERE library = ?2 AND thread = ?3 AND done_at IS NULL
             AND kind IN ('reply', 'mention')`,
        )
        .bind(now, library, thread)
        .run();
    },
    async openCount(user) {
      const row = await db
        .prepare("SELECT COUNT(*) AS n FROM notifications WHERE user = ? AND done_at IS NULL")
        .bind(user)
        .first<{ n: number }>();
      return row?.n ?? 0;
    },
    async markDone(user, id, done = true) {
      const now = new Date().toISOString();
      const r = await db
        .prepare(
          `UPDATE notifications SET done_at = ?, read_at = COALESCE(read_at, ?) WHERE id = ? AND user = ?`,
        )
        .bind(done ? now : null, now, id, user)
        .run();
      return (r.meta.changes ?? 0) > 0;
    },
    async settle(user, kind, place) {
      const now = new Date().toISOString();
      await db
        .prepare(
          `UPDATE notifications SET done_at = ?, read_at = COALESCE(read_at, ?)
           WHERE user = ? AND kind = ? AND place = ? AND done_at IS NULL`,
        )
        .bind(now, now, user, kind, place)
        .run();
    },
    async prefs(user) {
      const row = await db
        .prepare("SELECT immediate FROM notification_prefs WHERE user = ? AND library = ''")
        .bind(user)
        .first<{ immediate: number | null }>();
      return { email: bool(row?.immediate) ?? DEFAULT_PREFS.email };
    },
    async setPrefs(user, prefs) {
      await db
        .prepare(
          `INSERT INTO notification_prefs (user, library, immediate) VALUES (?, '', ?)
           ON CONFLICT (user, library) DO UPDATE SET immediate = excluded.immediate`,
        )
        .bind(user, flag(prefs.email))
        .run();
    },
    async unsubscribeKey(user) {
      const row = await db
        .prepare("SELECT unsub_key FROM notification_prefs WHERE user = ? AND library = ''")
        .bind(user)
        .first<{ unsub_key: string | null }>();
      if (row?.unsub_key) return row.unsub_key;
      const key = bytesToHex(randomBytes(24));
      await db
        .prepare(
          `INSERT INTO notification_prefs (user, library, unsub_key) VALUES (?, '', ?)
           ON CONFLICT (user, library) DO UPDATE SET unsub_key = COALESCE(unsub_key, excluded.unsub_key)`,
        )
        .bind(user, key)
        .run();
      const again = await db
        .prepare("SELECT unsub_key FROM notification_prefs WHERE user = ? AND library = ''")
        .bind(user)
        .first<{ unsub_key: string }>();
      return again?.unsub_key ?? key;
    },
    async unsubscribe(key) {
      if (!/^[0-9a-f]{48}$/.test(key)) return null;
      const row = await db
        .prepare("SELECT user FROM notification_prefs WHERE unsub_key = ? AND library = ''")
        .bind(key)
        .first<{ user: string }>();
      if (!row) return null;
      await db
        .prepare("UPDATE notification_prefs SET immediate = 0 WHERE user = ? AND library = ''")
        .bind(row.user)
        .run();
      return row.user;
    },
    async pendingMail() {
      const r = await db
        .prepare(
          `SELECT user, ${items.slice("SELECT ".length, items.indexOf(" FROM"))}
           FROM notifications WHERE mail = 'pending' ORDER BY user, created LIMIT 2000`,
        )
        .all<Item & { user: string }>();
      const by = new Map<string, (Item & { user: string })[]>();
      for (const i of r.results) {
        const list = by.get(i.user) ?? [];
        list.push(i);
        by.set(i.user, list);
      }
      return [...by].map(([user, list]) => ({ user, items: list }));
    },
    async setMail(ids, state) {
      for (let i = 0; i < ids.length; i += 50) {
        const chunk = ids.slice(i, i + 50);
        await db
          .prepare(
            `UPDATE notifications SET mail = ? WHERE id IN (${chunk.map(() => "?").join(", ")})`,
          )
          .bind(state, ...chunk)
          .run();
      }
    },
    async takeMailSlot(user, day, cap = MAILS_PER_DAY) {
      await db
        .prepare(
          `INSERT INTO notification_prefs (user, library, mail_day, mail_count) VALUES (?1, '', ?2, 0)
           ON CONFLICT (user, library) DO UPDATE SET
             mail_count = CASE WHEN mail_day = ?2 THEN mail_count ELSE 0 END, mail_day = ?2`,
        )
        .bind(user, day)
        .run();
      const r = await db
        .prepare(
          `UPDATE notification_prefs SET mail_count = mail_count + 1
           WHERE user = ? AND library = '' AND mail_day = ? AND mail_count < ?`,
        )
        .bind(user, day, cap)
        .run();
      return (r.meta.changes ?? 0) > 0;
    },
    async recordFailure(day) {
      await db
        .prepare(
          `INSERT INTO mail_failures (day, count) VALUES (?, 1)
           ON CONFLICT (day) DO UPDATE SET count = count + 1`,
        )
        .bind(day)
        .run();
    },
    async failures(day) {
      const row = await db
        .prepare("SELECT count FROM mail_failures WHERE day = ?")
        .bind(day)
        .first<{ count: number }>();
      return row?.count ?? 0;
    },
  };
}

// ---------------------------------------------------------------- mentions (TEMPRA-73)

/** A person who can reach a library: its owner or a member. */
export interface LibraryPerson {
  id: string;
  handle: string;
}

/** The people who can reach a library now: its owner, then its members. */
export async function libraryPeople(
  accounts: Accounts,
  ref: Pick<LibraryRef, "id" | "owner" | "slug">,
): Promise<LibraryPerson[]> {
  const [lib, members] = await Promise.all([
    accounts.library(ref.owner, ref.slug),
    accounts.members(ref.id),
  ]);
  return [
    ...(lib ? [{ id: lib.ownerId, handle: ref.owner }] : []),
    ...members.map((m) => ({ id: m.user, handle: m.handle })),
  ];
}

/**
 * A library's managed agents, by the name a comment mentions them with (TEMPRA-222): @tempra,
 * when the agent is on for the library's owner (limits.ts `agent_daily_usd`) and the Worker can
 * queue its turns. `ownerId` is the owner's users id (the first of `libraryPeople`).
 */
export async function managedAgents(
  d: Pick<NotifyDeps, "accounts" | "managed">,
  ownerId: string | undefined,
): Promise<ManagedAgent[]> {
  if (!d.managed || !ownerId) return [];
  return agentEnabled(await d.accounts.limits(ownerId)) ? [TEMPRA] : [];
}

/** `@handle`, not inside an email address or a path: after a start, space or punctuation. */
const MENTION = /(^|[^\w@./-])@([a-z0-9](?:[a-z0-9]|[-_](?=[a-z0-9])){0,38})/gi;

/**
 * The mentions in a comment body, resolved against who can reach the library (TEMPRA-73). A
 * handle that names nobody there, whether or not such an account exists, is plain text: the
 * result is the same either way, so a mention never tells whether a handle exists.
 */
export function resolveMentions(
  body: string,
  people: LibraryPerson[],
  agents: { id: string; name: string }[] = [],
): Mention[] {
  const byHandle = new Map(people.map((p) => [p.handle.toLowerCase(), p]));
  const byAgent = new Map(agents.map((a) => [a.name.toLowerCase(), a]));
  const out: Mention[] = [];
  const seen = new Set<string>();
  for (const m of body.matchAll(MENTION)) {
    const name = (m[2] ?? "").toLowerCase();
    if (seen.has(name)) continue;
    seen.add(name);
    const person = byHandle.get(name);
    if (person) out.push({ user: person.id, handle: person.handle });
    else {
      const agent = byAgent.get(name);
      if (agent) out.push({ agent: agent.id, name: agent.name });
    }
    if (out.length >= 20) break;
  }
  return out;
}

// ---------------------------------------------------------------- the fan-out

export interface NotifyDeps {
  accounts: Accounts;
  notifications?: Notifications | null;
  /** The managed agent's queue (TEMPRA-222); without it, @tempra is plain text. */
  managed?: ManagedDeps | null;
}

/** `s` on one line, cut to `n` characters. */
export function clip(s: string, n: number): string {
  const line = s.replace(/\s+/g, " ").trim();
  return line.length > n ? `${line.slice(0, n - 1)}…` : line;
}

/**
 * Posts a comment action and tells the people it is addressed to: the one path for the REST
 * routes and the MCP `comment` tool. Mentions are resolved here, before the library's write
 * transaction (which must not await), and stored in the action's meta. The fan-out runs after
 * the write commits; a failure there is logged, never turned into an error for a committed write.
 */
export async function postComment(
  d: NotifyDeps,
  token: TokenInfo,
  lib: Pick<LibraryClient, "comment">,
  ctx: RequestContext,
  action: CommentAction,
): Promise<CommentResult> {
  const people = await libraryPeople(d.accounts, token.library);
  const body = typeof action.body === "string" ? action.body : "";
  // The owner comes first in `people` when the library is found.
  const agents = await managedAgents(d, people[0]?.id).catch(() => []);
  // The managed agent naming itself in its reply ("mention @tempra…") is not a mention of it.
  const self = ctx.actor === AGENT_ACTOR;
  const mentions = body
    ? resolveMentions(body, people, agents).filter((m) => !(self && "agent" in m))
    : [];
  const res = await lib.comment(ctx, { ...action, mentions });
  try {
    await fanOut(d, token, ctx, action, res, people, mentions);
    // A resolved thread's items are done for everyone; reopening does not reopen them.
    if (action.kind === "resolve") {
      await d.notifications?.closeThread(token.library.id, res.thread.id);
    }
  } catch (e) {
    console.error(JSON.stringify({ notify_failed: res.request_id, error: String(e) }));
  }
  try {
    await askAgent(d, token, ctx, action, res, agents, mentions);
  } catch (e) {
    console.error(JSON.stringify({ agent_not_asked: res.request_id, error: String(e) }));
  }
  return res;
}

/**
 * The managed agent's trigger (TEMPRA-222; tempra-dev: agents/managed-agent, How a mention runs):
 * a comment that mentions @tempra, or a reply in a thread the agent has answered, sends one turn
 * to its queue, and the thread shows "Tempra is replying…" at once. A reopen with a comment counts
 * as a reply (the agent asks people to reopen a thread to change its mind). Never for the agent's
 * own comments, a resolve, a bare reopen, or a comment no person stands behind; only while the
 * agent is on for the library's owner (`agents` is empty otherwise).
 */
async function askAgent(
  d: NotifyDeps,
  token: TokenInfo,
  ctx: RequestContext,
  action: CommentAction,
  res: CommentResult,
  agents: ManagedAgent[],
  mentions: Mention[],
) {
  if (!d.managed || agents.length === 0) return;
  const commented =
    action.kind === "open" ||
    action.kind === "reply" ||
    (action.kind === "reopen" && !!action.body);
  if (!commented) return;
  if (ctx.actor === AGENT_ACTOR) return;
  const asker = ctx.by?.person;
  if (!asker) return;
  const named = mentions.some((m) => "agent" in m && m.agent === TEMPRA.id);
  const answered = res.thread.comments.some((c) => c.actor === AGENT_ACTOR);
  if (!named && !answered) return;
  const last = res.thread.comments[res.thread.comments.length - 1];
  await d.managed.enqueue({
    type: "agent_turn",
    library: token.library.id,
    do_id: token.library.do_id,
    thread: res.thread.id,
    comment: last?.id ?? null,
    seq: res.seq,
    asker,
  });
  // The agent's identity for whom it acts is made on its turn; the person is known now.
  await d.managed
    .announce?.(token.library.do_id, replying(res.thread.id, res.thread.path, { person: asker }))
    .catch(() => {});
}

async function fanOut(
  d: NotifyDeps,
  token: TokenInfo,
  ctx: RequestContext,
  action: CommentAction,
  res: CommentResult,
  people: LibraryPerson[],
  mentions: Mention[],
) {
  if (!d.notifications) return;
  const reach = new Set(people.map((p) => p.id));
  const kinds = new Map<string, ItemKind>();
  const said = typeof action.body === "string" && action.body.trim() !== "";
  // A new thread tells no one but whom it mentions; a reply tells the thread's people.
  if (action.kind !== "open" && said) {
    for (const p of res.people.participants) kinds.set(p, "reply");
  }
  for (const m of mentions) if ("user" in m) kinds.set(m.user, "mention");
  // The person acting in the app is not told about their own comment; their agents' are news.
  const by = ctx.by;
  if (by?.person && !by.agent) kinds.delete(by.person);
  const thread = res.thread;
  const last = thread.comments[thread.comments.length - 1];
  const excerpt =
    said && last ? clip(last.body, 200) : action.kind === "resolve" ? "Resolved." : "Reopened.";
  const items: NewItem[] = [];
  for (const [user, kind] of kinds) {
    if (!reach.has(user)) continue;
    items.push({
      user,
      library: token.library.id,
      kind,
      place: `${token.library.owner}/${token.library.slug}`,
      path: thread.path,
      thread: thread.id,
      seq: res.seq,
      actor: ctx.actor,
      by_user: by?.person ?? null,
      excerpt,
      mail: MAILED.has(kind),
    });
  }
  await d.notifications.add(items);
}

// ---------------------------------------------------------------- after a content write

/** The content writes whose results carry a WriteNotice for the after-commit step. */
const NOTICED = ["apply", "import", "revert", "verify"] as const;

/**
 * The library's client as the routes and MCP tools use it: each content write, once committed,
 * goes through `afterWrite` (open items follow a moved page), and its notice is stripped from
 * what the caller sees. A failure there is logged, never an error on the write.
 */
export function notifying(
  d: NotifyDeps & RenderLintDeps,
  token: TokenInfo,
  lib: LibraryClient,
  waitUntil?: (p: Promise<unknown>) => void,
): LibraryClient {
  const out = { ...lib };
  for (const m of NOTICED) {
    const call = lib[m] as unknown as (
      ctx: RequestContext,
      ...rest: unknown[]
    ) => Promise<{
      seq: number;
      notify?: WriteNotice;
      render?: RenderJob[];
      results?: OpResult[];
      warnings?: ImportResult["warnings"];
    }>;
    (out as Record<string, unknown>)[m] = async (ctx: RequestContext, ...rest: unknown[]) => {
      const { notify, render, ...res } = await call(ctx, ...rest);
      // The diagrams it added or changed go to the render service (TEMPRA-167); what answers
      // within the budget is in this result, the rest lands in the library later.
      const rendered = render
        ? lintRenders(d, lib, render, renderContext(token), waitUntil)
        : Promise.resolve(null);
      if (notify) {
        try {
          await afterWrite(d, token, notify);
        } catch (e) {
          console.error(JSON.stringify({ notify_failed: ctx.request_id, error: String(e) }));
        }
      }
      const lint = await rendered;
      if (lint && res.results) res.results = mergeOpLint(res.results, lint);
      if (lint && res.warnings) res.warnings = mergeImportLint(res.warnings, lint);
      return res;
    };
  }
  return out;
}

/** Whom a write's renders are metered against: the account it counts against, its library. */
const renderContext = (token: TokenInfo) => {
  const { account, library } = tokenAdmission(token);
  return { account, library };
};

/**
 * After a content write commits: open items on a moved page follow it. Content writes tell no
 * one anything (TEMPRA-173): a page someone checked that changed shows so on the page.
 */
export async function afterWrite(
  d: NotifyDeps,
  token: TokenInfo,
  notice: WriteNotice,
): Promise<void> {
  if (d.notifications && notice.moved.length) {
    await d.notifications.closeAfterWrite(token.library.id, { moved: notice.moved });
  }
}
