import type { AccountFeeds } from "./account-feeds";
import { d1Accounts } from "./accounts";
import type { Deps } from "./app";
import { d1Authenticate } from "./auth";
import { d1BlobRefs } from "./blobrefs";
import { makeClient, r2BlobStore, recordingBlobStore } from "./client";
import { FEED_SOCKETS_PER_ACCOUNT } from "./feed";
import { deleteVariants, imagesService, r2VariantCache } from "./images";
import { type Library, refuseFeed } from "./library";
import { DEFAULT_STORAGE_MB } from "./limits";
import { exportsPrefix, listExports } from "./maintain";
import { d1Notifications } from "./notify";
import { devMailer, flushMail, sendDigests } from "./notify-mail";
import { listRestores, RESTORE_ID, restoresPrefix } from "./recovery";
import { type RenderService, serviceRenderer } from "./render";
import { d1Sessions } from "./session";
import type { Mailer } from "./signin";
import {
  digestText,
  handleSweepMessage,
  isSweepMessage,
  pruneAccounts,
  type SweepMessage,
  type SweepQueue,
  sweep,
} from "./sweep";
import { createWorker } from "./worker";

export { AccountFeeds } from "./account-feeds";
export { Library } from "./library";

/**
 * A library's Durable Object by name. cloudflare.config.ts binds LIBRARY by Worker name, which
 * cf/config cannot type, so the stub's RPC methods are typed here.
 */
function libraryStub(env: Env, name: string): DurableObjectStub<Library> {
  const ns = env.LIBRARY as DurableObjectNamespace<Library>;
  return ns.get(ns.idFromName(name));
}

/**
 * Cloudflare Email Service (v2 spec: A3). The EMAIL binding exists only once a sending domain is
 * set in cloudflare.config.ts (mailFrom); without it there is no mailer.
 */
type MailBinding = {
  send(m: {
    from: string;
    to: string;
    subject: string;
    text: string;
    html?: string;
    headers?: Record<string, string>;
  }): Promise<unknown>;
};

function mailerFor(env: Env): Mailer | null {
  const binding = (env as unknown as { EMAIL?: MailBinding }).EMAIL;
  const from = env.MAIL_FROM;
  if (!binding || !from) return null;
  return {
    async send(m) {
      await binding.send({ from, ...m });
    },
  };
}

/** The blob sweep's Queue (TEMPRA-81). */
function sweepQueue(env: Env): SweepQueue {
  const q = env.SWEEP_QUEUE as Queue<SweepMessage>;
  return {
    send: async (m) => {
      await q.send(m);
    },
    sendBatch: async (ms) => {
      if (ms.length) await q.sendBatch(ms.map((body) => ({ body })));
    },
  };
}

const storageLimitBytes = (env: Env) =>
  (Number(env.LIBRARY_STORAGE_MB) || DEFAULT_STORAGE_MB) * 1048576;

let authenticate: ReturnType<typeof d1Authenticate> | undefined;

