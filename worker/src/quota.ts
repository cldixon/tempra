/**
 * Monthly quotas per account (TEMPRA-232, tempra-dev: v2/limits, Monthly quotas): writes and
 * requests a UTC calendar month, and storage across the libraries an account owns, beside the
 * per-minute rate limits. Counted without a D1 write per request: each isolate keeps a tally per
 * account in memory and adds it to the account's AccountFeeds object at most every few seconds,
 * one call that answers the month's totals; checks read the last totals plus the isolate's own
 * tally, so most requests cost no I/O at all. Being a little over is fine. Free of Worker APIs;
 * tests run it on bun:sqlite.
 */
import type { TokenInfo } from "./auth";
import { grows, type LibraryClient, type LibraryMethod } from "./client";
import { WRITE_METHODS } from "./feed";
import { type Limits, limitsFrom } from "./limits";
import type { Mailer } from "./signin";
import { OkfError } from "./store/errors";
import type { SqlHandle } from "./store/sql";
import { tokenAdmission } from "./usage";

/** How often an isolate adds its tally to the account's object, at most. */
export const FLUSH_MS = 5_000;
/** How long an isolate keeps an account's limits and an owner's storage before reading again. */
export const REFRESH_MS = 60_000;
/** The person is told once a month at each of these, in percent of a quota. */
export const NOTICE_AT = [80, 100] as const;
/** How often a library records its storage in D1, at most. */
export const STORAGE_REPORT_MS = 60_000;

const MB = 1048576;

export type QuotaKind = "writes" | "requests" | "storage";

export interface Counts {
  writes: number;
  requests: number;
}

const zero = (): Counts => ({ writes: 0, requests: 0 });

/** The UTC calendar month a time falls in, as `YYYY-MM`. */
export const monthOf = (now: number): string => new Date(now).toISOString().slice(0, 7);

/** When a month's counts start again: the first of the next month, 00:00 UTC. */
export function monthResets(month: string): Date {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 1));
}

/** "1 December 2026": how people read when a quota resets. */
export const resetDay = (month: string): string =>
  monthResets(month).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

// ---------------------------------------------------------------- the account's object

/**
 * The month's counts and the notices sent, in the account's AccountFeeds object's SQLite. Months
 * before the last are dropped as a new one starts.
 */
export class QuotaCounter {
  constructor(private readonly sql: SqlHandle) {
    sql.script(
      `CREATE TABLE IF NOT EXISTS quota_months (month TEXT PRIMARY KEY, writes INTEGER NOT NULL, requests INTEGER NOT NULL);
       CREATE TABLE IF NOT EXISTS quota_notices (month TEXT NOT NULL, key TEXT NOT NULL, PRIMARY KEY (month, key));`,
    );
  }

  /** Adds a tally to the month and answers its totals. */
  add(month: string, add: Counts): Counts {
    const writes = Math.max(0, Math.floor(add.writes));
    const requests = Math.max(0, Math.floor(add.requests));
    if (writes || requests) {
      if (this.sql.all("SELECT 1 FROM quota_months WHERE month = ?", month).length === 0) {
        // A new month: the one before it stays for the Account page's sake, older ones go.
        this.sql.run("DELETE FROM quota_months WHERE month < ?", previousMonth(month));
        this.sql.run("DELETE FROM quota_notices WHERE month < ?", month);
      }
      this.sql.run(
        `INSERT INTO quota_months (month, writes, requests) VALUES (?, ?, ?)
         ON CONFLICT (month) DO UPDATE SET writes = writes + excluded.writes,
                                           requests = requests + excluded.requests`,
        month,
        writes,
        requests,
      );
    }
    return this.get(month);
  }

  get(month: string): Counts {
    const row = this.sql.all<Counts>(
      "SELECT writes, requests FROM quota_months WHERE month = ?",
      month,
    )[0];
    return row ? { writes: row.writes, requests: row.requests } : zero();
  }

