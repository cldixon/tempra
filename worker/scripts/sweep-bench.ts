/**
 * Times the blob sweep at scale (TEMPRA-81, TEMPRA-91): `bun scripts/sweep-bench.ts [libraries]`
 * builds an account D1 (bun:sqlite with the real migrations) with that many libraries (default
 * 10,000), each referencing 10 blobs of its own, plus one orphan per library, all recorded as the
 * write path records them. Then it runs, as the Worker would:
 *
 * - the first day (a full recount: every library counted through the queue; deletion held);
 * - a normal day (nothing restored or uncounted);
 * - day 32 (every orphan past its 31 days deleted);
 * - one write's reference, one recount and one library delete.
 *
 * For each: the cron's own time, Durable Object calls, R2 listings and queue messages. The digest's
 * per-library inventory() calls (until TEMPRA-92) are left out: they are the same before and after.
 * Times are local SQLite; on D1 each statement or batch adds a network round trip.
 */
import { d1BlobRefs } from "../src/blobrefs";
import { handleSweepMessage, type SweepMessage, sweep } from "../src/sweep";
import { bunD1 } from "../test/d1";

const n = Number(process.argv[2] ?? 10_000);
const PER = 10;
const DAY = 86_400_000;
const T0 = new Date("2026-10-01T04:30:00Z");

const { d1, db } = bunD1();
const refs = d1BlobRefs(d1);
db.run(
  "INSERT INTO users (id, email, actor, handle, created) VALUES ('u', 'u@x', 'human:o', 'o', '')",
);
const insert = db.prepare(
  "INSERT INTO libraries (id, slug, owner, visibility, created, do_id) VALUES (?, ?, 'u', 'private', '', ?)",
);
const ids: string[] = [];
db.transaction(() => {
  for (let i = 0; i < n; i++) {
    const id = `lib_${String(i).padStart(7, "0")}`;
    ids.push(id);
    insert.run(id, id, id);
  }
})();
const hashesOf = (id: string) => Array.from({ length: PER }, (_, j) => `${id}_${j}`);

const built = performance.now();
for (const id of ids) {
  for (const h of [...hashesOf(id), `${id}_orphan`]) await refs.stored(h, T0);
  await refs.reference(id, hashesOf(id), T0);
}
const buildMs = Math.round(performance.now() - built);

const counters = { doCalls: 0, listCalls: 0, messages: 0, deletedKeys: 0 };
const queued: SweepMessage[] = [];
const queue = {
  send: async (m: SweepMessage) => {
    counters.messages++;
    queued.push(m);
  },
  sendBatch: async (ms: SweepMessage[]) => {
    counters.messages += ms.length;
    queued.push(...ms);
  },
};
let clock = T0;
const consumer = {
  refs,
  queue,
  libraryHashes: async (id: string) => {
    counters.doCalls++;
    return hashesOf(id);
  },
  bucket: {
    list: async () => {
      counters.listCalls++;
      return { objects: [], truncated: false };
    },
  },
  now: () => clock,
};

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return Math.round((s[Math.floor(s.length / 2)] ?? 0) * 100) / 100;
};

/** The cron, then every message it queued, each timed. */
async function day(now: Date) {
  clock = now;
  Object.assign(counters, { doCalls: 0, listCalls: 0, messages: 0, deletedKeys: 0 });
  const t = performance.now();
  const r = await sweep({
    refs,
    queue,
    bucket: {
      delete: async (keys) => {
        counters.deletedKeys += keys.length;
      },
    },
    libraries: async () => [],
    inventory: async () => {
      throw new Error("not called");
    },
    storageLimitBytes: 1e9,
    now,
  });
  const cronMs = Math.round(performance.now() - t);
  const cronDoCalls = counters.doCalls;
  const times: Record<string, number[]> = {};
  for (let m = queued.shift(); m; m = queued.shift()) {
    const s = performance.now();
    await handleSweepMessage(m, consumer);
    const list = times[m.kind] ?? [];
    list.push(performance.now() - s);
    times[m.kind] = list;
  }
  return {
    cron_ms: cronMs,
    cron_do_calls: cronDoCalls,
    held: r.held ?? null,
    deleted: r.deleted,
    messages: counters.messages,
    consumer_do_calls: counters.doCalls,
    r2_list_calls: counters.listCalls,
    per_message_ms: Object.fromEntries(Object.entries(times).map(([k, v]) => [k, median(v)])),
  };
}

const first = await day(T0);
const normal = await day(new Date(T0.getTime() + DAY));
const day32 = await day(new Date(T0.getTime() + 32 * DAY));

const write: number[] = [];
const recount: number[] = [];
for (let i = 0; i < 20; i++) {
  const id = ids[(i * 7919) % n] as string;
  let s = performance.now();
  await refs.reference(id, [`${id}_new${i}`], new Date(T0.getTime() + 33 * DAY));
  write.push(performance.now() - s);
  s = performance.now();
  await refs.replace(id, hashesOf(id), new Date(T0.getTime() + 34 * DAY));
  recount.push(performance.now() - s);
}
const gone = ids[n - 1] as string;
db.run("DELETE FROM libraries WHERE do_id = ?", [gone]);
const del = performance.now();
await refs.forget(gone, new Date(T0.getTime() + 35 * DAY));
const deleteMs = Math.round((performance.now() - del) * 100) / 100;

console.log(
  JSON.stringify(
    {
      libraries: n,
      blobs: n * (PER + 1),
      build_ms: buildMs,
      first_day: first,
      normal_day: normal,
      day_32: day32,
      write_reference_ms: median(write),
      recount_ms: median(recount),
      library_delete_ms: deleteMs,
    },
    null,
    2,
  ),
);
