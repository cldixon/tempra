import { type BlobStore, bundleTar } from "./client";
import type { LibraryHealth, MaintenanceDue, StalenessRun, StructureRun } from "./store/store";

/**
 * The daily maintainers (spec: Tier 3). A library's maintainers are of two kinds: processes,
 * deterministic programs Tempra runs (these), and agents, managed agents that act on what the
 * processes flag (TEMPRA-56). The processes here are the nightly export to R2, the usage rollup,
 * staleness (TEMPRA-63), structure (TEMPRA-64) and, last, since it counts what the others flag,
 * the health summary (TEMPRA-66). Free of Worker APIs, so the Library Durable Object's alarm and bun
 * tests run the same code.
 */

/** The part of an R2 bucket the export maintainer uses. */
export interface ExportBucket {
  put(
    key: string,
    body: Uint8Array | string,
    opts?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  list(opts: { prefix: string; delimiter?: string; cursor?: string }): Promise<{
    objects: { key: string }[];
    delimitedPrefixes: string[];
    truncated: boolean;
    cursor?: string;
  }>;
  delete(keys: string | string[]): Promise<unknown>;
}

/** The store methods the maintainers call; the Library DO passes its LibraryStore. */
export interface MaintainedStore {
  headSeq(): number;
  exportBundle(at?: number): unknown;
  dump(): string;
  pruneUsage(): number;
  maintainStaleness(): StalenessRun;
  maintainStructure(): StructureRun;
  maintainHealth(): LibraryHealth;
  maintenance(): Record<string, string>;
  setMaintenance(values: Record<string, string>): void;
  maintenanceDue(now: Date): MaintenanceDue;
}

export interface MaintenanceResult {
  export: { key: string; seq: number; files: number } | { skipped: "unchanged" };
  deleted: string[];
  pruned: number;
  staleness: StalenessRun;
  structure: StructureRun;
  health: LibraryHealth;
}

export const DEFAULT_RETENTION_DAYS = 30;

const DAY_MS = 86_400_000;

export const exportsPrefix = (libraryId: string) => `exports/${libraryId}/`;

const day = (d: Date) => d.toISOString().slice(0, 10);

/** Runs every daily maintainer once. Idempotent: running it twice in a row exports once. */
export async function runMaintenance(opts: {
  store: MaintainedStore;
  blobs: BlobStore;
  bucket: ExportBucket;
  libraryId: string;
  now: Date;
  retentionDays?: number;
}): Promise<MaintenanceResult> {
  const { store, bucket, now } = opts;
  const stamp = now.toISOString().replace(/\.\d{3}Z$/, "Z");
  const state = store.maintenance();
  const seq = store.headSeq();

  // Export: only when the ledger moved since the last one (its cursor).
  let exported: MaintenanceResult["export"] = { skipped: "unchanged" };
  if (seq > 0 && seq !== Number(state.export_seq ?? -1)) {
    const folder = `${exportsPrefix(opts.libraryId)}${day(now)}/`;
    const files = await writeExport({ ...opts, folder, stamp });
    store.setMaintenance({ export_seq: String(seq), export_at: stamp, export_key: folder });
    exported = { key: folder, seq, files };
  }

  const retentionDays = opts.retentionDays ?? DEFAULT_RETENTION_DAYS;
  const { deleted, kept } = await pruneExports(bucket, opts.libraryId, now, retentionDays);
  // When the oldest export the next pass may prune passes retention (the newest is always kept),
  // so an idle library's alarm wakes for it (TEMPRA-82).
  const prefix = exportsPrefix(opts.libraryId);
  const oldest = kept.slice(0, -1)[0]?.slice(prefix.length, prefix.length + 10);
  const expiry = oldest ? Date.parse(`${oldest}T00:00:00Z`) + (retentionDays + 1) * DAY_MS : NaN;
  store.setMaintenance({
    export_expiry: Number.isFinite(expiry) ? new Date(expiry).toISOString() : "none",
  });
  const pruned = store.pruneUsage();
  store.setMaintenance({ usage_at: stamp });
  const staleness = store.maintainStaleness();
  const structure = store.maintainStructure();
  const health = store.maintainHealth();
  return { export: exported, deleted, pruned, staleness, structure, health };
}

/**
 * Writes one export folder: the bundle at head, the ledger dump and a manifest. Returns the
 * bundle's file count. Used by the nightly run and before a point-in-time restore.
 */
export async function writeExport(opts: {
  store: MaintainedStore;
  blobs: BlobStore;
  bucket: ExportBucket;
  libraryId: string;
  folder: string;
  stamp: string;
  kind?: string;
}): Promise<number> {
  const { store, bucket, folder } = opts;
  const seq = store.headSeq();
  const tar = await bundleTar(store, opts.blobs, seq);
  await bucket.put(`${folder}bundle.tar`, tar.bytes, {
    httpMetadata: { contentType: "application/x-tar" },
  });
  await bucket.put(`${folder}ledger.jsonl`, store.dump(), {
    httpMetadata: { contentType: "application/x-ndjson" },
  });
  const manifest = {
    library_id: opts.libraryId,
    seq,
    created: opts.stamp,
    files: tar.files,
    ...(opts.kind ? { kind: opts.kind } : {}),
  };
  await bucket.put(`${folder}manifest.json`, JSON.stringify(manifest, null, 2), {
    httpMetadata: { contentType: "application/json" },
  });
  return tar.files;
}

/** Export folders for a library, oldest first. */
export async function listExports(bucket: ExportBucket, libraryId: string): Promise<string[]> {
  const prefix = exportsPrefix(libraryId);
  const folders: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, delimiter: "/", cursor });
    folders.push(...page.delimitedPrefixes);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return folders.sort();
}

