import { describe, expect, test } from "bun:test";
import config, { previewDeployment } from "../cloudflare.config";
import {
  backoffSeconds,
  CLAIM_STALE_MS,
  d1SentLog,
  handleMailMessage,
  MAIL_ATTEMPTS,
  type MailConsumerDeps,
  type MailJob,
  permanentFailure,
  sendNow,
} from "../src/mail-queue";
import { flushMail, QUIET_MS } from "../src/notify-mail";
import type { Mailer } from "../src/signin";
import { pruneAccounts } from "../src/sweep";
import { bunD1 } from "./d1";
import { API, LIB, ORIGIN, OWNER, setup } from "./harness";

/** Outgoing mail through MAIL_QUEUE (TEMPRA-89; tempra-dev: decisions/mail-through-a-queue). */

type Sent = Parameters<Mailer["send"]>[0];

const job = (over: Partial<MailJob> = {}): MailJob => ({
  v: 1,
  queued: new Date().toISOString(),
  key: "invitation:inv_1",
  kind: "invitation",
  account: "friend",
  to: "friend@example.com",
  subject: "Invited",
  text: "Accept or decline.",
  ...over,
});

/** A consumer over a fresh D1, whose mailer fails as `fail` says (by attempt). */
function consumer(fail: (n: number) => unknown = () => null) {
  const { d1, db } = bunD1();
  const sent: Sent[] = [];
  const failures: string[] = [];
  const metered: string[] = [];
  let calls = 0;
  let clock = Date.parse("2026-10-31T12:00:00Z");
  const d: MailConsumerDeps = {
    mailer: {
      async send(m) {
        calls++;
        const e = fail(calls);
        if (e) throw e;
        sent.push(m);
      },
    },
    sent: d1SentLog(d1),
    recordFailure: async (day) => {
      failures.push(day);
    },
    meter: (e) => metered.push(e.account),
    now: () => new Date(clock),
  };
  return {
    d,
    db,
    sent,
    failures,
    metered,
    calls: () => calls,
    tick: (ms: number) => {
      clock += ms;
    },
  };
}

const coded = (code: string) => Object.assign(new Error(code), { code });

