import { bytesToHex, randomBytes } from "@noble/hashes/utils.js";
import type { Accounts, LibraryRef } from "./accounts";
import type { TokenInfo } from "./auth";
import type { LibraryClient } from "./client";
import type { CommentAction, CommentResult, Mention } from "./store/comments";
import type { RequestContext } from "./store/store";

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
 */

export type ItemKind = "reply" | "mention" | "thread" | "invitation" | "access" | "report";

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
  /** The inbox, newest first: open items, or with `all` read and done ones too; `before` is `next`. */
  inbox(
    user: string,
    opts?: { all?: boolean; before?: string; limit?: number },
  ): Promise<{ items: Item[]; next: string | null }>;
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
  const items = `SELECT id, library, kind, place, path, thread, seq, actor, excerpt, created, read_at, done_at FROM notifications`;
  return {
    async add(list) {
      if (list.length === 0) return;
      const now = new Date().toISOString();
      await db.batch(
        list.map((i) =>
          db
            .prepare(
              `INSERT INTO notifications (id, user, library, kind, place, path, thread, seq, actor, by_user, excerpt, created, mail)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(
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
            ),
        ),
      );
    },
    async inbox(user, opts = {}) {
      const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
      // Newest first by insertion order (items made in the same millisecond keep theirs).
      const before = Number(opts.before);
      const r = await db
        .prepare(
          `SELECT rowid AS n, ${items.slice("SELECT ".length)} WHERE user = ?
           ${opts.all ? "" : "AND done_at IS NULL"} ${before > 0 ? "AND rowid < ?" : ""}
           ORDER BY rowid DESC LIMIT ?`,
        )
        .bind(...[user, ...(before > 0 ? [before] : []), limit + 1])
        .all<Item & { n: number }>();
      const page = r.results.slice(0, limit).map(({ n: _, ...i }) => i);
      const last = r.results[limit - 1];
      return { items: page, next: r.results.length > limit && last ? String(last.n) : null };
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
 * from the comment's meta. A preview running the agent spike (TEMPRA-67) passes its own
 * (NotifyDeps.managedAgents).
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
  /** A library's managed agents; managedAgents() (none) unless a deployment runs one. */
  managedAgents?: (ref: Pick<LibraryRef, "id">) => { id: string; name: string }[];
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
  const agents = (d.managedAgents ?? managedAgents)(token.library);
  const mentions = body ? resolveMentions(body, people, agents) : [];
  const res = await lib.comment(ctx, { ...action, mentions });
  try {
    await fanOut(d, token, ctx, action, res, people, mentions);
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
