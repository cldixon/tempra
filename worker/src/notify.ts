import { bytesToHex, randomBytes } from "@noble/hashes/utils.js";
import type { Accounts, LibraryRef } from "./accounts";
import type { TokenInfo } from "./auth";
import type { LibraryClient } from "./client";
import type { CommentAction, CommentResult, Mention } from "./store/comments";
import type { RequestContext, StaleConcept, WriteNotice } from "./store/store";

/**
 * Notifications (TEMPRA-58 design, TEMPRA-72, TEMPRA-73): items addressed to one person are
 * fanned out into D1 by the Worker once a write has committed in the library, so the inbox, its
 * unread count and each library's "for you" count are one D1 query, never a call to every
 * library the person reaches. General activity is never an item: it is counted from each
 * library's ledger after the person's cursor ("seen up to seq N", here too).
 *
 * Who is told: a reply goes to everyone who opened or wrote in the thread, a new thread to the
 * people who wrote or verified the concept, a mention to the person mentioned; never to the
 * person who acted in the app themselves (their agents acting for them do notify them), and
 * only to people who can reach the library at that moment.
 *
 * Take 4 (TEMPRA-116) adds two keyed kinds, so the Inbox holds what Needs you did: `verify`, from
 * the content write path after it commits (a concept the person verified changed since), and
 * `stale`, from each library's daily maintainer (a concept stale or going stale within 14 days,
 * to the owner and write members). Items are also closed by what resolves them: a verification,
 * a new `stale_after` or a delete, a resolved thread.
 */

export type ItemKind =
  | "reply"
  | "mention"
  | "thread"
  | "invitation"
  | "access"
  | "report"
  | "verify"
  | "stale";

/** Kinds that are mailed at once (batched): the ones addressed to the person. */
export const MAILED: ReadonlySet<ItemKind> = new Set(["reply", "mention", "thread", "access"]);

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
   * `verify` and `stale`: one open item per (user, library, key); another add updates it (its
   * excerpt, time and count, unread again) instead of adding a row. A `stale` item is updated or
   * made again only for a new `due`, so the daily run never undoes a dismissal or a read.
   */
  key?: string | null;
  title?: string | null;
  by_agent?: string | null;
  count?: number | null;
  due?: string | null;
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
  due: string | null;
}

/** What resolves items in a library after a write (TEMPRA-116): see `closeAfterWrite`. */
export interface Closes {
  /** Verified by a person: the page's open `verify` items, for everyone. */
  verified: string[];
  /** Changed: its open `stale` items whose `due` is not its new `stale_after`; deleted: all. */
  changed: { path: string; stale_after: string | null; deleted: boolean }[];
  /** Moved: open items on the old path follow the page. */
  moved: { from: string; to: string }[];
}

/** An account's mail settings; a library's override is null where it follows the account. */
export interface Prefs {
  immediate: boolean;
  digest: boolean;
  libraries: { library: string; immediate: boolean | null; digest: boolean | null }[];
}

/** Defaults: mail what is addressed to me at once; the digest is opt-in. */
export const DEFAULT_PREFS = { immediate: true, digest: false };

/** Notification mails a person gets a day, at most (immediate batches and the digest). */
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
  /** Closes what a committed write resolved in a library (TEMPRA-116). */
  closeAfterWrite(library: string, closes: Closes): Promise<void>;
  /** Closes a resolved thread's reply, thread and mention items, for everyone. */
  closeThread(library: string, thread: string): Promise<void>;
  /** Unread items, in all and per library. */
  unread(user: string): Promise<{ total: number; libraries: Record<string, number> }>;
  /** Marks items read: these ids, a library's, or all; returns how many changed. */
  markRead(user: string, which: { ids?: string[]; library?: string }): Promise<number>;
  /** Marks an item done (and read); false when it is not the person's. */
  markDone(user: string, id: string, done?: boolean): Promise<boolean>;
  /** Marks done every item of a kind from a place ({owner}/{slug}): an answered invitation. */
  settle(user: string, kind: ItemKind, place: string): Promise<void>;
  /** The person's cursors, by library id. */
  seen(user: string): Promise<Record<string, number>>;
  /** Moves a cursor forward (never back). */
  setSeen(user: string, library: string, seq: number): Promise<number>;
  prefs(user: string): Promise<Prefs>;
  /** Sets the account's settings (library "") or a library's override (null follows the account). */
  setPrefs(
    user: string,
    library: string,
    set: { immediate?: boolean | null; digest?: boolean | null },
  ): Promise<void>;
  /** The account's one-click unsubscribe key, made on first use. */
  unsubscribeKey(user: string): Promise<string>;
  /** Turns all notification mail off for the key's account; its user, or null for no such key. */
  unsubscribe(key: string): Promise<string | null>;
  /** People with mail waiting: their pending items, oldest first. */
  pendingMail(): Promise<{ user: string; items: (Item & { user: string })[] }[]>;
  setMail(ids: string[], state: "sent" | "skipped"): Promise<void>;
  /** Takes one of the day's mails for the person; false when they are at the cap. */
  takeMailSlot(user: string, day: string, cap?: number): Promise<boolean>;
  /** Accounts with the digest on, for their account or any library. */
  digestUsers(): Promise<string[]>;
  setDigestAt(user: string, at: string): Promise<void>;
  digestAt(user: string): Promise<string | null>;
  recordFailure(day: string): Promise<void>;
  failures(day: string): Promise<number>;
}