const depsFor = (env: Env): Deps => {
  authenticate ??= d1Authenticate(env.DB);
  const client = (doId: string) => {
    const stub = libraryStub(env, doId);
    return makeClient((method, args) => stub.call(method, args));
  };
  const meter: Deps["meter"] = (e) => {
    try {
      env.USAGE.writeDataPoint({
        blobs: [e.kind, e.account, e.library ?? ""],
        doubles: [1, e.bytes ?? 0],
        indexes: [e.account.slice(0, 96)],
      });
    } catch {}
  };
  return {
    authenticate,
    accounts: d1Accounts(env.DB),
    sessions: d1Sessions(env.DB),
    mailer: mailerFor(env),
    notifications: d1Notifications(env.DB),
    async rateLimit(kind, key) {
      const limiter =
        // Renders share WRITE_LIMITER's 60 a minute under their own `render:` keys (TEMPRA-166).
        kind === "write" || kind === "render"
          ? env.WRITE_LIMITER
          : kind === "session"
            ? env.SESSION_LIMITER
            : env.REQUEST_LIMITER;
      return (await limiter.limit({ key })).success;
    },
    meter,
    // Not bound in local dev (cloudflare.config.ts): every render answers "render unavailable".
    renderDiagram: serviceRenderer((env as unknown as { RENDER?: RenderService }).RENDER, meter),
    // Each blob put is recorded in D1 first, so the sweep never lists the bucket (TEMPRA-81).
    blobs: recordingBlobStore(r2BlobStore(env.BLOBS), d1BlobRefs(env.DB)),
    // Scaled copies under variants/ in the same bucket (TEMPRA-153); reads only, so no recording.
    images: imagesService({
      blobs: r2BlobStore(env.BLOBS),
      transformer: env.IMAGES ?? null,
      cache: r2VariantCache(env.BLOBS),
    }),
    maintain: (doId) => libraryStub(env, doId).maintain(),
    async destroyLibrary(doId) {
      // destroy() ends by restarting the object, which fails the call by design.
      await libraryStub(env, doId)
        .destroy()
        .catch(() => {});
      // Its references go; blobs it was the last to reference start their 31 days (TEMPRA-91).
      await d1BlobRefs(env.DB).forget(doId, new Date());
      for (const prefix of [exportsPrefix(doId), restoresPrefix(doId)]) {
        let cursor: string | undefined;
        do {
          const page = await env.BLOBS.list({ prefix, cursor });
          if (page.objects.length) await env.BLOBS.delete(page.objects.map((o) => o.key));
          cursor = page.truncated ? page.cursor : undefined;
        } while (cursor);
      }
    },
    health: async () => {
      const check = async (fn: () => Promise<unknown>) => {
        try {
          await fn();
          return "ok";
        } catch (e) {
          return e instanceof Error ? e.message : String(e);
        }
      };
      const [d1, r2, durableObjects] = await Promise.all([
        check(() => env.DB.prepare("SELECT 1").first()),
        check(() => env.BLOBS.list({ limit: 1 })),
        check(async () => {
          const r = await libraryStub(env, "_healthz").ping();
          if (r !== "ok") throw new Error("unexpected reply");
        }),
      ]);
      return { d1, r2, durable_objects: durableObjects };
    },
    recovery: {
      async restore(doId, target, actor) {
        const stub = libraryStub(env, doId);
        let t: Parameters<typeof stub.prepareRestore>[0];
        if ("undo" in target) {
          const obj = RESTORE_ID.test(target.undo)
            ? await env.BLOBS.get(`${restoresPrefix(doId)}${target.undo}.json`)
            : null;
          if (!obj)
            return { ok: false, status: 404, code: "not_found", message: "No such restore." };
          t = { undo: await obj.json() };
        } else {
          t = { to: target.to };
        }
        // A restore can drop references (TEMPRA-91): deletion is held from before it is armed
        // until a recount after the restart, carrying this token, has replaced the library's rows.
        const token = crypto.randomUUID();
        await d1BlobRefs(env.DB).pend(doId, token);
        const outcome = await stub.prepareRestore(t, actor);
        if (outcome.ok) {
          // abort() fails the call by design; the next request starts the restored library.
          await stub.restart().catch(() => {});
        }
        // Sent either way (a refused restore changed nothing; the recount says so). If it is
        // lost, the daily cron sends it again for the pending library.
        await sweepQueue(env)
          .send({ kind: "recount", library: doId, token })
          .catch((e) =>
            console.error(JSON.stringify({ recount_not_sent: doId, error: String(e) })),
          );
        return outcome;
      },
      list: (doId) =>
        listRestores(env.BLOBS, async (k) => (await env.BLOBS.get(k))?.text() ?? null, doId),
    },
    exports: {
      async list(libraryId) {
        const folders = (await listExports(env.BLOBS, libraryId)).reverse();
        return Promise.all(
          folders.map(async (folder) => {
            const m = await env.BLOBS.get(`${folder}manifest.json`);
            return { folder, manifest: m ? ((await m.json()) as Record<string, unknown>) : null };
          }),
        );
      },
      async get(key) {
        if (!key.startsWith("exports/")) return null;
        const obj = await env.BLOBS.get(key);
        return obj ? { body: obj.body, size: obj.size } : null;
      },
    },
    library: (token) => client(token.library.do_id),
    feed: async (doId, request, { prefix, account }) => {
      // A place under the account's cap first (feed-leases.ts), then the library's own cap.
      const lease = crypto.randomUUID();
      const ns = env.ACCOUNT_FEEDS as DurableObjectNamespace<AccountFeeds>;
      const counter = ns.get(ns.idFromName(account));
      if (!(await counter.acquire({ id: lease, doId }, FEED_SOCKETS_PER_ACCOUNT))) {
        return refuseFeed("This account has too many live connections; polling instead.");
      }
      const url = new URL("https://library/feed");
      if (prefix) url.searchParams.set("prefix", prefix);
      url.searchParams.set("lease", lease);
      return libraryStub(env, doId).fetch(new Request(url, request));
    },
    // Checked against D1 first, so a forged download URL cannot create Durable Objects.
    libraryByDoId: async (doId) => {
      const row = await env.DB.prepare("SELECT 1 AS ok FROM libraries WHERE do_id = ?")
        .bind(doId)
        .first();
      return row ? client(doId) : null;
    },
  };
};