  /** Records notices as sent; answers those not sent before, so each goes once a month. */
  mark(month: string, keys: string[]): string[] {
    const fresh: string[] = [];
    for (const key of new Set(keys)) {
      if (
        this.sql.all("SELECT 1 FROM quota_notices WHERE month = ? AND key = ?", month, key).length
      )
        continue;
      this.sql.run("INSERT INTO quota_notices (month, key) VALUES (?, ?)", month, key);
      fresh.push(key);
    }
    return fresh;
  }
}

function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return monthOf(Date.UTC(y, m - 2, 1));
}

// ---------------------------------------------------------------- the Worker's side

/** An account as the quotas see it. */
export interface QuotaAccount {
  handle: string;
  email: string;
  limits: Limits;
  /** The sum of its libraries' recorded storage. */
  storageBytes: number;
}

/** What the quotas need: the account's object, D1 and mail. */
export interface QuotaBackend {
  /** Adds a tally to the account's month (in its object) and answers the month's totals. */
  add(account: string, month: string, add: Counts): Promise<Counts>;
  /** Records notices as sent (in the account's object); answers those not sent before. */
  mark(account: string, month: string, keys: string[]): Promise<string[]>;
  /** The account by handle; null for none (a token from before handles: no quotas). */
  account(handle: string): Promise<QuotaAccount | null>;
  /** The account that owns a library. */
  owner(libraryId: string): Promise<QuotaAccount | null>;
  mail(msg: { to: string; subject: string; text: string }): Promise<void>;
}

interface Tally {
  month: string;
  /** Counted here since the last flush. */
  pending: Counts;
  /** The month's totals as the account's object last answered. */
  totals: Counts;
  account: QuotaAccount | null;
  loadedAt: number;
  flushedAt: number;
  /** Notices this isolate knows were sent this month. */
  marked: Set<string>;
  busy: Promise<void> | null;
}

/** This month's usage against the quotas, for the Account page and the admin script. */
export interface QuotaUsage {
  month: string;
  /** When the month's counts start again (ISO). */
  resets: string;
  writes: { used: number; limit: number };
  requests: { used: number; limit: number };
  storage: { used: number; limit: number };
}

export class Quota {
  private readonly tallies = new Map<string, Tally>();
  private readonly owners = new Map<
    string,
    { at: number; owner: QuotaAccount | null; busy?: Promise<void> }
  >();
  private readonly now: () => number;
  private readonly flushMs: number;
  private readonly refreshMs: number;
  /** The app's origin, for the mail's link to the Account page. */
  private readonly origin: string;

  constructor(
    private readonly b: QuotaBackend,
    opts: { origin?: string; now?: () => number; flushMs?: number; refreshMs?: number } = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.flushMs = opts.flushMs ?? FLUSH_MS;
    this.refreshMs = opts.refreshMs ?? REFRESH_MS;
    this.origin = opts.origin ?? "";
  }

  private tally(account: string): Tally {
    const month = monthOf(this.now());
    let t = this.tallies.get(account);
    if (!t) {
      t = {
        month,
        pending: zero(),
        totals: zero(),
        account: null,
        loadedAt: 0,
        flushedAt: 0,
        marked: new Set(),
        busy: null,
      };
      this.tallies.set(account, t);
    } else if (t.month !== month) {
      // A new month: what this isolate held of the last one (a few seconds) is let go.
      t.month = month;
      t.pending = zero();
      t.totals = zero();
      t.marked = new Set();
      t.flushedAt = 0;
    }
    return t;
  }

  /**
   * Counts one request (and its write) against the account: in memory, adding the tally to the
   * account's object when the last flush is older than FLUSH_MS. Never throws.
   */
  async count(account: string, write: boolean): Promise<void> {
    const t = this.tally(account);
    t.pending.requests++;
    if (write) t.pending.writes++;
    if (this.now() - t.flushedAt >= this.flushMs) await this.flush(account, t);
  }