describe("the mail consumer", () => {
  test("sends once, meters it, and acks a redelivery without sending again", async () => {
    const c = consumer();
    expect(await handleMailMessage(c.d, job(), 1)).toEqual({ ack: "sent" });
    expect(c.sent).toEqual([
      { to: "friend@example.com", subject: "Invited", text: "Accept or decline." },
    ]);
    expect(c.metered).toEqual(["friend"]);
    // The same message delivered again (at least once), or queued again by its producer.
    expect(await handleMailMessage(c.d, job(), 1)).toEqual({ ack: "duplicate" });
    expect(await handleMailMessage(c.d, job({ queued: "later" }), 2)).toEqual({
      ack: "duplicate",
    });
    expect(c.sent).toHaveLength(1);
    // Another key is another mail.
    expect(await handleMailMessage(c.d, job({ key: "invitation:inv_2" }), 1)).toEqual({
      ack: "sent",
    });
    expect(c.sent).toHaveLength(2);
  });

  test("a transient failure is retried with backoff, then sent once", async () => {
    // Rate-limited twice, then through.
    const c = consumer((n) => (n <= 2 ? coded("E_RATE_LIMIT_EXCEEDED") : null));
    expect(await handleMailMessage(c.d, job(), 1)).toEqual({ retry: 30, why: "failed" });
    expect(await handleMailMessage(c.d, job(), 2)).toEqual({ retry: 120, why: "failed" });
    expect(await handleMailMessage(c.d, job(), 3)).toEqual({ ack: "sent" });
    expect(c.sent).toHaveLength(1);
    expect(c.failures).toEqual([]);
    // An error with no code (a network blip) is transient too.
    const blip = consumer((n) => (n === 1 ? new Error("socket hang up") : null));
    expect(await handleMailMessage(blip.d, job(), 1)).toMatchObject({ retry: 30 });
    expect(await handleMailMessage(blip.d, job(), 2)).toEqual({ ack: "sent" });
  });

  test("the last attempt's failure is counted for the digest, not retried", async () => {
    const c = consumer(() => coded("E_INTERNAL_SERVER_ERROR"));
    for (let a = 1; a < MAIL_ATTEMPTS; a++) {
      expect(await handleMailMessage(c.d, job(), a)).toMatchObject({ retry: backoffSeconds(a) });
    }
    expect(await handleMailMessage(c.d, job(), MAIL_ATTEMPTS)).toEqual({ ack: "failed" });
    expect(c.failures).toEqual(["2026-10-31"]);
    expect(c.calls()).toBe(MAIL_ATTEMPTS);
    // Nothing was marked sent: the key is free for a later producer's repeat.
    expect(c.db.query("SELECT COUNT(*) AS n FROM mail_sent").get()).toEqual({ n: 0 });
  });

  test("a permanent failure is not retried", async () => {
    const c = consumer(() => coded("E_RECIPIENT_SUPPRESSED"));
    expect(await handleMailMessage(c.d, job(), 1)).toEqual({ ack: "failed" });
    expect(c.calls()).toBe(1);
    expect(c.failures).toHaveLength(1);
    expect(permanentFailure(coded("E_DAILY_LIMIT_EXCEEDED"))).toBe(true);
    expect(permanentFailure(coded("E_RATE_LIMIT_EXCEEDED"))).toBe(false);
    expect(permanentFailure(new Error("x"))).toBe(false);
  });

  test("a key another delivery is sending waits; a claim left by a dead sender is taken over", async () => {
    const c = consumer();
    // A delivery claimed the key and has not finished.
    expect(await c.d.sent.claim("invitation:inv_1", c.d.now())).toBe("claimed");
    expect(await handleMailMessage(c.d, job(), 1)).toEqual({ retry: 30, why: "busy" });
    expect(c.sent).toHaveLength(0);
    // Its sender died: past CLAIM_STALE_MS the claim is taken over and the mail sent once.
    c.tick(CLAIM_STALE_MS + 1000);
    expect(await handleMailMessage(c.d, job(), 2)).toEqual({ ack: "sent" });
    expect(c.sent).toHaveLength(1);
    // A sent key is never taken over, however old.
    c.tick(CLAIM_STALE_MS * 10);
    expect(await handleMailMessage(c.d, job(), 1)).toEqual({ ack: "duplicate" });
  });

  test("what cannot be sent is dropped: a message of another shape, or no mailer", async () => {
    const c = consumer();
    expect(await handleMailMessage(c.d, { kind: "recount" }, 1)).toEqual({ ack: "dropped" });
    expect(await handleMailMessage(c.d, { ...job(), key: "" }, 1)).toEqual({ ack: "dropped" });
    expect(await handleMailMessage({ ...c.d, mailer: null }, job(), 1)).toEqual({
      ack: "dropped",
    });
    expect(c.sent).toHaveLength(0);
  });

  test("backoff: 30 s, 2, 8, then 15 minutes", () => {
    expect([1, 2, 3, 4, 5, 9].map(backoffSeconds)).toEqual([30, 120, 480, 900, 900, 900]);
  });

  test("sent keys are pruned after 14 days", async () => {
    const { d1, db } = bunD1();
    const log = d1SentLog(d1);
    const now = new Date("2026-10-31T00:00:00Z");
    await log.claim("old", new Date(now.getTime() - 15 * 86_400_000));
    await log.claim("new", new Date(now.getTime() - 86_400_000));
    expect((await pruneAccounts(d1, now)).mail_sent).toBe(1);
    expect(db.query("SELECT key FROM mail_sent").all()).toEqual([{ key: "new" }]);
  });
});

describe("sign-in links stay synchronous, retried once", () => {
  const msg = { to: "a@example.com", subject: "Sign in", text: "link" };

  test("a passing failure is tried once more", async () => {
    let n = 0;
    const sent: string[] = [];
    await sendNow(
      {
        async send(m) {
          if (++n === 1) throw new Error("blip");
          sent.push(m.to);
        },
      },
      msg,
      1,
    );
    expect(sent).toEqual(["a@example.com"]);
  });

  test("a second failure, or a permanent one, reaches the caller", async () => {
    let n = 0;
    const failing: Mailer = {
      async send() {
        n++;
        throw coded("E_INTERNAL_SERVER_ERROR");
      },
    };
    await expect(sendNow(failing, msg, 1)).rejects.toThrow();
    expect(n).toBe(2);
    n = 0;
    const suppressed: Mailer = {
      async send() {
        n++;
        throw coded("E_RECIPIENT_SUPPRESSED");
      },
    };
    await expect(sendNow(suppressed, msg, 1)).rejects.toThrow();
    expect(n).toBe(1);
  });

  test("the sign-in page sends through the mailer, not the queue", async () => {
    const s = setup();
    const r = await s.anon.request("/sign-in", {
      method: "POST",
      headers: { Origin: ORIGIN, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ email: OWNER.email, next: "/" }),
    });
    expect(r.status).toBe(200);
    expect(s.outbox.at(-1)?.to).toBe(OWNER.email);
    expect(s.mailQueue).toHaveLength(0);
  });
});

