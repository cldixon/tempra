import { DurableObject } from "cloudflare:workers";
import { FeedLeases, type Lease } from "./feed-leases";
import type { Library } from "./library";
import { type Counts, QuotaCounter } from "./quota";
import { doSqlHandle } from "./store/sql";

/**
 * One per account, by name (TEMPRA-80): the leases on the account's open change-feed sockets
 * across all its libraries, so the Worker can cap them (feed-leases.ts). No sockets live here;
 * the object is asked once per connect and sleeps otherwise. It also keeps the account's monthly
 * quota counts (TEMPRA-232, quota.ts), which each Worker isolate adds its tally to every few
 * seconds at most.
 */
export class AccountFeeds extends DurableObject<Env> {
  private readonly leases = new FeedLeases(doSqlHandle(this.ctx.storage));
  private readonly quota = new QuotaCounter(doSqlHandle(this.ctx.storage));
  /** Acquires run one at a time, so two connects at the cap cannot both take the last place. */
  private queue: Promise<unknown> = Promise.resolve();

  async acquire(lease: Lease, cap: number): Promise<boolean> {
    const ns = this.env.LIBRARY as DurableObjectNamespace<Library>;
    const run = this.queue.then(() =>
      this.leases.acquire(lease, cap, (doId) => ns.get(ns.idFromName(doId)).feedLeases()),
    );
    this.queue = run.catch(() => {});
    return run;
  }

  /** Adds an isolate's tally to the month and answers the month's totals (quota.ts). */
  async quotaAdd(month: string, add: Counts): Promise<Counts> {
    return this.quota.add(month, add);
  }

  /** Records quota notices as sent; answers those not sent before. */
  async quotaMark(month: string, keys: string[]): Promise<string[]> {
    return this.quota.mark(month, keys);
  }
}