  private flush(account: string, t: Tally): Promise<void> {
    if (t.busy) return t.busy;
    const run = async () => {
      const now = this.now();
      t.flushedAt = now;
      if (!t.loadedAt || now - t.loadedAt >= this.refreshMs) {
        t.account = await this.b.account(account);
        t.loadedAt = now;
      }
      // No such account (a token from before handles): no quotas, and no object for it.
      if (!t.account) {
        t.pending = zero();
        return;
      }
      const month = t.month;
      const add = t.pending;
      t.pending = zero();
      try {
        const totals = await this.b.add(account, month, add);
        if (t.month === month) t.totals = totals;
      } catch (e) {
        // Kept for the next flush; the check goes on from what it knew.
        if (t.month === month) {
          t.pending.writes += add.writes;
          t.pending.requests += add.requests;
        }
        throw e;
      }
      await this.notify(account, t.account, month, t.marked, {
        writes: this.used(t, "writes"),
        requests: this.used(t, "requests"),
      });
    };
    t.busy = run()
      .catch((e) =>
        console.error(JSON.stringify({ quota_flush_failed: account, error: String(e) })),
      )
      .finally(() => {
        t.busy = null;
      });
    return t.busy;
  }

  private used(t: Tally, kind: "writes" | "requests"): number {
    return t.totals[kind] + t.pending[kind];
  }

  /**
   * 403 `quota_reached` when the account is over its monthly writes or requests. The request
   * being checked is already counted, so a quota of n lets n through.
   */
  async checkWrite(account: string): Promise<void> {
    const t = this.tally(account);
    if (!t.loadedAt) await this.flush(account, t);
    const a = t.account;
    if (!a) return;
    if (this.used(t, "writes") > a.limits.writes_month) {
      throw quotaReached("writes", a.limits.writes_month, t.month);
    }
    if (this.used(t, "requests") > a.limits.requests_month) {
      throw quotaReached("requests", a.limits.requests_month, t.month);
    }
  }

  /** 403 `quota_reached` when the library's owner is at their storage across libraries. */
  async checkStorage(libraryId: string): Promise<void> {
    let o = this.owners.get(libraryId);
    if (!o || this.now() - o.at >= this.refreshMs) {
      const entry = o ?? { at: 0, owner: null };
      this.owners.set(libraryId, entry);
      entry.busy ??= (async () => {
        try {
          entry.owner = await this.b.owner(libraryId);
          entry.at = this.now();
          const owner = entry.owner;
          if (owner) {
            const month = monthOf(this.now());
            await this.notify(owner.handle, owner, month, this.tally(owner.handle).marked, {
              storage: owner.storageBytes,
            });
          }
        } catch (e) {
          console.error(JSON.stringify({ quota_storage_failed: libraryId, error: String(e) }));
        } finally {
          entry.busy = undefined;
        }
      })();
      await entry.busy;
      o = entry;
    }
    const owner = o.owner;
    if (owner && owner.storageBytes >= owner.limits.storage_mb * MB) {
      throw quotaReached("storage", owner.limits.storage_mb, monthOf(this.now()));
    }
  }

  /** This month's usage against the quotas, read fresh; null for no such account. */
  async usage(handle: string): Promise<QuotaUsage | null> {
    const a = await this.b.account(handle);
    if (!a) return null;
    const month = monthOf(this.now());
    const t = this.tally(handle);
    const totals = await this.b.add(handle, month, t.pending);
    t.pending = zero();
    t.totals = totals;
    t.account = a;
    t.loadedAt = this.now();
    t.flushedAt = this.now();
    return {
      month,
      resets: monthResets(month).toISOString(),
      writes: { used: totals.writes, limit: a.limits.writes_month },
      requests: { used: totals.requests, limit: a.limits.requests_month },
      storage: { used: a.storageBytes, limit: a.limits.storage_mb * MB },
    };
  }