describe("producers queue their mail with a dedupe key", () => {
  const call = (app: ReturnType<typeof setup>["app"], path: string, body: unknown) =>
    app.request(path, {
      method: "POST",
      headers: { Origin: ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  test("an invitation is queued once per invitation; a redelivery sends nothing more", async () => {
    const s = setup();
    await s.stranger("friend@example.com");
    expect((await call(s.app, `${API}/invitations`, { to: "@friend", role: "read" })).status).toBe(
      202,
    );
    const queued = s.mailQueue.at(-1);
    expect(queued).toMatchObject({ v: 1, kind: "invitation", to: "friend@example.com" });
    expect(queued?.key).toMatch(/^invitation:inv_/);
    expect(s.usage.filter((u) => u.kind === "email")).toHaveLength(1);
    const mails = s.outbox.length;
    // The Queue delivers the same message again.
    const again = await handleMailMessage(
      {
        mailer: {
          async send(m) {
            s.outbox.push(m);
          },
        },
        sent: d1SentLog(s.d1),
        recordFailure: async () => {},
        now: () => new Date(),
      },
      queued,
      2,
    );
    expect(again).toEqual({ ack: "duplicate" });
    expect(s.outbox.length).toBe(mails);
  });

  test("a notification batch is queued within the cap; one not queued stays pending", async () => {
    const s = setup();
    const friend = await s.stranger("friend@example.com");
    await s.accounts.share(LIB.id, friend.user.id, "write", OWNER.id);
    const put = await s.app.request(`${API}/files/a.md`, {
      method: "PUT",
      headers: { Origin: ORIGIN, "Content-Type": "text/markdown" },
      body: "---\ntype: Metric\ntitle: A\ndescription: A metric.\n---\n# A\n\nText.\n",
    });
    expect(put.status).toBeLessThan(300);
    const opened = (await (
      await call(s.app, `${API}/comments`, { path: "a.md", body: "Q" })
    ).json()) as {
      thread: { id: string };
    };
    await call(friend.app, `${API}/comments/${opened.thread.id}`, { body: "An answer" });
    const later = new Date(Date.now() + QUIET_MS + 1000);
    const base = {
      accounts: s.accounts,
      notifications: s.notifications,
      origin: "https://app.example",
    };
    // The Queue refuses the message: nothing is lost, the items wait for the next run.
    const refusing = {
      async send() {
        throw new Error("queue unavailable");
      },
    };
    expect(await flushMail({ ...base, outbox: refusing, now: later })).toMatchObject({
      mails: 0,
      waiting: 1,
      skipped: 0,
    });
    const r = await flushMail({ ...base, outbox: s.deps.outbox ?? null, now: later });
    expect(r).toMatchObject({ mails: 1, items: 1 });
    const queued = s.mailQueue.at(-1);
    expect(queued?.kind).toBe("notification");
    expect(queued?.key).toMatch(/^notify:/);
    expect(queued?.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(s.outbox.at(-1)?.text).toContain("An answer");
  });
});

describe("each deployment has its own mail queue", () => {
  async function mailQueue(mode: string) {
    const worker = (await (
      await config({ isPreview: false, mode } as never)
    ).worker) as {
      env: Record<string, { name?: string }>;
      triggers: {
        type: string;
        name?: string;
        maxBatchSize?: number;
        maxRetries?: number;
        maxConcurrency?: number;
      }[];
    };
    const consumer = worker.triggers.find(
      (t) => t.type === "queue" && t.name === worker.env.MAIL_QUEUE?.name,
    );
    return {
      producer: worker.env.MAIL_QUEUE?.name,
      consumer: consumer?.name,
      retries: consumer?.maxRetries,
      concurrency: consumer?.maxConcurrency,
    };
  }

  test("production, staging and previews", async () => {
    expect(await mailQueue("production")).toEqual({
      producer: "tempra-mail",
      consumer: "tempra-mail",
      retries: MAIL_ATTEMPTS - 1,
      concurrency: 2,
    });
    expect((await mailQueue("staging")).consumer).toBe("tempra-mail-staging");
    expect(previewDeployment("7").mailQueue).toBe("tempra-mail-pr-7");
  });
});