const worker = createWorker(depsFor);

/** The 5-minute cron that sends batched notification mail; any other is the daily one. */
const NOTIFY_CRON = "*/5 * * * *";

export default {
  fetch: worker.fetch,

  /**
   * The crons in cloudflare.config.ts: every 5 minutes the batched notification mail (TEMPRA-74);
   * daily the blob sweep, the operator digest and people's digests (v2 spec: A3).
   */
  async scheduled(controller, env) {
    // Local dev (DEV_SIGNIN=1) keeps notification mail in the dev outbox (/_dev/mail).
    const mail = {
      accounts: d1Accounts(env.DB),
      notifications: d1Notifications(env.DB),
      mailer: env.DEV_SIGNIN === "1" ? devMailer : mailerFor(env),
      origin: env.APP_ORIGIN,
      now: new Date(),
    };
    if (controller.cron === NOTIFY_CRON) {
      const sent = await flushMail(mail);
      if (sent.mails || sent.skipped) console.log(JSON.stringify({ notify_mail: sent }));
      return;
    }
    const digests = await sendDigests({
      ...mail,
      digest: (doId, since) => {
        const stub = libraryStub(env, doId);
        return makeClient((method, args) => stub.call(method, args)).digest({ since });
      },
    }).catch((e) => {
      console.error(JSON.stringify({ digests_failed: String(e) }));
      return null;
    });
    const result = await sweep({
      refs: d1BlobRefs(env.DB),
      queue: sweepQueue(env),
      // A blob's scaled copies (images.ts) go with it.
      bucket: {
        delete: async (keys) => {
          await env.BLOBS.delete(keys);
          await deleteVariants(env.BLOBS, keys);
        },
      },
      libraries: async () =>
        (
          await env.DB.prepare(
            "SELECT l.do_id AS id, COALESCE(u.handle, '?') || '/' || l.slug AS path FROM libraries l LEFT JOIN users u ON u.id = l.owner",
          ).all<{ id: string; path: string }>()
        ).results,
      inventory: (id) => libraryStub(env, id).inventory(),
      prune: () => pruneAccounts(env.DB, new Date()),
      storageLimitBytes: storageLimitBytes(env),
      now: new Date(),
    });
    // The waitlist (v2 spec: Accounts and sign-in): the digest counts who waits, past the notice cap.
    const waiting = (await d1Accounts(env.DB).waitlist()).length;
    if (waiting) result.attention.push(`${waiting} waiting on the waitlist: /waitlist`);
    // Notification mail that failed yesterday (bounces, as far as sending tells us).
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const failed = await mail.notifications.failures(yesterday);
    if (failed)
      result.attention.push(`${failed} notification mails failed to send on ${yesterday}`);
    console.log(JSON.stringify({ sweep: result, digests }));
    const mailer = mailerFor(env);
    if (result.attention.length && env.OPERATOR_EMAIL && mailer) {
      await mailer.send({
        to: env.OPERATOR_EMAIL,
        subject: `Tempra digest: ${result.attention.length} to look at`,
        text: digestText(result),
      });
    }
  },

  /**
   * The blob sweep's fan-out (TEMPRA-81): dispatch pages, library recounts, the one-time bucket
   * listing and the drift scan, each message on its own, retried on failure.
   */
  async queue(batch, env) {
    const deps = {
      refs: d1BlobRefs(env.DB),
      queue: sweepQueue(env),
      libraryHashes: (library: string) => libraryStub(env, library).blobRefs(),
      bucket: {
        list: (o: { prefix: string; cursor?: string; limit: number }) => env.BLOBS.list(o),
      },
      now: () => new Date(),
    };
    for (const msg of batch.messages) {
      if (!isSweepMessage(msg.body)) {
        console.error(JSON.stringify({ sweep_message_unknown: msg.body }));
        msg.ack();
        continue;
      }
      try {
        const outcome = await handleSweepMessage(msg.body, deps);
        // A recount that adds or removes rows outside a backfill is drift (TEMPRA-91).
        if (outcome.kind !== "dispatch") console.log(JSON.stringify({ sweep: outcome }));
        msg.ack();
      } catch (e) {
        console.error(JSON.stringify({ sweep_message: msg.body, error: String(e) }));
        msg.retry();
      }
    }
  },
} satisfies ExportedHandler<Env, SweepMessage>;