  /**
   * Mails the account's person once a month at 80% and at 100% of a quota (tempra-dev:
   * v2/limits, Telling the person). The object records what was sent, so each notice goes once
   * however many isolates see the line crossed; only the highest one crossed is mailed.
   */
  private async notify(
    handle: string,
    a: QuotaAccount,
    month: string,
    marked: Set<string>,
    used: Partial<Record<QuotaKind, number>>,
  ): Promise<void> {
    const due: { kind: QuotaKind; pct: number; key: string }[] = [];
    for (const kind of Object.keys(used) as QuotaKind[]) {
      const limit = limitOf(a.limits, kind);
      const n = used[kind] ?? 0;
      for (const pct of NOTICE_AT) {
        const key = `${kind}:${pct}`;
        if (!marked.has(key) && limit > 0 && n * 100 >= limit * pct) due.push({ kind, pct, key });
      }
    }
    if (due.length === 0) return;
    const fresh = new Set(
      await this.b.mark(
        handle,
        month,
        due.map((d) => d.key),
      ),
    );
    for (const d of due) marked.add(d.key);
    for (const kind of new Set(due.map((d) => d.kind))) {
      const top = due.filter((d) => d.kind === kind && fresh.has(d.key)).at(-1);
      if (!top) continue;
      const msg = quotaMail(kind, top.pct, limitOf(a.limits, kind), month, this.origin);
      await this.b
        .mail({ to: a.email, ...msg })
        .catch((e) =>
          console.error(JSON.stringify({ quota_mail_failed: handle, error: String(e) })),
        );
    }
  }
}

function limitOf(limits: Limits, kind: QuotaKind): number {
  if (kind === "writes") return limits.writes_month;
  if (kind === "requests") return limits.requests_month;
  return limits.storage_mb * MB;
}

const num = (n: number) => n.toLocaleString("en-US");

/** What each quota is called where people read it. */
const NAMES: Record<QuotaKind, string> = {
  writes: "writes",
  requests: "tool calls and API requests",
  storage: "storage",
};

function limitText(kind: QuotaKind, limit: number): string {
  return kind === "storage" ? `${num(limit)} MB of storage` : `${num(limit)} ${NAMES[kind]}`;
}

export function quotaReached(kind: QuotaKind, limit: number, month: string): OkfError {
  const resets = monthResets(month).toISOString();
  const when =
    kind === "storage"
      ? "Delete or move content to free space, or ask for more."
      : `Writes resume on ${resetDay(month)} (UTC), or ask for more.`;
  return new OkfError(
    403,
    "quota_reached",
    `This account has reached its ${kind === "storage" ? "" : "monthly "}limit of ${limitText(kind, limit)}. Reading keeps working; writing does not. ${when}`,
    kind === "storage" ? { quota: kind, limit } : { quota: kind, limit, resets },
  );
}

/** The mail at 80% or 100% of a quota. */
export function quotaMail(
  kind: QuotaKind,
  pct: number,
  limit: number,
  month: string,
  origin: string,
): { subject: string; text: string } {
  const what = kind === "storage" ? "storage" : `monthly ${NAMES[kind]}`;
  const subject =
    pct >= 100
      ? `Your Tempra account has reached its ${what} limit`
      : `Your Tempra account has used ${pct}% of its ${what}`;
  const state =
    pct >= 100
      ? `Your account has reached its limit of ${limitText(kind, limit)}${kind === "storage" ? "" : " this month"}. Your agents can still read, but their writes are refused`
      : `Your account has used ${pct}% of its limit of ${limitText(kind, limit)}${kind === "storage" ? "" : " this month"}. At the limit, your agents can still read, but their writes are refused`;
  const until =
    kind === "storage"
      ? " until content is deleted or moved."
      : ` until ${resetDay(month)} (UTC), when the month starts again.`;
  const text = [
    `${state}${until}`,
    "",
    "If one of your agents is stuck in a loop, stop it.",
    "",
    `This month's usage: ${origin}/account#usage`,
  ].join("\n");
  return { subject, text };
}