const bool = (v: number | null | undefined) => (v === null || v === undefined ? null : v === 1);
const flag = (v: boolean | null | undefined) => (v === null || v === undefined ? null : v ? 1 : 0);

export function d1Notifications(db: D1Database): Notifications {
  const items = `SELECT id, library, kind, place, path, thread, seq, actor, excerpt, created, read_at, done_at, title, by_user, by_agent, count, due FROM notifications`;
  const COLS =
    "id, user, library, kind, place, path, thread, seq, actor, by_user, excerpt, created, mail, key, title, by_agent, count, due";
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
        i.due ?? null,
      ];
      const statement = (i: NewItem) => {
        if (!i.key) {
          return db
            .prepare(`INSERT INTO notifications (${COLS}) VALUES (${MARKS})`)
            .bind(...values(i));
        }
        // Keyed: the open item with this key is updated rather than a second row added. A stale
        // item is made or updated only for a new `due`: one already dismissed or read for this
        // `due` stays as the person left it.
        const stale = i.kind === "stale";
        const dismissed = `NOT EXISTS (SELECT 1 FROM notifications d WHERE d.user = ?2
          AND d.library IS ?3 AND d.key = ?14 AND d.due IS ?18 AND d.done_at IS NOT NULL)`;
        return db
          .prepare(
            `INSERT INTO notifications (${COLS}) SELECT ${MARKS} WHERE ${stale ? dismissed : "1"}
             ON CONFLICT (user, library, key) WHERE key IS NOT NULL AND done_at IS NULL
             DO UPDATE SET excerpt = excluded.excerpt, created = excluded.created, read_at = NULL,
               seq = excluded.seq, actor = excluded.actor, by_user = excluded.by_user,
               by_agent = excluded.by_agent, title = excluded.title, count = excluded.count,
               due = excluded.due
             ${stale ? "WHERE notifications.due IS NOT excluded.due" : ""}`,
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
      for (const path of closes.verified) {
        stmts.push(
          db
            .prepare(`UPDATE notifications SET ${done} WHERE ${open} AND kind = 'verify'`)
            .bind(now, library, path),
        );
      }
      for (const c of closes.changed) {
        stmts.push(
          c.deleted
            ? db
                .prepare(
                  `UPDATE notifications SET ${done} WHERE ${open} AND kind IN ('verify', 'stale')`,
                )
                .bind(now, library, c.path)
            : db
                .prepare(
                  `UPDATE notifications SET ${done} WHERE ${open} AND kind = 'stale' AND due IS NOT ?4`,
                )
                .bind(now, library, c.path, c.stale_after),
        );
      }
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
             AND kind IN ('reply', 'thread', 'mention')`,
        )
        .bind(now, library, thread)
        .run();
    },
    async unread(user) {
      const r = await db
        .prepare(
          `SELECT COALESCE(library, '') AS library, COUNT(*) AS n FROM notifications
           WHERE user = ? AND read_at IS NULL AND done_at IS NULL GROUP BY library`,
        )
        .bind(user)
        .all<{ library: string; n: number }>();
      const libraries: Record<string, number> = {};
      let total = 0;
      for (const row of r.results) {
        total += row.n;
        if (row.library) libraries[row.library] = row.n;
      }
      return { total, libraries };
    },
    async markRead(user, which) {
      const now = new Date().toISOString();
      const ids = (which.ids ?? []).slice(0, 200);
      const where = which.ids
        ? `id IN (${ids.map(() => "?").join(", ") || "''"})`
        : which.library
          ? "library = ?"
          : "1 = 1";
      const r = await db
        .prepare(
          `UPDATE notifications SET read_at = ? WHERE user = ? AND read_at IS NULL AND ${where}`,
        )
        .bind(now, user, ...(which.ids ? ids : which.library ? [which.library] : []))
        .run();
      return r.meta.changes ?? 0;
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
    async seen(user) {
      const r = await db
        .prepare("SELECT library, seq FROM library_seen WHERE user = ?")
        .bind(user)
        .all<{ library: string; seq: number }>();
      return Object.fromEntries(r.results.map((x) => [x.library, x.seq]));
    },
    async setSeen(user, library, seq) {
      const n = Math.max(0, Math.floor(seq));
      await db
        .prepare(
          `INSERT INTO library_seen (user, library, seq, updated) VALUES (?1, ?2, ?3, ?4)
           ON CONFLICT (user, library) DO UPDATE SET seq = MAX(seq, ?3), updated = ?4`,
        )
        .bind(user, library, n, new Date().toISOString())
        .run();
      const row = await db
        .prepare("SELECT seq FROM library_seen WHERE user = ? AND library = ?")
        .bind(user, library)
        .first<{ seq: number }>();
      return row?.seq ?? n;
    },
    async prefs(user) {
      const r = await db
        .prepare("SELECT library, immediate, digest FROM notification_prefs WHERE user = ?")
        .bind(user)
        .all<{ library: string; immediate: number | null; digest: number | null }>();
      const account = r.results.find((x) => x.library === "");
      return {
        immediate: bool(account?.immediate) ?? DEFAULT_PREFS.immediate,
        digest: bool(account?.digest) ?? DEFAULT_PREFS.digest,
        libraries: r.results
          .filter((x) => x.library !== "" && (x.immediate !== null || x.digest !== null))
          .map((x) => ({
            library: x.library,
            immediate: bool(x.immediate),
            digest: bool(x.digest),
          })),
      };
    },
    async setPrefs(user, library, set) {
      const cols: string[] = [];
      const vals: (number | null)[] = [];
      for (const k of ["immediate", "digest"] as const) {
        if (set[k] === undefined) continue;
        // The account's own settings are never "follow"; a library's may be.
        if (library === "" && set[k] === null) continue;
        cols.push(k);
        vals.push(flag(set[k]));
      }
      if (cols.length === 0) return;
      await db
        .prepare(
          `INSERT INTO notification_prefs (user, library, ${cols.join(", ")}) VALUES (?, ?, ${cols.map(() => "?").join(", ")})
           ON CONFLICT (user, library) DO UPDATE SET ${cols.map((c) => `${c} = excluded.${c}`).join(", ")}`,
        )
        .bind(user, library, ...vals)
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
      // Every library's override goes too: one click means no more notification mail.
      await db.batch([
        db
          .prepare(
            "UPDATE notification_prefs SET immediate = 0, digest = 0 WHERE user = ? AND library = ''",
          )
          .bind(row.user),
        db
          .prepare(
            "UPDATE notification_prefs SET immediate = NULL, digest = NULL WHERE user = ? AND library != ''",
          )
          .bind(row.user),
      ]);
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
    async digestUsers() {
      const r = await db
        .prepare(
          `SELECT DISTINCT p.user FROM notification_prefs p JOIN users u ON u.id = p.user
           WHERE p.digest = 1 AND u.suspended IS NULL`,
        )
        .all<{ user: string }>();
      return r.results.map((x) => x.user);
    },
    async setDigestAt(user, at) {
      await db
        .prepare(
          `INSERT INTO notification_prefs (user, library, digest_at) VALUES (?, '', ?)
           ON CONFLICT (user, library) DO UPDATE SET digest_at = excluded.digest_at`,
        )
        .bind(user, at)
        .run();
    },
    async digestAt(user) {
      const row = await db
        .prepare("SELECT digest_at FROM notification_prefs WHERE user = ? AND library = ''")
        .bind(user)
        .first<{ digest_at: string | null }>();
      return row?.digest_at ?? null;
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
 * A library's managed agents, by the name a comment mentions them with. None exist yet: the
 * managed agent (TEMPRA-69) adds itself here, and its comment trigger reads `{agent}` mentions
 * from the comment's meta.
 */
export function managedAgents(_ref: Pick<LibraryRef, "id">): { id: string; name: string }[] {
  return [];
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
  const mentions = body ? resolveMentions(body, people, managedAgents(token.library)) : [];
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
  return res;
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
  if (action.kind === "open") {
    for (const p of res.people.writers) kinds.set(p, "thread");
  } else if (said) {
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

// ---------------------------------------------------------------- verify and stale (TEMPRA-116)

/** The content writes whose results carry a WriteNotice for the after-commit step. */
const NOTICED = ["apply", "import", "revert", "verify"] as const;

/**
 * The library's client as the routes and MCP tools use it: each content write, once committed,
 * goes through `afterWrite` (verify items, and the closes it resolves), and its notice is
 * stripped from what the caller sees. A failure there is logged, never an error on the write.
 */
export function notifying(d: NotifyDeps, token: TokenInfo, lib: LibraryClient): LibraryClient {
  const out = { ...lib };
  for (const m of NOTICED) {
    const call = lib[m] as unknown as (
      ctx: RequestContext,
      ...rest: unknown[]
    ) => Promise<{ seq: number; notify?: WriteNotice }>;
    (out as Record<string, unknown>)[m] = async (ctx: RequestContext, ...rest: unknown[]) => {
      const { notify, ...res } = await call(ctx, ...rest);
      if (notify) {
        try {
          await afterWrite(d, token, ctx, res.seq, notify);
        } catch (e) {
          console.error(JSON.stringify({ notify_failed: ctx.request_id, error: String(e) }));
        }
      }
      return res;
    };
  }
  return out;
}

/** "3 edits since you verified". */
export const editsSince = (n: number) => `${n} ${n === 1 ? "edit" : "edits"} since you verified`;

/**
 * After a content write commits: a `verify` item for each person whose verification it
 * superseded (keyed, so a repeated edit updates the one item), never for the person acting in
 * the app themselves and only for people who reach the library now; then the closes the write
 * resolves (a verification, a new `stale_after`, a delete, a move).
 */
export async function afterWrite(
  d: NotifyDeps,
  token: TokenInfo,
  ctx: RequestContext,
  seq: number,
  notice: WriteNotice,
): Promise<void> {
  const n = d.notifications;
  if (!n) return;
  const ref = token.library;
  const items: NewItem[] = [];
  if (notice.changed.some((c) => c.verifiers.length > 0)) {
    const people = await libraryPeople(d.accounts, ref);
    const byId = new Set(people.map((p) => p.id));
    const byHandle = new Map(people.map((p) => [`human:${p.handle}`, p.id]));
    const self = ctx.by?.person && !ctx.by.agent ? ctx.by.person : null;
    for (const c of notice.changed) {
      for (const v of c.verifiers) {
        const user = v.person && byId.has(v.person) ? v.person : byHandle.get(v.actor);
        if (!user || user === self) continue;
        items.push({
          user,
          library: ref.id,
          kind: "verify",
          place: `${ref.owner}/${ref.slug}`,
          path: c.path,
          seq,
          actor: ctx.actor,
          by_user: ctx.by?.person ?? null,
          by_agent: ctx.by?.agent ?? null,
          excerpt: editsSince(v.changes),
          key: `verify:${c.path}`,
          title: c.title,
          count: v.changes,
        });
      }
    }
  }
  await n.add(items);
  const closes: Closes = {
    verified: notice.verified.map((v) => v.path),
    changed: notice.changed.map(({ path, stale_after, deleted }) => ({
      path,
      stale_after,
      deleted,
    })),
    moved: notice.moved,
  };
  if (closes.verified.length || closes.changed.length || closes.moved.length) {
    await n.closeAfterWrite(ref.id, closes);
  }
}

/** The actor stale items are made by: the staleness process (TEMPRA-63). */
export const STALENESS_ACTOR = "process:staleness";

/**
 * The daily `stale` items (TEMPRA-116), handed over by a library's maintainer (maintain.ts) once
 * a pass has flagged its concepts: one item per concept stale or going stale within 14 days, to
 * the owner and each write member (the people who can ask an agent to refresh it), keyed so the
 * next pass changes nothing unless the concept's `stale_after` did. Returns how many it handed.
 */
export async function notifyStale(
  d: { accounts: Accounts; notifications: Notifications },
  doId: string,
  concepts: StaleConcept[],
): Promise<number> {
  if (concepts.length === 0) return 0;
  const ref = await d.accounts.libraryByDoId(doId);
  if (!ref) return 0;
  const members = await d.accounts.members(ref.id);
  const people = [ref.ownerId, ...members.filter((m) => m.role === "write").map((m) => m.user)];
  const items: NewItem[] = people.flatMap((user) =>
    concepts.map((c) => ({
      user,
      library: ref.id,
      kind: "stale" as const,
      place: `${ref.owner}/${ref.slug}`,
      path: c.path,
      actor: STALENESS_ACTOR,
      excerpt: c.stale === "stale" ? "Stale" : "Going stale",
      key: `stale:${c.path}`,
      title: c.title,
      due: c.stale_after,
    })),
  );
  for (let i = 0; i < items.length; i += 100) await d.notifications.add(items.slice(i, i + 100));
  return items.length;
}