/**
 * Deletes export folders older than the retention window; the newest one is always kept. Returns
 * what it deleted and the folders left, oldest first.
 */
async function pruneExports(
  bucket: ExportBucket,
  libraryId: string,
  now: Date,
  retentionDays: number,
): Promise<{ deleted: string[]; kept: string[] }> {
  const folders = await listExports(bucket, libraryId);
  const cutoff = day(new Date(now.getTime() - retentionDays * DAY_MS));
  const prefix = exportsPrefix(libraryId);
  const old = folders
    .slice(0, -1)
    .filter((f) => f.slice(prefix.length, prefix.length + 10) < cutoff);
  for (const folder of old) {
    const page = await bucket.list({ prefix: folder });
    const keys = page.objects.map((o) => o.key);
    if (keys.length) await bucket.delete(keys);
  }
  return { deleted: old, kept: folders.filter((f) => !old.includes(f)) };
}

/**
 * The schedule before TEMPRA-82: 03:00 UTC plus a few minutes per library, strictly after `now`.
 * No longer used to set alarms (see `nextMaintenance`); alarms it set still fire and reschedule.
 * @deprecated
 */
export function nextRun(now: Date, libraryId: string): Date {
  let spread = 0;
  for (const ch of libraryId) spread = (spread * 31 + ch.charCodeAt(0)) % 60;
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 3, spread),
  );
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

/** The longest an idle library sleeps between two passes (TEMPRA-82). */
export const MAX_SLEEP_DAYS = 7;

/**
 * A library's time of day for maintenance, in ms after 00:00 UTC: a second of the day hashed
 * from the library id, so libraries spread evenly over 24 hours (TEMPRA-82).
 */
export function dailySlot(libraryId: string): number {
  let h = 2166136261;
  for (const ch of libraryId) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return (h % 86_400) * 1000;
}

/** The library's first slot at or after `t`. */
export function slotAtOrAfter(t: number, libraryId: string): Date {
  const midnight = Math.floor(t / DAY_MS) * DAY_MS;
  const at = midnight + dailySlot(libraryId);
  return new Date(at >= t ? at : at + DAY_MS);
}

/**
 * When the library's next pass should run (TEMPRA-82): its first slot strictly after `now` at or
 * after the earliest moment there is work: an export (the ledger moved), an export or read count
 * to drop, a concept coming within 14 days of `stale_after` or passing it. At most
 * MAX_SLEEP_DAYS away, so an idle library still wakes now and then. Each slot is a day apart,
 * so anything due is handled within a day of falling due, as with the daily pass.
 */
export function nextMaintenance(now: Date, libraryId: string, due: MaintenanceDue): Date {
  const after = now.getTime() + 1;
  const times = [now.getTime() + MAX_SLEEP_DAYS * DAY_MS];
  if (due.exportPending) times.push(after);
  for (const t of [due.exportExpiry, due.staleAt, due.usageExpiry]) {
    if (t !== null) times.push(Math.max(t, after));
  }
  return slotAtOrAfter(Math.min(...times), libraryId);
}

/** The Durable Object's alarm, as the schedule uses it. */
export interface AlarmStorage {
  getAlarm(): Promise<number | null>;
  setAlarm(at: Date): Promise<void>;
}

/**
 * A library's maintenance alarm (TEMPRA-82): set on first use for the next slot, moved earlier by
 * a write when the export it calls for would otherwise wait, and after each pass set for the
 * earliest slot with work. Remembers the alarm it set, so a write costs no storage call.
 */
export class MaintenanceSchedule {
  /** When the alarm is set for (ms), as last set or read; null when none is set. */
  private at: number | null = null;

  constructor(
    private readonly alarms: AlarmStorage,
    private readonly store: Pick<MaintainedStore, "maintenanceDue" | "setMaintenance">,
    private readonly libraryId: () => string,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /** On the object's first use: reads the alarm, and sets one for the next slot if none is. */
  async ensure() {
    this.at = await this.alarms.getAlarm();
    if (this.at === null) await this.set(this.nextSlot());
  }

  /** After a write: the export it calls for runs at the next slot, unless a pass comes sooner. */
  async wake() {
    const at = this.nextSlot();
    if (this.at === null || this.at > at.getTime()) await this.set(at);
  }

  /** After a pass: the earliest slot with work, or the heartbeat. */
  async afterPass() {
    const now = this.clock();
    await this.set(nextMaintenance(now, this.libraryId(), this.store.maintenanceDue(now)));
  }

  private nextSlot(): Date {
    return slotAtOrAfter(this.clock().getTime() + 1, this.libraryId());
  }

  private async set(at: Date) {
    await this.alarms.setAlarm(at);
    this.at = at.getTime();
    this.store.setMaintenance({ next_run: at.toISOString().replace(/\.\d{3}Z$/, "Z") });
  }
}