/**
 * The library's client with the quotas in front of its writes: an agent's writes are refused
 * when the account it acts for is over its monthly writes or requests, and anything that adds
 * when the library's owner is at their storage. A person in the app is not held to the monthly
 * counts (as with the per-minute limits), only to storage. Reads pass straight through.
 */
export function quotaGuarded(
  quota: Quota | undefined,
  token: TokenInfo,
  lib: LibraryClient,
): LibraryClient {
  if (!quota) return lib;
  const agent = !token.id.startsWith("session:");
  const { account } = tokenAdmission(token);
  const out = { ...lib };
  for (const m of WRITE_METHODS as Set<LibraryMethod>) {
    const call = lib[m] as unknown as (...a: unknown[]) => Promise<unknown>;
    (out as Record<string, unknown>)[m] = async (...args: unknown[]) => {
      if (agent) await quota.checkWrite(account);
      // The store's methods take the request context first, then the method's own arguments.
      if (grows(m, args)) await quota.checkStorage(token.library.id);
      return call(...args);
    };
  }
  return out;
}

// ---------------------------------------------------------------- D1

/** The account's quota facts from D1: its limits, email and its libraries' storage. */
export function d1QuotaAccounts(db: D1Database) {
  const pick = async (where: string, value: string): Promise<QuotaAccount | null> => {
    const row = await db
      .prepare(
        `SELECT u.handle, u.email, u.limits,
                (SELECT COALESCE(SUM(storage_bytes), 0) FROM libraries WHERE owner = u.id) AS storage
           FROM users u WHERE ${where}`,
      )
      .bind(value)
      .first<{ handle: string; email: string; limits: string | null; storage: number }>();
    if (!row?.handle) return null;
    return {
      handle: row.handle,
      email: row.email,
      limits: limitsFrom(row.limits),
      storageBytes: row.storage ?? 0,
    };
  };
  return {
    account: (handle: string) => pick("u.handle = ?", handle),
    owner: (libraryId: string) =>
      pick("u.id = (SELECT owner FROM libraries WHERE id = ?)", libraryId),
  };
}

/** The account's object as the quotas call it (AccountFeeds, or a QuotaCounter in tests). */
export interface QuotaCounterStub {
  quotaAdd(month: string, add: Counts): Promise<Counts>;
  quotaMark(month: string, keys: string[]): Promise<string[]>;
}

/** The backend from D1, the account's object (by handle) and the mailer (none: no mail). */
export function quotaBackend(
  db: D1Database,
  counter: (account: string) => QuotaCounterStub,
  mailer: Mailer | null,
): QuotaBackend {
  const accounts = d1QuotaAccounts(db);
  return {
    add: (account, month, add) => counter(account).quotaAdd(month, add),
    mark: (account, month, keys) => counter(account).quotaMark(month, keys),
    account: accounts.account,
    owner: accounts.owner,
    mail: async (msg) => {
      await mailer?.send(msg);
    },
  };
}

/** A library's storage, recorded by its object (STORAGE_REPORT_MS apart at most). */
export async function recordStorage(db: D1Database, doId: string, bytes: number): Promise<void> {
  await db
    .prepare("UPDATE libraries SET storage_bytes = ? WHERE do_id = ?")
    .bind(Math.max(0, Math.round(bytes)), doId)
    .run();
}

/**
 * Throttles a library's storage reports: the first write's at once, then at most one a
 * STORAGE_REPORT_MS, the last always sent, so D1 sees a write a minute at most from a busy library.
 */
export class StorageReport {
  private at = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly record: (bytes: number) => Promise<void>,
    private readonly now: () => number = Date.now,
  ) {}

  changed(bytes: () => number): void {
    if (this.timer) return;
    const wait = Math.max(0, this.at + STORAGE_REPORT_MS - this.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      this.at = this.now();
      try {
        this.record(bytes()).catch((e) => console.error("storage not recorded", e));
      } catch (e) {
        console.error("storage not recorded", e);
      }
    }, wait);
  }
}
