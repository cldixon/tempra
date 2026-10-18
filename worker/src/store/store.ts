import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, randomBytes } from "@noble/hashes/utils.js";
import {
  ATOM,
  type Doc,
  docText,
  headingIds,
  locate,
  occurrences,
  quoteText,
  selectorAt,
  toMarkdown,
} from "@tempra/editor/doc";
import { stringify as yamlStringify } from "yaml";
import {
  buildRecord,
  deserializeRecord,
  field,
  type ParsedConcept,
  parseConcept,
  renderConcept,
  renderDoc,
  serializeRecord,
  sourceCandidates,
} from "../okf/concept";
import { type LogRequest, renderIndex, renderLog } from "../okf/derived";
import { diagramLint } from "../okf/diagrams";
import { unifiedDiff } from "../okf/diff";
import { sha256Hex } from "../okf/hash";
import { lintFields } from "../okf/lint";
import { scanDoc } from "../okf/markdown";
import {
  basename,
  dirname,
  isConceptPath,
  isReserved,
  normalizeDir,
  normalizePath,
  relativePath,
  resolveLinkPath,
  safeDecode,
  splitAnchor,
  underPrefix,
} from "../okf/paths";
import {
  checkStructure,
  dirIndex,
  dirKey,
  isDirKey,
  type StructureEntry,
  type StructureIssue,
  structureAction,
} from "../okf/structure";
import {
  effectiveStatus,
  isStale,
  STALE_SOON_DAYS,
  type Staleness,
  staleness,
  staleTime,
  trustTier,
} from "../okf/trust";
import type {
  ConceptRecord,
  Json,
  JsonObject,
  LintWarning,
  StoredLink,
  StoredSource,
  TrustTier,
  Verification,
} from "../okf/types";
import {
  type ActionBy,
  type CommentAction,
  type CommentResult,
  type CommentView,
  checkQuote,
  commentBody,
  type Mention,
  type StoredAnchor,
  type ThreadAction,
  type ThreadStatus,
  type ThreadView,
} from "./comments";
import { notFound, OkfError } from "./errors";
import { LEDGER_COUNTS, migrate } from "./schema";
import type { SqlHandle, SqlValue } from "./sql";

/** Concepts over this many bytes of rendered markdown are refused (spec: OKF conformance). */
export const DEFAULT_CONCEPT_CAP = 100 * 1024;

export interface RequestContext {
  actor: string;
  request_id: string;
  note?: string | null;
  /**
   * The person (users row id) and agent behind the actor (tempra-dev:
   * decisions/agents-act-for-a-person), kept in each event's meta as `by`.
   */
  by?: { person: string; agent?: string } | null;
}

export interface BlobRef {
  hash: string;
  size: number;
  media: string | null;
}

/**
 * A concept to write: OKF markdown (agents, import), or the app's frontmatter and stored tree,
 * whose block IDs are kept where they name blocks of the current version.
 */
export type ConceptContent = string | { frontmatter: JsonObject; doc: Doc };

export type WriteOp =
  | {
      op: "write";
      path: string;
      content: ConceptContent;
      if_match?: string | null;
      if_none_match?: boolean;
    }
  | { op: "attach"; path: string; blob: BlobRef; if_match?: string | null; if_none_match?: boolean }
  | { op: "edit"; path: string; edits: { old: string; new: string }[]; if_match?: string | null }
  | { op: "move"; path: string; to: string }
  | { op: "delete"; path: string; if_match?: string | null };

export interface OpResult {
  op: string;
  path: string;
  /** move: where the file was. */
  from?: string;
  hash: string | null;
  seq: number;
  lint: LintWarning[];
  /**
   * What the writer should know that is not stored as lint: fields the server ignored, a
   * `stale_after` already past, the concept's open comment threads, a link to a missing heading.
   */
  notices?: LintWarning[];
  /** A unified diff from what was sent to what is stored, when the server normalized it. */
  normalized?: string;
}

export interface WriteResult {
  request_id: string;
  seq: number;
  results: OpResult[];
}

export type ImportFile = { path: string; markdown: string } | { path: string; blob: BlobRef };

export interface ImportResult {
  request_id: string;
  seq: number;
  files: number;
  skipped: string[];
  warnings: { path: string; lint: LintWarning[] }[];
}

export interface EventRow {
  seq: number;
  ts: string;
  actor: string;
  request_id: string;
  op: string;
  path: string;
  prev_hash: string | null;
  hash: string | null;
  concept_id: string;
  meta: JsonObject | null;
}

export interface RequestRow {
  request_id: string;
  ts: string;
  actor: string;
  note: string | null;
  /** The person and agent behind the actor, when recorded (from 2026-10, TEMPRA-75). */
  by: { person: string; agent?: string } | null;
  events: EventRow[];
}

export type Kind = "concept" | "attachment";

interface Entry {
  path: string;
  concept_id: string;
  hash: string;
  kind: Kind;
  seq: number;
}

interface PathRow extends Entry {
  created_seq: number;
}

/** What resolving a link reads of a library at a seq: a file by id or by path. */
interface View {
  readonly seq: number;
  readonly byId: { get(id: string): Entry | undefined };
  lookup(path: string): Entry | undefined;
}

/** The path-to-hash map of a library as of a sequence number (spec: The ledger, Snapshots). */
class Snapshot implements View {
  readonly byPath = new Map<string, Entry>();
  readonly byId = new Map<string, Entry>();
  constructor(
    public seq: number,
    entries: Entry[],
  ) {
    for (const e of entries) {
      this.byPath.set(e.path, e);
      this.byId.set(e.concept_id, e);
    }
  }

  /**
   * Moves a head snapshot to `seq` in place (TEMPRA-87): the files of `ids` as they stand now
   * (`rows`; an id with no row was deleted). Every change to `paths` is an event naming its
   * concept, so the ids a write's events name are all that can differ.
   */
  advance(seq: number, ids: Iterable<string>, rows: Entry[]) {
    for (const id of ids) {
      const old = this.byId.get(id);
      if (!old) continue;
      this.byId.delete(id);
      if (this.byPath.get(old.path)?.concept_id === id) this.byPath.delete(old.path);
    }
    for (const e of rows) {
      this.byPath.set(e.path, e);
      this.byId.set(e.concept_id, e);
    }
    this.seq = seq;
  }

  /** A path as addressed by a client: with or without the `.md` suffix. */
  lookup(path: string): Entry | undefined {
    return (
      this.byPath.get(path) ?? (path.endsWith(".md") ? undefined : this.byPath.get(`${path}.md`))
    );
  }

  sorted(): Entry[] {
    return [...this.byPath.values()].sort((a, b) => (a.path < b.path ? -1 : 1));
  }
}

/**
 * The head as `paths` holds it, looked up file by file with its indexes: what a write reads to
 * resolve its own concepts' links, in place of a snapshot of every file (TEMPRA-87).
 */
class LiveView implements View {
  private readonly ids = new Map<string, Entry | undefined>();
  private readonly paths = new Map<string, Entry | undefined>();
  readonly byId = { get: (id: string) => this.one(this.ids, "concept_id", id) };
  constructor(
    private readonly sql: SqlHandle,
    readonly seq: number,
  ) {}

  lookup(path: string): Entry | undefined {
    return (
      this.one(this.paths, "path", path) ??
      (path.endsWith(".md") ? undefined : this.one(this.paths, "path", `${path}.md`))
    );
  }

  private one(memo: Map<string, Entry | undefined>, column: string, key: string) {
    if (memo.has(key)) return memo.get(key);
    const e = this.sql.all<Entry>(
      `SELECT path, concept_id, hash, kind, last_seq AS seq FROM paths WHERE ${column} = ?`,
      key,
    )[0];
    memo.set(key, e);
    return e;
  }
}

export interface ConceptRow {
  path: string;
  kind: Kind;
  hash: string;
  seq: number;
  type?: string;
  title?: string | null;
  description?: string | null;
  status?: string;
  /** False when the concept has no `status`, which reads as stable (OKF §5.4). */
  status_set?: boolean;
  tags?: string[];
  trust_tier?: TrustTier;
  stale?: boolean;
  size?: number;
  media?: string | null;
}

export type FileView =
  | {
      kind: "concept";
      path: string;
      hash: string;
      seq: number;
      markdown: string;
      frontmatter: JsonObject;
      /** The body as a tree, links at their targets' current paths. */
      doc: Doc;
      lint: LintWarning[];
      trust_tier: TrustTier;
      stale: boolean;
      /** Within STALE_SOON_DAYS of `stale_after`, worked out at read time like `stale`. */
      stale_soon: boolean;
      inbound_links: number;
      /** Open comment threads, at head (0 for an earlier version). */
      open_comments: number;
    }
  | {
      kind: "attachment";
      path: string;
      hash: string;
      seq: number;
      size: number;
      media: string | null;
    }
  | { kind: "derived"; path: string; seq: number; markdown: string };

export interface ExportFile {
  path: string;
  text?: string;
  blob?: BlobRef;
}

export interface StoreOptions {
  conceptCap?: number;
  /** Server clock, injectable for tests. */
  now?: () => Date;
  /** Bytes of storage the library uses; the Durable Object passes its SQLite size. */
  size?: () => number;
}

/** Reads are counted over this window for internal sources' usage (spec: What the service derives). */
export const USAGE_WINDOW_DAYS = 30;

/** Reads counted in memory before they are written to `access_log` (TEMPRA-87). */
export const READ_FLUSH = 100;

/**
 * Requests log.md shows before pointing to the rest: one full page of `GET …/requests` (its
 * largest `limit`), so the next page picks up exactly where the file stops.
 */
export const LOG_REQUESTS = 200;

function iso(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function utf8Length(s: string): number {
  return new TextEncoder().encode(s).length;
}

function str(v: Json | undefined): string | null {
  return typeof v === "string" ? v : v === undefined || v === null ? null : String(v);
}

function tagsOf(r: ConceptRecord): string[] {
  const t = field(r, "tags");
  if (Array.isArray(t)) return t.filter((x) => x !== null).map((x) => String(x));
  return typeof t === "string" ? [t] : [];
}

type LinkKind = "body" | "source";

/** A record's links into the library: body links, then internal source resources. */
function linkGraph(r: ConceptRecord): [StoredLink | StoredSource, LinkKind][] {
  const out: [StoredLink | StoredSource, LinkKind][] = [];
  for (const l of r.links) if (!isDerivedTarget(l)) out.push([l, "body"]);
  for (const s of r.sources ?? []) out.push([s, "source"]);
  return out;
}

function brokenLink(kind: string, raw: string, path: string): LintWarning {
  const what = kind === "source" ? `Source resource ${raw}` : `Link ${raw}`;
  return {
    code: "broken_link",
    message: `${what} points to /${path}, which does not exist.`,
    target: path,
  };
}

/** Links to `index.md`, `log.md` or a directory name synthesized files, not concepts. */
function isDerivedTarget(link: { raw: string; path: string }): boolean {
  const raw = splitAnchor(link.raw).path;
  return isReserved(link.path) || raw.endsWith("/");
}

/**
 * Refuses a written concept that has no usable frontmatter or no `type` (tempra-dev:
 * decisions/write-refuses-invalid-concepts). Imports keep such files, with lint.
 */
function refuseInvalid(path: string, parsed: ParsedConcept, lint: LintWarning[]) {
  if (parsed.fmError !== null) {
    throw new OkfError(
      400,
      parsed.rawFm === null ? "missing_type" : "bad_frontmatter",
      `${path}: ${parsed.fmError} Nothing was written.`,
    );
  }
  if (lint.some((l) => l.code === "missing_type")) {
    throw new OkfError(
      400,
      "missing_type",
      `${path}: \`type\` is required, a non-empty string naming what kind of thing this is (Metric, Decision, Runbook; reuse a type \`start\` lists). Nothing was written.`,
    );
  }
}

/** Search snippet markers: control characters, which concept text never holds. */
const MARK_OPEN = "\u0002";
const MARK_CLOSE = "\u0003";
/** A match's end, white space, and the next match's start: one highlight. */
const ADJACENT_MARKS = new RegExp(`${MARK_CLOSE}(\\s+)${MARK_OPEN}`, "g");

/** What search indexes of a body: its text as the reader shows it, footnote definitions too. */
function searchText(doc: Doc): string {
  const notes = doc.children.flatMap((n) => (n.type === "footnoteDefinition" ? n.children : []));
  const text = [docText(doc).text, docText({ type: "root", children: notes } as Doc).text];
  return text.join("\n").replaceAll(ATOM, " ");
}

/** The markdown of a tree the app sent; refused when it is not one. */
function bodyOf(doc: unknown): string {
  const bad = () =>
    new OkfError(400, "bad_doc", "`doc` must be a body tree as the API returns it.");
  if (!doc || typeof doc !== "object" || (doc as Doc).type !== "root") throw bad();
  if (!Array.isArray((doc as Doc).children)) throw bad();
  try {
    return toMarkdown(doc as Doc);
  } catch {
    throw bad();
  }
}

/**
 * One library's storage: blobs, the ledger and derived indexes (spec: Data model, The ledger,
 * Write path). Synchronous and free of Worker APIs, so it runs in the Library DO and under bun.
 */
export class LibraryStore {
  private readonly cap: number;
  private readonly clock: () => Date;
  private readonly size: (() => number) | null;
  private readonly records = new Map<string, ConceptRecord>();
  private readonly snapshots = new Map<number, Snapshot>();
  /** Missing-heading lint at head, by concept, for the seq it was worked out at (TEMPRA-86). */
  private anchorCache: { seq: number; lint: Map<string, LintWarning[]> } | null = null;
  /** Reads counted in memory (TEMPRA-87), by day and concept, and how many in all. */
  private readonly reads = new Map<string, Map<string, number>>();
  private unflushed = 0;
  /** The write in progress: the seq it started from, and the files its content changes touched. */
  private touch: { before: number; ids: Set<string>; paths: Set<string> } | null = null;
  /** Committed writes since the kept lint's seq, in order: what each touched, from and to seq. */
  private anchorTouched: { before: number; after: number; ids: Set<string>; paths: Set<string> }[] =
    [];

  constructor(
    private readonly sql: SqlHandle,
    opts: StoreOptions = {},
  ) {
    this.cap = opts.conceptCap ?? DEFAULT_CONCEPT_CAP;
    this.clock = opts.now ?? (() => new Date());
    this.size = opts.size ?? null;
    migrate(sql);
    this.reindexSearch();
    this.addStaleTimes();
    this.addStructure();
    this.addLedgerCounts();
    this.addFtsRows();
  }

  /**
   * Search rows are found by rowid through `fts_rows` (TEMPRA-87). Libraries from before get the
   * table once, filled from the rowids their search rows already have.
   */
  private addFtsRows() {
    if (this.sql.all("SELECT 1 FROM meta WHERE key = 'fts_rows'").length > 0) return;
    this.sql.transaction(() => {
      this.sql.script(
        "CREATE TABLE IF NOT EXISTS fts_rows (concept_id TEXT PRIMARY KEY, fts_rowid INTEGER NOT NULL);",
      );
      this.sql.run("DELETE FROM fts_rows");
      this.sql.run(
        "INSERT OR REPLACE INTO fts_rows (concept_id, fts_rowid) SELECT concept_id, rowid FROM fts",
      );
      this.sql.run("INSERT INTO meta (key, value) VALUES ('fts_rows', '1')");
    });
  }

  /** Removes a concept's search row, by rowid (TEMPRA-87). */
  private dropSearchRow(id: string) {
    this.sql.run(
      "DELETE FROM fts WHERE rowid IN (SELECT fts_rowid FROM fts_rows WHERE concept_id = ?)",
      id,
    );
    this.sql.run("DELETE FROM fts_rows WHERE concept_id = ?", id);
  }

  /**
   * The ledger's counts are kept by triggers (TEMPRA-86). Libraries from before get the tables
   * and triggers once, filled from the ledger as it stands.
   */
  private addLedgerCounts() {
    if (this.sql.all("SELECT 1 FROM meta WHERE key = 'ledger_counts'").length > 0) return;
    this.sql.transaction(() => {
      this.sql.script(LEDGER_COUNTS);
      this.sql.run(
        `UPDATE ledger_counts SET events = (SELECT COUNT(*) FROM events),
           requests = (SELECT COUNT(DISTINCT request_id) FROM events) WHERE id = 1`,
      );
      this.sql.run("DELETE FROM contributors");
      this.sql.run(
        `INSERT INTO contributors (person, agent, agent_key, requests, first_seq, last_seq)
         SELECT person, agent, CASE WHEN agent IS NULL THEN 'n' ELSE 's' || agent END,
                COUNT(DISTINCT request_id), MIN(seq), MAX(seq)
         FROM (SELECT json_extract(meta, '$.by.person') AS person,
                      json_extract(meta, '$.by.agent') AS agent, request_id, seq
               FROM events WHERE meta IS NOT NULL AND json_extract(meta, '$.by.person') IS NOT NULL)
         GROUP BY person, agent`,
      );
      this.sql.run("INSERT INTO meta (key, value) VALUES ('ledger_counts', '1')");
    });
  }

  /**
   * Libraries from before the structure process (TEMPRA-64) get a first run on open, so the work
   * queue has every directory's flags at once, not only those of directories written since.
   */
  private addStructure() {
    if (this.sql.all("SELECT 1 FROM meta WHERE key = 'structure'").length > 0) return;
    this.sql.transaction(() => {
      this.syncStructure(null, this.headSeq());
      this.sql.run("INSERT INTO meta (key, value) VALUES ('structure', '1')");
    });
  }

  /**
   * The staleness process needs `stale_after` as a number it can range over (TEMPRA-63).
   * Libraries created before that get the column and its index once, then a first run, so the
   * work queue never misses a concept that went stale before the first alarm.
   */
  private addStaleTimes() {
    if (this.sql.all("SELECT 1 FROM meta WHERE key = 'stale_ms'").length > 0) return;
    const dated = this.sql.transaction(() => {
      const cols = this.sql.all<{ name: string }>("PRAGMA table_info(concepts)");
      if (!cols.some((c) => c.name === "stale_ms")) {
        this.sql.run("ALTER TABLE concepts ADD COLUMN stale_ms INTEGER");
      }
      this.sql.script(
        "CREATE INDEX IF NOT EXISTS concepts_stale ON concepts(stale_ms) WHERE stale_ms IS NOT NULL;\n" +
          "CREATE INDEX IF NOT EXISTS flags_kind ON flags(kind);",
      );
      const rows = this.sql.all<{ concept_id: string; stale_after: string }>(
        "SELECT concept_id, stale_after FROM concepts WHERE stale_after IS NOT NULL",
      );
      for (const r of rows) {
        this.sql.run(
          "UPDATE concepts SET stale_ms = ? WHERE concept_id = ?",
          staleTime(r.stale_after),
          r.concept_id,
        );
      }
      this.sql.run("INSERT INTO meta (key, value) VALUES ('stale_ms', '1')");
      return rows.length > 0;
    });
    if (dated) this.maintainStaleness();
  }

  /**
   * Search indexes a concept's text, not its markdown, so markup and link targets are neither
   * matched nor highlighted (TEMPRA-28). Libraries indexed before that are reindexed once.
   */
  private reindexSearch() {
    const done = this.sql.all("SELECT 1 FROM meta WHERE key = 'fts_text'").length > 0;
    if (done) return;
    this.sql.transaction(() => {
      const rows = this.sql.all<{ concept_id: string; hash: string }>(
        "SELECT concept_id, hash FROM paths WHERE kind = 'concept'",
      );
      for (const row of rows) {
        this.sql.run(
          "UPDATE fts SET body = ? WHERE concept_id = ?",
          searchText(this.record(row.hash).doc),
          row.concept_id,
        );
      }
      this.sql.run("INSERT INTO meta (key, value) VALUES ('fts_text', '1')");
    });
  }

  // ---------------------------------------------------------------- ledger primitives

  headSeq(): number {
    return this.sql.all<{ s: number }>("SELECT COALESCE(MAX(seq), 0) AS s FROM events")[0]?.s ?? 0;
  }

  private appendEvent(
    ctx: RequestContext,
    ts: string,
    e: {
      op: string;
      path: string;
      prev_hash: string | null;
      hash: string | null;
      concept_id: string;
      meta?: JsonObject;
    },
  ): number {
    const meta: JsonObject = { ...(e.meta ?? {}) };
    if (ctx.note) meta.note = ctx.note;
    if (ctx.by?.person) {
      meta.by = ctx.by.agent
        ? { person: ctx.by.person, agent: ctx.by.agent }
        : { person: ctx.by.person };
    }
    const rows = this.sql.all<{ seq: number }>(
      `INSERT INTO events (ts, actor, request_id, op, path, prev_hash, hash, concept_id, meta)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING seq`,
      ts,
      ctx.actor,
      ctx.request_id,
      e.op,
      e.path,
      e.prev_hash,
      e.hash,
      e.concept_id,
      Object.keys(meta).length > 0 ? JSON.stringify(meta) : null,
    );
    const seq = rows[0]?.seq;
    if (seq === undefined) throw new Error("event insert returned no seq");
    return seq;
  }

  private putRecord(r: ConceptRecord): string {
    const content = serializeRecord(r);
    const hash = sha256Hex(content);
    this.sql.run(
      "INSERT OR IGNORE INTO blobs (hash, size, location, content, media) VALUES (?, ?, 'inline', ?, 'text/markdown')",
      hash,
      utf8Length(content),
      content,
    );
    this.records.set(hash, r);
    return hash;
  }

  private record(hash: string): ConceptRecord {
    const cached = this.records.get(hash);
    if (cached) return cached;
    const row = this.sql.all<{ content: string | ArrayBuffer }>(
      "SELECT content FROM blobs WHERE hash = ?",
      hash,
    )[0];
    if (!row) throw new Error(`missing blob ${hash}`);
    const text =
      typeof row.content === "string" ? row.content : new TextDecoder().decode(row.content);
    const r = deserializeRecord(text);
    if (this.records.size > 2000) this.records.clear();
    this.records.set(hash, r);
    return r;
  }

  private blobInfo(hash: string): BlobRef & { location: string } {
    const row = this.sql.all<{ size: number; media: string | null; location: string }>(
      "SELECT size, media, location FROM blobs WHERE hash = ?",
      hash,
    )[0];
    if (!row) throw new Error(`missing blob ${hash}`);
    return { hash, size: row.size, media: row.media, location: row.location };
  }

  private pathRow(path: string): PathRow | undefined {
    return this.sql.all<PathRow>(
      "SELECT path, concept_id, hash, kind, last_seq AS seq, created_seq FROM paths WHERE path = ?",
      path,
    )[0];
  }

  /** A path as a client addresses it: exact, or a concept without its `.md` suffix. */
  private lookupRow(path: string): PathRow | undefined {
    return this.pathRow(path) ?? (path.endsWith(".md") ? undefined : this.pathRow(`${path}.md`));
  }

  private verifiedAt(conceptId: string, seq: number): Verification[] {
    return this.sql.all<Verification>(
      "SELECT by, at FROM verifications WHERE concept_id = ? AND seq <= ? ORDER BY seq",
      conceptId,
      seq,
    );
  }

  private redirectAt(path: string, seq: number): string | undefined {
    return this.sql.all<{ concept_id: string }>(
      "SELECT concept_id FROM redirects WHERE old_path IN (?, ?) AND since_seq <= ? ORDER BY since_seq DESC LIMIT 1",
      path,
      `${path}.md`,
      seq,
    )[0]?.concept_id;
  }

  /**
   * The snapshot at `at` (default head). Committed snapshots are cached; the head's is moved
   * forward in place by each write (`settle`). Reads inside a write transaction use `live()`.
   */
  private snapshot(at?: number): Snapshot {
    const head = this.headSeq();
    const seq = at === undefined ? head : at;
    if (!Number.isInteger(seq) || seq < 0 || seq > head) {
      throw new OkfError(400, "bad_seq", `Sequence ${at} is outside 0..${head}.`);
    }
    const cached = this.snapshots.get(seq);
    if (cached) return cached;
    const entries =
      seq === head
        ? this.headEntries()
        : this.sql
            .all<Entry & { location: string }>(
              `SELECT e.path, e.concept_id, e.hash, e.seq, b.location FROM events e
               JOIN (SELECT concept_id, MAX(seq) AS m FROM events
                     WHERE seq <= ? AND op != 'comment' GROUP BY concept_id) x
                 ON e.seq = x.m
               JOIN blobs b ON b.hash = e.hash
               WHERE e.hash IS NOT NULL`,
              seq,
            )
            .map((e) => ({ ...e, kind: (e.location === "r2" ? "attachment" : "concept") as Kind }));
    const snap = new Snapshot(seq, entries);
    if (this.snapshots.size > 32) this.snapshots.clear();
    this.snapshots.set(seq, snap);
    return snap;
  }

  /** The head inside a write transaction, file by file (TEMPRA-87). */
  private live(): View {
    return new LiveView(this.sql, this.headSeq());
  }

  private headEntries(): Entry[] {
    return this.sql.all<Entry>("SELECT path, concept_id, hash, kind, last_seq AS seq FROM paths");
  }

  // ---------------------------------------------------------------- writes

  /** Applies ops as one all-or-nothing request (spec: Write path, Tier 1; POST /batch). */
  apply(ctx: RequestContext, ops: WriteOp[]): WriteResult {
    if (ops.length === 0) throw new OkfError(400, "empty_request", "No operations to apply.");
    try {
      return this.guard(() =>
        this.sql.transaction(() => {
          const w = this.begin(ctx);
          const n = ops.length;
          for (const [i, op] of ops.entries()) this.atOp(n, i, op, () => this.planCreate(w, op));
          const results = ops.flatMap((op, i) => this.atOp(n, i, op, () => this.applyOp(w, op)));
          return {
            request_id: ctx.request_id,
            seq: this.headSeq(),
            results: this.finish(w, results),
          };
        }),
      );
    } catch (e) {
      throw this.asCommitted(e, ops);
    }
  }

  /**
   * An error from a request of several ops, with `current_hash` and `current` as committed. Built
   * inside the transaction, they would show what earlier ops of the request did, which the
   * rollback undid (TEMPRA-44).
   */
  private asCommitted(e: unknown, ops: WriteOp[]): unknown {
    if (!(e instanceof OkfError) || ops.length < 2) return e;
    if (e.extra.current_hash === undefined && e.extra.current === undefined) return e;
    const op = typeof e.extra.op_index === "number" ? ops[e.extra.op_index] : undefined;
    const p = op ? normalizePath(op.path) : null;
    if (!p) return e;
    const row = this.lookupRow(p);
    const extra: Record<string, unknown> = { ...e.extra, current_hash: row?.hash ?? null };
    if (typeof e.extra.current === "string") {
      if (row?.kind === "concept") {
        extra.current = this.renderEntry(this.live(), row, false);
      } else delete extra.current;
    }
    return new OkfError(e.status, e.code, e.message, extra);
  }

  /**
   * Imports a bundle as one request (spec: Import and export). Keeps each file's own `generated`
   * and records its `verified` entries as verify events; incoming `index.md` and `log.md` are
   * discarded because the service synthesizes them.
   */
  import(ctx: RequestContext, files: ImportFile[], source?: string): ImportResult {
    return this.guard(() =>
      this.sql.transaction(() => {
        const w = this.begin(ctx);
        w.mode = "import";
        w.source = source ?? null;
        const skipped: string[] = [];
        const ops: WriteOp[] = [];
        for (const f of files) {
          const path = normalizePath(f.path);
          if (!path) throw new OkfError(400, "bad_path", `Invalid path ${f.path}.`);
          if (isReserved(path)) {
            skipped.push(path);
            continue;
          }
          ops.push(
            "markdown" in f
              ? { op: "write", path, content: f.markdown }
              : { op: "attach", path, blob: f.blob },
          );
        }
        for (const op of ops) this.planCreate(w, op);
        const results = this.finish(
          w,
          ops.flatMap((op) => this.applyOp(w, op)),
        );
        return {
          request_id: ctx.request_id,
          seq: this.headSeq(),
          files: ops.length,
          skipped,
          warnings: results
            .filter((r) => r.lint.length > 0)
            .map((r) => ({ path: r.path, lint: r.lint })),
        };
      }),
    );
  }

  /** Forward-only rollback of one path to its state at `to_seq`, or of a whole request. */
  revert(ctx: RequestContext, target: { path: string; to_seq: number } | { request_id: string }) {
    return this.guard(() =>
      this.sql.transaction(() => {
        const w = this.begin(ctx);
        const results =
          "request_id" in target
            ? this.revertRequest(w, target.request_id)
            : this.revertPath(w, target.path, target.to_seq);
        if (results.length === 0) {
          throw new OkfError(
            409,
            "nothing_to_revert",
            "The target state equals the current state.",
          );
        }
        return {
          request_id: ctx.request_id,
          seq: this.headSeq(),
          results: this.finish(w, results),
        };
      }),
    );
  }

  private guard<T>(fn: () => T): T {
    // The reads counted so far go in before the write, in their own transaction.
    this.flushReads();
    try {
      const out = fn();
      this.settle();
      return out;
    } catch (e) {
      // A rolled-back transaction may have cached state for sequence numbers it never committed.
      this.snapshots.clear();
      this.anchorCache = null;
      this.anchorTouched = [];
      this.touch = null;
      throw e;
    }
  }

  /**
   * After a committed write: moves the head snapshot forward to it in place (TEMPRA-87), and
   * records what it touched so the kept missing-heading lint catches up when next read
   * (TEMPRA-86). What it touched is what its events name: their concepts, paths and moves' origins.
   */
  private settle() {
    const touch = this.touch;
    this.touch = null;
    if (!touch) return;
    const head = this.headSeq();
    if (head === touch.before) return;
    for (const e of this.sql.all<{ concept_id: string; path: string; from: string | null }>(
      "SELECT concept_id, path, json_extract(meta, '$.from_path') AS \"from\" FROM events WHERE seq > ?",
      touch.before,
    )) {
      touch.ids.add(e.concept_id);
      touch.paths.add(e.path);
      if (typeof e.from === "string") touch.paths.add(e.from);
    }
    const snap = this.snapshots.get(touch.before);
    if (snap) {
      this.snapshots.delete(touch.before);
      snap.advance(
        head,
        touch.ids,
        this.sql.all<Entry>(
          `SELECT path, concept_id, hash, kind, last_seq AS seq FROM paths
           WHERE concept_id IN (SELECT value FROM json_each(?))`,
          JSON.stringify([...touch.ids]),
        ),
      );
      this.snapshots.set(head, snap);
    }
    if (!this.anchorCache) return;
    if (this.anchorTouched.length >= 1000) {
      this.anchorCache = null;
      this.anchorTouched = [];
      return;
    }
    this.anchorTouched.push({ ...touch, after: head });
  }

  /**
   * The kept missing-heading lint brought up to `snap` from the writes since (TEMPRA-86): only the
   * files they touched and the concepts with an anchored link to one of them are worked out
   * again. False when the writes since are not all known, so the caller works it all out.
   */
  private catchUpAnchors(snap: Snapshot): boolean {
    const cache = this.anchorCache;
    const touched = this.anchorTouched;
    this.anchorTouched = [];
    if (!cache) return false;
    const ids = new Set<string>();
    const paths = new Set<string>();
    let seq = cache.seq;
    for (const t of touched) {
      if (t.before !== seq) return false;
      for (const id of t.ids) ids.add(id);
      for (const p of t.paths) paths.add(p);
      seq = t.after;
    }
    if (seq !== snap.seq) return false;
    if (ids.size > 0) {
      const idList = JSON.stringify([...ids]);
      const pathList = JSON.stringify(
        [...paths].flatMap((p) => [p, p.endsWith(".md") ? p.slice(0, -3) : `${p}.md`]),
      );
      const affected = new Set(ids);
      for (const { from_id } of this.sql.all<{ from_id: string }>(
        `SELECT DISTINCT from_id FROM links
         WHERE kind = 'body' AND anchor IS NOT NULL AND anchor <> '#' AND (
           to_id IN (SELECT value FROM json_each(?))
           OR to_path IN (SELECT value FROM json_each(?))
           OR to_path IN (SELECT old_path FROM redirects WHERE concept_id IN (SELECT value FROM json_each(?)))
           OR to_path || '.md' IN (SELECT old_path FROM redirects WHERE concept_id IN (SELECT value FROM json_each(?))))`,
        idList,
        pathList,
        idList,
        idList,
      )) {
        affected.add(from_id);
      }
      const headings = new Map<string, Set<string>>();
      for (const id of affected) {
        const e = snap.byId.get(id);
        const lint = e?.kind === "concept" ? this.anchorLint(snap, e, headings) : [];
        if (lint.length > 0) cache.lint.set(id, lint);
        else cache.lint.delete(id);
      }
    }
    cache.seq = snap.seq;
    return true;
  }

  private begin(ctx: RequestContext): WriteState {
    if (!ctx.actor) throw new OkfError(400, "no_actor", "Writes need an actor.");
    if (!ctx.request_id) throw new OkfError(400, "no_request_id", "Writes need a request id.");
    this.touch = { before: this.headSeq(), ids: new Set(), paths: new Set() };
    return {
      ctx,
      now: iso(this.clock()),
      mode: "write",
      source: null,
      pending: new Map(),
      written: new Map(),
      affected: new Set(),
    };
  }

  /** Pre-assigns ids to paths this request creates, so links between new files resolve. */
  private planCreate(w: WriteState, op: WriteOp) {
    if (op.op !== "write" && op.op !== "attach") return;
    const path = op.op === "write" ? this.conceptPath(op.path) : normalizePath(op.path);
    if (path && !this.pathRow(path) && !w.pending.has(path)) {
      w.pending.set(path, crypto.randomUUID());
    }
  }

  /** Runs one op of a request; in a request of several, its errors say which op failed. */
  private atOp<T>(n: number, i: number, op: WriteOp, fn: () => T): T {
    try {
      return fn();
    } catch (e) {
      if (n < 2 || !(e instanceof OkfError)) throw e;
      throw new OkfError(
        e.status,
        e.code,
        `Op ${i + 1} of ${n} (${op.op} ${op.path}): ${e.message}`,
        {
          ...e.extra,
          op_index: i,
        },
      );
    }
  }

  private applyOp(w: WriteState, op: WriteOp): OpResult[] {
    switch (op.op) {
      case "write":
        return [this.writeConcept(w, op.path, op.content, op.if_match, op.if_none_match)];
      case "attach":
        return [this.writeAttachment(w, op.path, op.blob, op.if_match, op.if_none_match)];
      case "edit":
        return [this.edit(w, op.path, op.edits, op.if_match)];
      case "move":
        return this.move(w, op.path, op.to);
      case "delete":
        return [this.remove(w, op.path, op.if_match)];
      default:
        throw new OkfError(400, "bad_op", `Unknown op ${(op as { op: string }).op}.`);
    }
  }

  /**
   * Adds broken-link and missing-heading lint to each written concept and refreshes flags on
   * affected concepts.
   */
  private finish(w: WriteState, results: OpResult[]): OpResult[] {
    for (const id of w.affected) this.refreshBroken(id);
    const snap = this.live();
    for (const r of results) {
      const id = w.written.get(r.path);
      if (!id || r.hash === null) continue;
      const broken = this.refreshBroken(id);
      const e = snap.byId.get(id);
      const anchors = e?.kind === "concept" ? this.anchorLint(snap, e) : [];
      if (broken.length + anchors.length > 0) r.lint = [...r.lint, ...broken, ...anchors];
    }
    this.refreshStructure(results, w);
    return results;
  }

  /**
   * Keeps the structure flags of the directories a request touched current (TEMPRA-64): where
   * files were written, moved from or deleted, and where the written concepts now link (a new
   * link can end an orphan). What a write changes elsewhere, such as a removed link leaving a
   * concept with none, waits for the daily run.
   */
  private refreshStructure(results: OpResult[], w: WriteState) {
    const dirs = new Set<string>();
    for (const r of results) {
      if (r.op === "verify") continue;
      dirs.add(dirname(r.path));
      if (r.from) dirs.add(dirname(r.from));
    }
    if (dirs.size === 0) return;
    const written = [...w.written.values()];
    if (written.length > 0) {
      for (const { path } of this.sql.all<{ path: string }>(
        `SELECT DISTINCT p.path FROM links l JOIN paths p ON p.concept_id = l.to_id
         WHERE l.from_id IN (SELECT value FROM json_each(?)) AND l.to_id <> l.from_id`,
        JSON.stringify(written),
      )) {
        dirs.add(dirname(path));
      }
    }
    this.syncStructure(dirs, this.headSeq());
  }

  /**
   * What the structure checks read, for the directories given (every file under each) or the
   * whole library: each file's place, a concept's title and description, and its inbound links.
   */
  private structureEntries(dirs: Set<string> | null): StructureEntry[] {
    const select = `SELECT p.path, p.kind, p.concept_id, c.title, c.description, 0 AS inbound
      FROM paths p LEFT JOIN concepts c ON c.concept_id = p.concept_id`;
    type Row = StructureEntry;
    let rows: Row[];
    if (dirs === null || dirs.has("")) rows = this.sql.all<Row>(select);
    else {
      // The paths under each directory, a range over the primary key ('/' + 1 is '0').
      const seen = new Set<string>();
      rows = [];
      for (const dir of dirs) {
        for (const r of this.sql.all<Row>(
          `${select} WHERE p.path > ? AND p.path < ?`,
          `${dir}/`,
          `${dir}0`,
        )) {
          if (seen.has(r.path)) continue;
          seen.add(r.path);
          rows.push(r);
        }
      }
    }
    const ids = rows.filter((r) => r.kind === "concept").map((r) => r.concept_id);
    if (ids.length === 0) return rows;
    const inbound = new Map(
      this.sql
        .all<{ to_id: string; n: number }>(
          `SELECT to_id, COUNT(DISTINCT from_id) AS n FROM links
           WHERE to_id IN (SELECT value FROM json_each(?)) AND from_id <> to_id GROUP BY to_id`,
          JSON.stringify(ids),
        )
        .map((r) => [r.to_id, r.n]),
    );
    for (const r of rows) r.inbound = inbound.get(r.concept_id) ?? 0;
    return rows;
  }

  /**
   * Brings the stored structure flags in line with the checks, for the directories given or the
   * whole library. A flag that stays keeps the seq it was first raised at. Returns the flags now
   * set in scope, and the keys newly flagged.
   */
  private syncStructure(dirs: Set<string> | null, seq: number) {
    const entries = this.structureEntries(dirs);
    const total =
      dirs === null
        ? entries.filter((e) => e.kind === "concept").length
        : (this.sql.all<{ n: number }>("SELECT COUNT(*) AS n FROM concepts")[0]?.n ?? 0);
    const found = checkStructure(entries, dirs, total);
    // The stored flags in scope: the directories' own, and their concepts'.
    const keys =
      dirs === null
        ? null
        : [
            ...[...dirs].map(dirKey),
            ...entries
              .filter((e) => e.kind === "concept" && dirs.has(dirname(e.path)))
              .map((e) => e.concept_id),
          ];
    const stored = new Map(
      this.sql
        .all<{ concept_id: string; detail: string }>(
          `SELECT concept_id, detail FROM flags WHERE kind = 'structure'${
            keys ? " AND concept_id IN (SELECT value FROM json_each(?))" : ""
          }`,
          ...(keys ? [JSON.stringify(keys)] : []),
        )
        .map((f) => [f.concept_id, f.detail]),
    );
    const mine = new Set(stored.keys());
    const became: string[] = [];
    for (const [key, issues] of found) {
      mine.delete(key);
      const detail = JSON.stringify(issues);
      if (stored.get(key) === detail) continue;
      if (!stored.has(key)) became.push(key);
      this.sql.run(
        `INSERT INTO flags (concept_id, kind, since_seq, detail) VALUES (?, 'structure', ?, ?)
         ON CONFLICT(concept_id, kind) DO UPDATE SET detail = excluded.detail`,
        key,
        seq,
        detail,
      );
    }
    for (const key of mine) {
      this.sql.run("DELETE FROM flags WHERE concept_id = ? AND kind = 'structure'", key);
    }
    return { found, became };
  }

  private conceptPath(input: string): string {
    const p = normalizePath(input);
    if (!p) throw new OkfError(400, "bad_path", `Invalid path ${JSON.stringify(input)}.`);
    return p.endsWith(".md") ? p : `${p}.md`;
  }

  private checkPreconditions(
    path: string,
    cur: PathRow | undefined,
    ifMatch: string | null | undefined,
    ifNoneMatch: boolean | undefined,
    mode: WriteMode,
  ) {
    if (mode === "import") return;
    const current_hash = cur?.hash ?? null;
    if (ifNoneMatch && cur) {
      throw new OkfError(
        409,
        "exists",
        `${path} already exists; to replace it, send its current hash as if_match.`,
        { current_hash },
      );
    }
    if (ifMatch) {
      if (!cur || cur.hash !== ifMatch) {
        throw new OkfError(412, "precondition_failed", `${path} does not match If-Match.`, {
          current_hash,
        });
      }
    } else if (cur) {
      throw new OkfError(
        409,
        "exists",
        `${path} already exists; to replace it, send its current hash as if_match.`,
        { current_hash },
      );
    }
  }

  private writeConcept(
    w: WriteState,
    input: string,
    content: ConceptContent,
    ifMatch?: string | null,
    ifNoneMatch?: boolean,
  ): OpResult {
    const path = this.conceptPath(input);
    if (isReserved(path)) {
      throw new OkfError(405, "reserved_path", `${basename(path)} is synthesized by the server.`);
    }
    const cur = this.pathRow(path);
    this.checkPreconditions(path, cur, ifMatch, ifNoneMatch, w.mode);
    const markdown =
      typeof content === "string"
        ? content
        : `---\n${yamlStringify(content.frontmatter ?? {})}---\n${bodyOf(content.doc)}`;
    const curConcept = cur?.kind === "concept" ? cur : undefined;
    const storedVerified = curConcept ? this.verifiedAt(curConcept.concept_id, cur?.seq ?? 0) : [];
    const prev = curConcept ? this.record(curConcept.hash) : null;
    const parsed = parseConcept(markdown);
    const built = buildRecord(parsed, {
      path,
      mode: w.mode === "import" ? "import" : "write",
      actor: w.ctx.actor,
      now: w.now,
      stored: prev ? { generated: prev.generated, verified: storedVerified } : null,
      prev: prev?.doc ?? null,
      hints: typeof content === "string" ? null : content.doc,
    });
    if (w.mode !== "import") refuseInvalid(path, parsed, built.lint);
    // An ordinary write lapses every earlier verification (spec: What the service derives); with
    // one-second timestamps, keep the new stamp strictly after the latest one.
    const generated = built.record.generated;
    if (w.mode !== "import" && generated && typeof generated.at === "string") {
      const latest = Math.max(
        ...storedVerified.map((v) => Date.parse(v.at)).filter(Number.isFinite),
      );
      if (Date.parse(generated.at) <= latest) {
        built.record.generated = { ...generated, at: iso(new Date(latest + 1000)) };
      }
    }
    this.resolveTargets(built.record, path, w);
    const verified = w.mode === "import" ? built.verified : storedVerified;
    const size = utf8Length(renderConcept(built.record, { verified }));
    if (size > this.cap) {
      throw new OkfError(
        413,
        "concept_too_large",
        `${path} renders to ${size} bytes, over the ${this.cap}-byte concept cap. Split it into smaller concepts linked from a short overview.`,
      );
    }
    const hash = this.putRecord(built.record);
    const conceptId = cur?.concept_id ?? w.pending.get(path) ?? crypto.randomUUID();
    let seq = cur?.seq ?? 0;
    if (!cur || cur.hash !== hash) {
      seq = this.appendEvent(w.ctx, w.now, {
        op: w.mode === "import" ? "import" : "put",
        path,
        prev_hash: cur?.hash ?? null,
        hash,
        concept_id: conceptId,
        meta: w.source ? { source: w.source } : undefined,
      });
      this.setPath(path, conceptId, hash, "concept", seq, cur?.created_seq ?? seq);
      this.indexConcept(conceptId, path, built.record, built.lint, seq);
      this.healLinksTo(w, path, conceptId);
    }
    if (w.mode === "import") {
      for (const v of built.verified) {
        if (storedVerified.some((s) => s.by === v.by && s.at === v.at)) continue;
        seq = this.recordVerification(w, conceptId, path, hash, v);
      }
    }
    w.written.set(path, conceptId);
    const result: OpResult = {
      op: w.mode === "import" ? "import" : "put",
      path,
      hash,
      seq,
      lint: built.lint,
    };
    if (w.mode === "import") return result;
    const notices = [...built.notices];
    const staleAfter = field(built.record, "stale_after");
    if (isStale(staleAfter, this.clock().getTime())) {
      notices.push({
        code: "stale_on_write",
        message: `stale_after ${String(staleAfter)} has already passed, so the concept is stale (and in \`work\`) from now on; move it forward if it holds.`,
      });
    }
    if (typeof content === "string") {
      // Compared with the server-owned fields as the writer sent them, so an edit of the rendered
      // document (which carries the old stamp) is not reported, nor are ignored fields twice.
      const asSent = renderConcept(
        { ...built.record, generated: parsed.generated },
        { verified: parsed.verified ?? [] },
      );
      const tidy = (t: string) =>
        t
          .replace(/^\uFEFF/, "")
          .replace(/\r\n?/g, "\n")
          .trimEnd();
      // Spacing only: blanks and the length of table rules, as in a table's padding.
      const squash = (t: string) =>
        tidy(t)
          .split("\n")
          .map((l) => l.replace(/\s+/g, "").replace(/-+/g, "-"))
          .join("\n");
      if (tidy(asSent) !== tidy(markdown)) {
        if (squash(asSent) === squash(markdown)) {
          notices.push({
            code: "normalized",
            message:
              "Stored in canonical form; only spacing changed (table padding, indentation). `edit` against the stored text, as `read` shows it.",
          });
        } else {
          // The diff shows what is stored, server-owned fields included (TEMPRA-45).
          const stored = renderConcept(built.record, { verified });
          result.normalized = unifiedDiff(`${tidy(markdown)}\n`, `${tidy(stored)}\n`, {
            from: "sent",
            to: "stored",
          });
          notices.push({
            code: "normalized",
            message:
              "Stored in canonical form, which differs from what you sent (see the diff); `edit` against the stored text, as `read` shows it.",
          });
        }
      }
    }
    if (prev && curConcept && hash !== curConcept.hash) {
      notices.push(...this.threadNotices(conceptId, prev, built.record));
    }
    if (notices.length > 0) result.notices = notices;
    return result;
  }

  /** The open threads on a concept being changed, and the ones this change left outdated. */
  private threadNotices(conceptId: string, prev: ConceptRecord, next: ConceptRecord) {
    const open = this.sql.all<{ id: string; anchor: string | null }>(
      "SELECT id, anchor FROM threads WHERE concept_id = ? AND status = 'open' ORDER BY created_seq",
      conceptId,
    );
    if (open.length === 0) return [];
    const out: LintWarning[] = [
      {
        code: "open_comments",
        message: `${open.length} open comment thread${open.length === 1 ? "" : "s"} on this concept (${open.map((t) => t.id).join(", ")}): read them with \`comments\`, and answer what your change addressed.`,
      },
    ];
    const before = docText(prev.doc);
    const after = docText(next.doc);
    for (const t of open) {
      if (!t.anchor) continue;
      const anchor = JSON.parse(t.anchor) as StoredAnchor;
      if (locate(before, anchor) && !locate(after, anchor)) {
        out.push({
          code: "comment_outdated",
          message: `Thread ${t.id} was on “${clip(anchor.quote, 80)}”, which is no longer in the body; the thread is now outdated. Reply on it if your change addressed it.`,
        });
      }
    }
    return out;
  }

  /**
   * Links to a heading their target does not have, worked out from the target's current headings
   * whenever the linking concept's lint is read, never stored (tempra-dev:
   * decisions/link-lint-at-read-time, TEMPRA-41). `headings` caches each target version's anchors.
   */
  private anchorLint(
    snap: View,
    e: Entry,
    headings = new Map<string, Set<string>>(),
  ): LintWarning[] {
    const out: LintWarning[] = [];
    for (const l of this.record(e.hash).links) {
      if (!l.anchor || l.anchor === "#" || isDerivedTarget(l)) continue;
      const target = this.targetAt(snap, l);
      if (target?.kind !== "concept") continue;
      let ids = headings.get(target.hash);
      if (!ids) {
        ids = headingIds(this.record(target.hash).doc);
        headings.set(target.hash, ids);
      }
      const id = safeDecode(l.anchor.slice(1));
      if (ids.has(id)) continue;
      out.push({
        code: "missing_heading",
        message: `Link ${this.href(snap, e, l)} names a heading /${target.path} does not have (#${id}).`,
        target: target.path,
      });
    }
    return out;
  }

  private recordVerification(
    w: WriteState,
    conceptId: string,
    path: string,
    hash: string,
    v: Verification,
  ): number {
    const seq = this.appendEvent(w.ctx, w.now, {
      op: "verify",
      path,
      prev_hash: hash,
      hash,
      concept_id: conceptId,
      meta: { by: v.by, at: v.at },
    });
    this.sql.run(
      "INSERT INTO verifications (concept_id, by, at, seq) VALUES (?, ?, ?, ?)",
      conceptId,
      v.by,
      v.at,
      seq,
    );
    this.sql.run("UPDATE paths SET last_seq = ? WHERE concept_id = ?", seq, conceptId);
    return seq;
  }

  private writeAttachment(
    w: WriteState,
    input: string,
    blob: BlobRef,
    ifMatch?: string | null,
    ifNoneMatch?: boolean,
  ): OpResult {
    const path = normalizePath(input);
    if (!path) throw new OkfError(400, "bad_path", `Invalid path ${JSON.stringify(input)}.`);
    if (isReserved(path)) {
      throw new OkfError(405, "reserved_path", `${basename(path)} is synthesized by the server.`);
    }
    if (path.endsWith(".md")) {
      throw new OkfError(400, "bad_attachment", "Markdown files are concepts, not attachments.");
    }
    if (!/^[0-9a-f]{64}$/.test(blob.hash)) {
      throw new OkfError(400, "bad_blob", "Attachment hash must be a lowercase hex SHA-256.");
    }
    const cur = this.pathRow(path);
    this.checkPreconditions(path, cur, ifMatch, ifNoneMatch, w.mode);
    this.sql.run(
      "INSERT OR IGNORE INTO blobs (hash, size, location, content, media) VALUES (?, ?, 'r2', NULL, ?)",
      blob.hash,
      blob.size,
      blob.media,
    );
    const conceptId = cur?.concept_id ?? w.pending.get(path) ?? crypto.randomUUID();
    let seq = cur?.seq ?? 0;
    if (!cur || cur.hash !== blob.hash) {
      seq = this.appendEvent(w.ctx, w.now, {
        op: w.mode === "import" ? "import" : "put",
        path,
        prev_hash: cur?.hash ?? null,
        hash: blob.hash,
        concept_id: conceptId,
        meta: w.source ? { source: w.source } : undefined,
      });
      if (cur?.kind === "concept") this.unindex(cur.concept_id);
      this.setPath(path, conceptId, blob.hash, "attachment", seq, cur?.created_seq ?? seq);
      this.healLinksTo(w, path, conceptId);
    }
    return { op: w.mode === "import" ? "import" : "put", path, hash: blob.hash, seq, lint: [] };
  }

  /** Find-and-replace on the rendered document, frontmatter included (spec: PATCH /files). */
  private edit(
    w: WriteState,
    input: string,
    edits: { old: string; new: string }[],
    ifMatch?: string | null,
  ): OpResult {
    const p = normalizePath(input);
    const row = p ? this.lookupRow(p) : undefined;
    if (row?.kind !== "concept") throw notFound(input);
    if (ifMatch && ifMatch !== row.hash) {
      throw new OkfError(412, "precondition_failed", `${row.path} does not match If-Match.`, {
        current_hash: row.hash,
      });
    }
    if (!Array.isArray(edits) || edits.length === 0) {
      throw new OkfError(400, "no_edits", "Send at least one { old, new } edit.");
    }
    let doc = this.renderEntry(this.live(), row, false);
    for (const e of edits) {
      if (typeof e.old !== "string" || e.old === "" || typeof e.new !== "string") {
        throw new OkfError(
          400,
          "bad_edit",
          "Each edit needs a non-empty `old` and a string `new`.",
        );
      }
      const first = doc.indexOf(e.old);
      const count = first === -1 ? 0 : doc.split(e.old).length - 1;
      if (count !== 1) {
        throw new OkfError(
          409,
          "edit_mismatch",
          count === 0
            ? `\`old\` text not found in ${row.path}: ${JSON.stringify(e.old.slice(0, 80))}`
            : `\`old\` text matches ${count} times in ${row.path}; include more context so it matches once.`,
          { current_hash: row.hash, current: doc },
        );
      }
      doc = doc.slice(0, first) + e.new + doc.slice(first + e.old.length);
    }
    return this.writeConcept(w, row.path, doc, row.hash);
  }

  /** Moves a file, or every file under a directory prefix, one event each (spec: Moves). */
  private move(w: WriteState, input: string, toInput: string): OpResult[] {
    const from = normalizePath(input);
    const to = normalizePath(toInput);
    if (!from || !to) throw new OkfError(400, "bad_path", "Move needs valid `path` and `to`.");
    const single = this.lookupRow(from);
    let pairs: [PathRow, string][];
    if (single) {
      const dest = single.kind === "concept" && !to.endsWith(".md") ? `${to}.md` : to;
      pairs = [[single, dest]];
    } else {
      const rows = this.sql.all<PathRow>(
        "SELECT path, concept_id, hash, kind, last_seq AS seq, created_seq FROM paths WHERE path LIKE ? ESCAPE '\\' ORDER BY path",
        `${escapeLike(from)}/%`,
      );
      if (rows.length === 0) throw notFound(input);
      if (underPrefix(to, from)) {
        throw new OkfError(400, "bad_move", "Cannot move a directory into itself.");
      }
      pairs = rows.map((r) => [r, to + r.path.slice(from.length)]);
    }
    const moving = new Set(pairs.map(([r]) => r.path));
    for (const [row, dest] of pairs) {
      if (isReserved(dest)) {
        throw new OkfError(405, "reserved_path", `${basename(dest)} is synthesized by the server.`);
      }
      if (row.kind === "concept" && !isConceptPath(dest)) {
        throw new OkfError(400, "bad_path", `A concept path must end in .md: ${dest}.`);
      }
      if (row.kind === "attachment" && dest.endsWith(".md")) {
        throw new OkfError(400, "bad_path", `An attachment path cannot end in .md: ${dest}.`);
      }
      if (dest !== row.path && this.pathRow(dest) && !moving.has(dest)) {
        throw new OkfError(409, "path_exists", `Cannot move to ${dest}: a file is already there.`);
      }
    }
    for (const [row] of pairs) this.sql.run("DELETE FROM paths WHERE path = ?", row.path);
    const results: OpResult[] = [];
    for (const [row, dest] of pairs) {
      const seq = this.appendEvent(w.ctx, w.now, {
        op: "move",
        path: dest,
        prev_hash: row.hash,
        hash: row.hash,
        concept_id: row.concept_id,
        meta: { from_path: row.path },
      });
      this.setPath(dest, row.concept_id, row.hash, row.kind, seq, row.created_seq);
      this.sql.run(
        "INSERT INTO redirects (old_path, concept_id, since_seq) VALUES (?, ?, ?) ON CONFLICT(old_path) DO UPDATE SET concept_id = excluded.concept_id, since_seq = excluded.since_seq",
        row.path,
        row.concept_id,
        seq,
      );
      this.healLinksTo(w, dest, row.concept_id);
      results.push({ op: "move", path: dest, from: row.path, hash: row.hash, seq, lint: [] });
    }
    if (results.length === 0) throw notFound(input);
    return results;
  }

  private remove(w: WriteState, input: string, ifMatch?: string | null): OpResult {
    const p = normalizePath(input);
    const row = p ? this.lookupRow(p) : undefined;
    if (!row) throw notFound(input);
    if (!ifMatch) {
      throw new OkfError(428, "if_match_required", "Delete needs If-Match with the current hash.", {
        current_hash: row.hash,
      });
    }
    if (ifMatch !== row.hash) {
      throw new OkfError(412, "precondition_failed", `${row.path} does not match If-Match.`, {
        current_hash: row.hash,
      });
    }
    this.refuseOpenThreads(row, "deleting it");
    const seq = this.appendEvent(w.ctx, w.now, {
      op: "delete",
      path: row.path,
      prev_hash: row.hash,
      hash: null,
      concept_id: row.concept_id,
    });
    this.dropPath(w, row);
    return { op: "delete", path: row.path, hash: null, seq, lint: [], ...this.brokenBy(row) };
  }

  /** A note naming the concepts whose links a removal just broke (TEMPRA-49). */
  private brokenBy(row: PathRow): Pick<OpResult, "notices"> {
    const from = this.sql
      .all<{ path: string }>(
        `SELECT DISTINCT p.path FROM links l JOIN paths p ON p.concept_id = l.from_id
         WHERE l.to_id = ? AND l.from_id <> ? ORDER BY p.path`,
        row.concept_id,
        row.concept_id,
      )
      .map((r) => r.path);
    if (from.length === 0) return {};
    return {
      notices: [
        {
          code: "broken_links",
          message: `${from.length} concept${from.length === 1 ? " now links" : "s now link"} to ${row.path}, which is gone: ${from.join(", ")}. Fix the links, or revert the delete.`,
        },
      ],
    };
  }

  /**
   * A concept with open comment threads is not deleted (tempra-dev: app/comments, TEMPRA-26): the
   * threads are people's requests, and a deleted concept's threads are listed nowhere.
   */
  private refuseOpenThreads(row: PathRow, doing: string) {
    const open = this.sql.all<{ id: string }>(
      "SELECT id FROM threads WHERE concept_id = ? AND status = 'open' ORDER BY created_seq",
      row.concept_id,
    );
    if (open.length === 0) return;
    const ids = open.map((t) => t.id);
    throw new OkfError(
      409,
      "open_comments",
      `${row.path} has ${ids.length} open comment thread${ids.length === 1 ? "" : "s"} (${ids.join(", ")}); resolve ${ids.length === 1 ? "it" : "them"} before ${doing}. Read them with \`comments\`.`,
      { threads: ids },
    );
  }

  private dropPath(w: WriteState, row: PathRow) {
    this.sql.run("DELETE FROM paths WHERE path = ?", row.path);
    this.unindex(row.concept_id);
    for (const r of this.sql.all<{ from_id: string }>(
      "SELECT DISTINCT from_id FROM links WHERE to_id = ?",
      row.concept_id,
    )) {
      w.affected.add(r.from_id);
    }
  }

  // ---------------------------------------------------------------- revert

  private revertPath(w: WriteState, input: string, toSeq: number): OpResult[] {
    const p = normalizePath(input);
    if (!p) throw new OkfError(400, "bad_path", `Invalid path ${JSON.stringify(input)}.`);
    const then = this.snapshot(toSeq).lookup(p);
    const now = this.lookupRow(p);
    if (!then && !now) throw notFound(input);
    if (!then && now) return [this.restore(w, now.concept_id, now.path, null, toSeq)];
    if (!then) return [];
    if (now && now.concept_id !== then.concept_id) {
      throw new OkfError(
        409,
        "path_occupied",
        `${now.path} now holds a different file than at seq ${toSeq}; move or delete it first.`,
      );
    }
    const elsewhere = this.sql.all<PathRow>(
      "SELECT path FROM paths WHERE concept_id = ?",
      then.concept_id,
    )[0];
    if (!now && elsewhere) {
      throw new OkfError(
        409,
        "moved",
        `The file at ${then.path} as of seq ${toSeq} now lives at ${elsewhere.path}; revert that path, or move it back first.`,
      );
    }
    if (now && now.hash === then.hash) return [];
    return [this.restore(w, then.concept_id, then.path, then.hash, toSeq)];
  }

  private revertRequest(w: WriteState, requestId: string): OpResult[] {
    const events = this.sql.all<{ seq: number; concept_id: string; op: string }>(
      "SELECT seq, concept_id, op FROM events WHERE request_id = ? ORDER BY seq",
      requestId,
    );
    const first = events[0];
    if (!first) throw new OkfError(404, "not_found", `No request ${requestId}.`);
    const base = first.seq - 1;
    const before = this.snapshot(base);
    // Verifications and comments are not content: reverting a request leaves them be.
    const ids = [
      ...new Set(
        events.filter((e) => e.op !== "verify" && e.op !== "comment").map((e) => e.concept_id),
      ),
    ];
    const plan = ids.map((id) => ({
      id,
      before: before.byId.get(id),
      now: this.sql.all<PathRow>(
        "SELECT path, concept_id, hash, kind, last_seq AS seq, created_seq FROM paths WHERE concept_id = ?",
        id,
      )[0],
    }));
    const results: OpResult[] = [];
    // Deletions first, then moves back, then content, so paths free up before they are reused.
    for (const { id, before: b, now } of plan) {
      if (!b && now) results.push(this.restore(w, id, now.path, null, base));
    }
    for (const { before: b, now } of plan) {
      if (b && now && now.path !== b.path) results.push(...this.move(w, now.path, b.path));
    }
    for (const { id, before: b } of plan) {
      if (!b) continue;
      const cur = this.sql.all<PathRow>(
        "SELECT path, concept_id, hash, kind, last_seq AS seq, created_seq FROM paths WHERE concept_id = ?",
        id,
      )[0];
      if (cur && cur.hash === b.hash) continue;
      results.push(this.restore(w, id, b.path, b.hash, base));
    }
    return results;
  }

  /** Points a concept at an earlier content version (or none) with a `revert` event. */
  private restore(
    w: WriteState,
    conceptId: string,
    path: string,
    hash: string | null,
    revertedSeq: number,
  ): OpResult {
    const cur = this.pathRow(path);
    if (cur && cur.concept_id !== conceptId) {
      throw new OkfError(409, "path_occupied", `Cannot restore ${path}: another file is there.`);
    }
    if (hash === null && cur) this.refuseOpenThreads(cur, "reverting it away");
    const seq = this.appendEvent(w.ctx, w.now, {
      op: "revert",
      path,
      prev_hash: cur?.hash ?? null,
      hash,
      concept_id: conceptId,
      meta: { reverted_seq: revertedSeq },
    });
    if (hash === null) {
      if (!cur) return { op: "revert", path, hash, seq, lint: [] };
      this.dropPath(w, cur);
      return { op: "revert", path, hash, seq, lint: [], ...this.brokenBy(cur) };
    }
    const info = this.blobInfo(hash);
    const kind: Kind = info.location === "r2" ? "attachment" : "concept";
    const created = this.sql.all<{ s: number }>(
      "SELECT MIN(seq) AS s FROM events WHERE concept_id = ?",
      conceptId,
    )[0]?.s;
    this.setPath(path, conceptId, hash, kind, seq, cur?.created_seq ?? created ?? seq);
    let lint: LintWarning[] = [];
    if (kind === "concept") {
      const r = this.record(hash);
      lint = this.fieldLint(r, path, this.verifiedAt(conceptId, seq), true);
      this.indexConcept(conceptId, path, r, lint, seq);
      w.written.set(path, conceptId);
    }
    this.healLinksTo(w, path, conceptId);
    return { op: "revert", path, hash, seq, lint };
  }

  // ---------------------------------------------------------------- derived indexes

  private setPath(
    path: string,
    id: string,
    hash: string,
    kind: Kind,
    seq: number,
    created: number,
  ) {
    this.sql.run("DELETE FROM paths WHERE concept_id = ? AND path <> ?", id, path);
    this.sql.run(
      `INSERT INTO paths (path, concept_id, hash, kind, last_seq, created_seq) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET concept_id = excluded.concept_id, hash = excluded.hash,
         kind = excluded.kind, last_seq = excluded.last_seq, created_seq = excluded.created_seq`,
      path,
      id,
      hash,
      kind,
      seq,
      created,
    );
  }

  /** The concept a path names: an existing path, a file created in this request, or a redirect. */
  private resolvePath(p: string, w: WriteState): string | null {
    return (
      this.lookupRow(p)?.concept_id ??
      w.pending.get(p) ??
      (p.endsWith(".md") ? undefined : w.pending.get(`${p}.md`)) ??
      this.sql.all<{ concept_id: string }>(
        "SELECT r.concept_id FROM redirects r JOIN paths p ON p.concept_id = r.concept_id WHERE r.old_path IN (?, ?)",
        p,
        `${p}.md`,
      )[0]?.concept_id ??
      null
    );
  }

  /**
   * Resolves each body link and each internal `sources[].resource` of a record written at `path`
   * to a concept ID (spec: Concept model, Links).
   */
  private resolveTargets(r: ConceptRecord, path: string, w: WriteState) {
    for (const link of r.links) {
      if (isDerivedTarget(link)) continue;
      link.target = this.resolvePath(link.path, w);
    }
    const sources: StoredSource[] = [];
    for (const c of sourceCandidates(path, r.fm)) {
      const base = { index: c.index, raw: c.raw, anchor: c.anchor };
      let found: StoredSource | null = null;
      for (const o of c.options) {
        const target = this.resolvePath(o.path, w);
        if (target) {
          found = { ...base, ...o, target };
          break;
        }
      }
      if (!found && c.fallback) found = { ...base, ...c.fallback, target: null };
      if (found) sources.push(found);
    }
    if (sources.length > 0) r.sources = sources;
    else delete r.sources;
  }

  private indexConcept(
    id: string,
    path: string,
    r: ConceptRecord,
    lint: LintWarning[],
    seq: number,
  ) {
    const typed = new Set([
      "type",
      "title",
      "description",
      "resource",
      "status",
      "stale_after",
      "tags",
      "sources",
    ]);
    const extra = r.fm.filter(([k]) => !typed.has(k));
    const gen = r.generated;
    const staleAfter = str(field(r, "stale_after"));
    const before = this.sql.all<{ stale_after: string | null }>(
      "SELECT stale_after FROM concepts WHERE concept_id = ?",
      id,
    )[0];
    this.sql.run(
      `INSERT INTO concepts (concept_id, type, title, description, resource, status, stale_after,
         stale_ms, generated_by, generated_at, extra, lint)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(concept_id) DO UPDATE SET type = excluded.type, title = excluded.title,
         description = excluded.description, resource = excluded.resource, status = excluded.status,
         stale_after = excluded.stale_after, stale_ms = excluded.stale_ms,
         generated_by = excluded.generated_by, generated_at = excluded.generated_at,
         extra = excluded.extra, lint = excluded.lint`,
      id,
      str(field(r, "type")) ?? "",
      str(field(r, "title")),
      str(field(r, "description")),
      str(field(r, "resource")),
      effectiveStatus(field(r, "status")),
      staleAfter,
      staleTime(staleAfter),
      gen ? str(gen.by) : null,
      gen ? str(gen.at) : null,
      JSON.stringify(extra),
      JSON.stringify(lint),
    );
    const tags = tagsOf(r);
    this.sql.run("DELETE FROM tags WHERE concept_id = ?", id);
    for (const t of new Set(tags))
      this.sql.run("INSERT INTO tags (concept_id, tag) VALUES (?, ?)", id, t);

    this.sql.run("DELETE FROM links WHERE from_id = ?", id);
    for (const [l, kind] of linkGraph(r)) {
      this.sql.run(
        "INSERT INTO links (from_id, to_id, to_path, anchor, form, raw, kind) VALUES (?, ?, ?, ?, ?, ?, ?)",
        id,
        l.target,
        l.path,
        l.anchor,
        l.form,
        l.raw,
        kind,
      );
    }

    this.sql.run("DELETE FROM sources WHERE concept_id = ?", id);
    const sources = field(r, "sources");
    if (Array.isArray(sources)) {
      const counts = scanDoc(r.doc, path).footnoteCounts;
      sources.forEach((s, i) => {
        if (!s || typeof s !== "object" || Array.isArray(s)) return;
        const resource = str(s.resource);
        if (!resource) return;
        const sid = str(s.id);
        this.sql.run(
          "INSERT INTO sources (concept_id, id, resource, internal_id, cited) VALUES (?, ?, ?, ?, ?)",
          id,
          sid,
          resource,
          r.sources?.find((x) => x.index === i)?.target ?? null,
          sid ? (counts.get(sid) ?? 0) : 0,
        );
      });
    }

    this.dropSearchRow(id);
    this.sql.run(
      "INSERT INTO fts (concept_id, title, body, tags) VALUES (?, ?, ?, ?)",
      id,
      str(field(r, "title")) ?? "",
      searchText(r.doc),
      tags.join(" "),
    );
    this.sql.run(
      "INSERT INTO fts_rows (concept_id, fts_rowid) VALUES (?, last_insert_rowid())",
      id,
    );

    const nonLink = lint.filter((l) => l.code !== "broken_link");
    if (nonLink.length > 0) {
      this.sql.run(
        `INSERT INTO flags (concept_id, kind, since_seq, detail) VALUES (?, 'lint', ?, ?)
         ON CONFLICT(concept_id, kind) DO UPDATE SET detail = excluded.detail`,
        id,
        seq,
        JSON.stringify(nonLink),
      );
    } else {
      this.sql.run("DELETE FROM flags WHERE concept_id = ? AND kind = 'lint'", id);
    }

    // Only a new stale_after moves the clock (TEMPRA-63): any other write leaves the flags as
    // the staleness process last set them.
    if (!before || before.stale_after !== staleAfter) this.setStaleFlag(id, staleAfter, seq);
  }

  /** Sets a concept's stale or stale_soon flag from its `stale_after`, clearing the other. */
  private setStaleFlag(id: string, staleAfter: string | null, seq: number): Staleness | null {
    // The clock is read only when there is a date to weigh (tests count its calls).
    const now = staleAfter === null ? null : this.clock();
    const state = now ? staleness(staleAfter ?? undefined, now.getTime()) : null;
    this.sql.run(
      "DELETE FROM flags WHERE concept_id = ? AND kind IN ('stale', 'stale_soon') AND kind IS NOT ?",
      id,
      state,
    );
    if (state) {
      this.sql.run(
        `INSERT INTO flags (concept_id, kind, since_seq, detail) VALUES (?, ?, ?, ?)
         ON CONFLICT(concept_id, kind) DO UPDATE SET detail = excluded.detail`,
        id,
        state,
        seq,
        JSON.stringify({ stale_after: staleAfter, at: iso(now ?? this.clock()) }),
      );
    }
    return state;
  }

  private unindex(id: string) {
    for (const t of ["concepts", "tags", "sources", "flags"]) {
      this.sql.run(`DELETE FROM ${t} WHERE concept_id = ?`, id);
    }
    this.sql.run("DELETE FROM links WHERE from_id = ?", id);
    this.dropSearchRow(id);
  }

  /**
   * Points links written before `path` existed (or whose target was deleted) at its concept, and
   * marks every concept linking to it for a refresh: a restored concept's inbound links still
   * name it by ID, and their broken-link lint must clear (TEMPRA-25).
   */
  private healLinksTo(w: WriteState, path: string, id: string) {
    const variants = [path, path.endsWith(".md") ? path.slice(0, -3) : `${path}.md`];
    const where = `(to_path = ? OR to_path = ?) AND (to_id IS NULL OR NOT EXISTS (SELECT 1 FROM paths p WHERE p.concept_id = links.to_id))`;
    const from = this.sql.all<{ from_id: string }>(
      `SELECT DISTINCT from_id FROM links WHERE ${where}`,
      ...variants,
    );
    if (from.length > 0) this.sql.run(`UPDATE links SET to_id = ? WHERE ${where}`, id, ...variants);
    for (const r of from) w.affected.add(r.from_id);
    for (const r of this.sql.all<{ from_id: string }>(
      "SELECT DISTINCT from_id FROM links WHERE to_id = ? AND from_id <> ?",
      id,
      id,
    )) {
      w.affected.add(r.from_id);
    }
  }

  /**
   * Recomputes a concept's broken links: its broken_link flag and the broken_link entries in its
   * stored lint. Returns them as lint.
   */
  private refreshBroken(id: string): LintWarning[] {
    const broken = this.sql.all<{ to_path: string; raw: string; kind: string }>(
      `SELECT to_path, raw, kind FROM links WHERE from_id = ?
         AND (to_id IS NULL OR NOT EXISTS (SELECT 1 FROM paths p WHERE p.concept_id = links.to_id))`,
      id,
    );
    const exists = this.sql.all("SELECT 1 FROM paths WHERE concept_id = ?", id).length > 0;
    const lint = exists ? broken.map((b) => brokenLink(b.kind, b.raw, b.to_path)) : [];
    const stored = this.sql.all<{ lint: string | null }>(
      "SELECT lint FROM concepts WHERE concept_id = ?",
      id,
    )[0];
    if (stored) {
      const others = (JSON.parse(stored.lint ?? "[]") as LintWarning[]).filter(
        (l) => l.code !== "broken_link",
      );
      this.sql.run(
        "UPDATE concepts SET lint = ? WHERE concept_id = ?",
        JSON.stringify([...others, ...lint]),
        id,
      );
    }
    if (lint.length === 0) {
      this.sql.run("DELETE FROM flags WHERE concept_id = ? AND kind = 'broken_link'", id);
      return [];
    }
    this.sql.run(
      `INSERT INTO flags (concept_id, kind, since_seq, detail) VALUES (?, 'broken_link', ?, ?)
       ON CONFLICT(concept_id, kind) DO UPDATE SET detail = excluded.detail`,
      id,
      this.headSeq(),
      JSON.stringify(broken.map((b) => b.to_path)),
    );
    return lint;
  }

  // ---------------------------------------------------------------- reads

  /** The href to render for a link, as of the snapshot (spec: Concept model, Reads and export). */
  private href(snap: View, from: Entry, link: StoredLink | StoredSource): string {
    if (isDerivedTarget(link)) return link.raw;
    const target = this.targetAt(snap, link);
    if (!target) return link.raw;
    const written = splitAnchor(link.raw).path;
    const resolved =
      link.form === "root"
        ? normalizePath(safeDecode(written))
        : resolveLinkPath(from.path, safeDecode(written));
    if (resolved === target.path || `${resolved}.md` === target.path) return link.raw;
    let next: string;
    if (link.form === "absolute") next = `/${target.path}`;
    else if (link.form === "root") next = target.path;
    else {
      next = relativePath(from.path, target.path);
      if (written.startsWith("./") && !next.startsWith("../")) next = `./${next}`;
    }
    // A link written as a concept ID (no `.md`) keeps that form.
    if (!written.endsWith(".md") && next.endsWith(".md")) next = next.slice(0, -3);
    return next + (link.anchor ?? "");
  }

  /** A link's target as of the snapshot: by ID, else by path, else through a redirect. */
  private targetAt(snap: View, link: { path: string; target: string | null }) {
    let target = link.target ? snap.byId.get(link.target) : undefined;
    if (!target) target = snap.lookup(link.path);
    if (!target) {
      const id = this.redirectAt(link.path, snap.seq);
      if (id) target = snap.byId.get(id);
    }
    return target;
  }

  /**
   * Stored lint with its `relative_link` items written anew from each link's current target, so
   * the path they suggest follows moves of either end (TEMPRA-46). Only where a write stored them.
   */
  private freshLint(snap: View, e: Entry, lint: LintWarning[]): LintWarning[] {
    if (!lint.some((l) => l.code === "relative_link")) return lint;
    const out = lint.filter((l) => l.code !== "relative_link");
    for (const l of this.record(e.hash).links) {
      if (l.form !== "relative" || isDerivedTarget(l)) continue;
      const target = this.targetAt(snap, l);
      out.push({
        code: "relative_link",
        message: `Link ${this.href(snap, e, l)} is relative; write it as /${target?.path ?? l.path}${l.anchor ?? ""} so it reads the same from anywhere.`,
      });
    }
    return out;
  }

  /** Field lint of a content version, as a write of it would report (spec: OKF conformance). */
  private fieldLint(
    r: ConceptRecord,
    path: string,
    verified: Verification[],
    strict = false,
  ): LintWarning[] {
    if (r.raw_fm !== null) {
      return [
        { code: "unparseable_frontmatter", message: "Frontmatter could not be parsed as YAML." },
        ...diagramLint(r.doc),
      ];
    }
    return [
      ...lintFields(r.fm, r.generated, verified, scanDoc(r.doc, path), { strict }),
      ...diagramLint(r.doc),
    ];
  }

  /** Lint of a past version: its field lint and its links that were broken as of the snapshot. */
  private lintAt(snap: Snapshot, e: Entry, r: ConceptRecord, verified: Verification[]) {
    const lint = this.fieldLint(r, e.path, verified);
    for (const [l, kind] of linkGraph(r)) {
      if (!this.targetAt(snap, l)) lint.push(brokenLink(kind, l.raw, l.path));
    }
    return lint;
  }

  private renderEntry(snap: View, e: Entry, computed: boolean, unstamped = false): string {
    const stored = this.record(e.hash);
    const r = unstamped ? { ...stored, generated: null } : stored;
    const verified = this.verifiedAt(e.concept_id, snap.seq);
    return renderConcept(r, {
      verified,
      href: (l) => this.href(snap, e, l),
      sourceHref: (s) => this.href(snap, e, s),
      computed: computed ? this.computedValues(snap, e, r, verified) : undefined,
    });
  }

  private computedValues(snap: View, e: Entry, r: ConceptRecord, verified: Verification[]) {
    const out: [string, Json][] = [
      ["trust_tier", trustTier(r.generated, verified)],
      ["stale", isStale(field(r, "stale_after"), this.clock().getTime())],
    ];
    if (snap.seq === this.headSeq()) {
      out.push(["inbound_links", this.inboundCount(e.concept_id)]);
      out.push(["usage_count", this.usageCount(e.concept_id)]);
    }
    return out;
  }

  /**
   * One more read of a concept's current version today (spec: usage-rollup maintainer), counted
   * in memory so a read does not write (TEMPRA-87). Flushed to `access_log` by the next write,
   * every READ_FLUSH reads, before the usage pass, and by the Durable Object's alarm.
   */
  private countRead(id: string) {
    const day = iso(this.clock()).slice(0, 10);
    let counts = this.reads.get(day);
    if (!counts) {
      counts = new Map();
      this.reads.set(day, counts);
    }
    counts.set(id, (counts.get(id) ?? 0) + 1);
    if (++this.unflushed >= READ_FLUSH) this.flushReads();
  }

  /** Reads counted in memory and not yet in `access_log`. */
  pendingReads(): number {
    return this.unflushed;
  }

  /** Writes the reads counted in memory to `access_log`, in one transaction. */
  flushReads(): number {
    const n = this.unflushed;
    if (n === 0) return 0;
    this.sql.transaction(() => {
      for (const [day, counts] of this.reads) {
        for (const [id, reads] of counts) {
          this.sql.run(
            `INSERT INTO access_log (day, concept_id, actor, reads) VALUES (?, ?, '', ?)
             ON CONFLICT(day, concept_id, actor) DO UPDATE SET reads = reads + excluded.reads`,
            day,
            id,
            reads,
          );
        }
      }
    });
    this.reads.clear();
    this.unflushed = 0;
    return n;
  }

  /** Reads of a concept over the usage window, today included, flushed or not. */
  private usageCount(id: string): number {
    const start = this.windowStart();
    let pending = 0;
    for (const [day, counts] of this.reads) if (day >= start) pending += counts.get(id) ?? 0;
    return (
      (this.sql.all<{ n: number }>(
        "SELECT COALESCE(SUM(reads), 0) AS n FROM access_log WHERE concept_id = ? AND day >= ?",
        id,
        start,
      )[0]?.n ?? 0) + pending
    );
  }

  private windowStart(): string {
    const start = new Date(this.clock().getTime() - (USAGE_WINDOW_DAYS - 1) * 86_400_000);
    return iso(start).slice(0, 10);
  }

  private inboundCount(id: string): number {
    return (
      this.sql.all<{ n: number }>(
        "SELECT COUNT(DISTINCT from_id) AS n FROM links WHERE to_id = ? AND from_id <> ?",
        id,
        id,
      )[0]?.n ?? 0
    );
  }

  /** GET /files/{path}: a concept, an attachment's metadata, or a synthesized index.md / log.md. */
  read(input: string, opts: { at?: number; computed?: boolean } = {}): FileView {
    const snap = this.snapshot(opts.at);
    const path = normalizePath(input) ?? "";
    const name = basename(path);
    if (path === "" || name === "index.md" || name === "log.md") {
      const dir = path === "" || name === "index.md" ? dirname(path) : dirname(path);
      if (name === "log.md") {
        return {
          kind: "derived",
          path,
          seq: snap.seq,
          markdown: this.log({ at: snap.seq, prefix: dir }),
        };
      }
      return {
        kind: "derived",
        path: path || "index.md",
        seq: snap.seq,
        markdown: this.index(dir, snap),
      };
    }
    const e = snap.lookup(path);
    if (!e) throw this.gone(input, path, snap.seq);
    if (e.kind === "attachment") {
      const info = this.blobInfo(e.hash);
      return {
        kind: "attachment",
        path: e.path,
        hash: e.hash,
        seq: e.seq,
        size: info.size,
        media: info.media,
      };
    }
    const markdown = this.renderEntry(snap, e, opts.computed ?? false);
    const parsed = parseConcept(markdown);
    const r = this.record(e.hash);
    const verified = this.verifiedAt(e.concept_id, snap.seq);
    if (snap.seq === this.headSeq()) this.countRead(e.concept_id);
    const frontmatter: JsonObject = Object.fromEntries(parsed.entries);
    if (parsed.generated) frontmatter.generated = parsed.generated;
    if (parsed.verified)
      frontmatter.verified = parsed.verified.map((v) => ({ by: v.by, at: v.at }));
    const atHead = snap.seq === this.headSeq();
    const lintRow = atHead
      ? this.sql.all<{ lint: string | null }>(
          "SELECT lint FROM concepts WHERE concept_id = ?",
          e.concept_id,
        )[0]
      : undefined;
    const lint: LintWarning[] = [
      ...(atHead
        ? this.freshLint(snap, e, JSON.parse(lintRow?.lint ?? "[]"))
        : this.lintAt(snap, e, r, verified)),
      ...this.anchorLint(snap, e),
    ];
    return {
      kind: "concept",
      path: e.path,
      hash: e.hash,
      seq: e.seq,
      markdown,
      frontmatter,
      doc: renderDoc(r, (l) => this.href(snap, e, l)),
      lint,
      trust_tier: trustTier(r.generated, verified),
      stale: isStale(field(r, "stale_after"), this.clock().getTime()),
      stale_soon: staleness(field(r, "stale_after"), this.clock().getTime()) === "stale_soon",
      inbound_links: atHead ? this.inboundCount(e.concept_id) : 0,
      open_comments: atHead ? this.openThreadsOf(e.concept_id) : 0,
    };
  }

  /**
   * A 404 for a path with nothing there now that says what became of it: moved (and where), or
   * deleted (and how to bring it back). Saves a `log` or `grep` call.
   */
  private gone(input: string, path: string, at: number): OkfError {
    const variants = [path, path.endsWith(".md") ? path.slice(0, -3) : `${path}.md`];
    const last = this.sql.all<{ seq: number; op: string; path: string; concept_id: string }>(
      `SELECT seq, op, path, concept_id FROM events
       WHERE seq <= ? AND op != 'comment' AND (path IN (?, ?) OR json_extract(meta, '$.from_path') IN (?, ?))
       ORDER BY seq DESC LIMIT 1`,
      at,
      ...variants,
      ...variants,
    )[0];
    if (!last) return notFound(input);
    const now = this.snapshot(at).byId.get(last.concept_id);
    if (now && now.path !== path) {
      return new OkfError(
        404,
        "moved",
        `No file at ${input}: it moved to ${now.path} (seq ${last.seq}). Read it there.`,
        { moved_to: now.path, seq: last.seq },
      );
    }
    if (last.op === "delete" || (last.op === "revert" && !now)) {
      return new OkfError(
        404,
        "deleted",
        `No file at ${input}: it was deleted at seq ${last.seq}. \`revert\` with to_seq ${last.seq - 1} brings it back.`,
        { seq: last.seq },
      );
    }
    return notFound(input);
  }

  /** The synthesized index.md for a directory (spec: Tier 2). */
  index(dirInput: string, snapOrAt?: Snapshot | number): string {
    const snap = snapOrAt instanceof Snapshot ? snapOrAt : this.snapshot(snapOrAt);
    const dir = normalizeDir(dirInput);
    const subdirs = new Map<string, number>();
    const concepts: { path: string; title: string | null; description: string | null }[] = [];
    const attachments: { path: string }[] = [];
    let any = dir === "";
    for (const e of snap.sorted()) {
      if (!underPrefix(e.path, dir) || e.path === dir) continue;
      any = true;
      const rest = dir === "" ? e.path : e.path.slice(dir.length + 1);
      const slash = rest.indexOf("/");
      if (slash !== -1) {
        const name = rest.slice(0, slash);
        subdirs.set(name, (subdirs.get(name) ?? 0) + (e.kind === "concept" ? 1 : 0));
      } else if (e.kind === "concept") {
        const r = this.record(e.hash);
        concepts.push({
          path: e.path,
          title: str(field(r, "title")),
          description: str(field(r, "description")),
        });
      } else attachments.push({ path: e.path });
    }
    if (!any) throw notFound(dir ? `${dir}/index.md` : "index.md");
    return renderIndex({
      dir,
      subdirs: [...subdirs].map(([name, n]) => ({ name, concepts: n })),
      concepts,
      attachments,
    });
  }

  /**
   * The synthesized log.md: requests newest first, grouped by day (spec: Tier 2). It shows the
   * latest `limit` requests (LOG_REQUESTS by default) and then where the rest are; `limit: null`
   * lists them all, as exports do.
   */
  log(opts: { at?: number; prefix?: string; limit?: number | null } = {}): string {
    const at = opts.at ?? this.headSeq();
    const prefix = normalizeDir(opts.prefix);
    const limit = opts.limit === undefined ? LOG_REQUESTS : opts.limit;
    const snap = this.snapshot(at);
    // log.md tells what changed in the content; comments are not content. Filtered in SQL, and
    // meta parsed only where the log reads it (TEMPRA-86).
    type LogEvent = {
      seq: number;
      ts: string;
      actor: string;
      request_id: string;
      op: string;
      path: string;
      prev_hash: string | null;
      concept_id: string;
      meta: string | null;
    };
    const page = (before: number, n: number) =>
      this.sql.all<LogEvent>(
        `SELECT seq, ts, actor, request_id, op, path, prev_hash, concept_id, meta FROM events
         WHERE seq <= ? AND op != 'comment' AND (? = '' OR path = ? OR substr(path, 1, ?) = ?)
         ORDER BY seq DESC LIMIT ?`,
        before,
        prefix,
        prefix,
        prefix.length + 1,
        `${prefix}/`,
        n,
      );
    let events: LogEvent[];
    let older: number | null = null;
    if (limit === null) events = page(at, -1);
    else {
      // A request's events are consecutive seqs, so walking back from `at` in pages and stopping
      // at the first event of request limit + 1 reads what the log shows and no more (TEMPRA-86).
      events = [];
      const seen = new Set<string>();
      let cursor = at;
      walk: for (;;) {
        const rows = page(cursor, 1000);
        for (const e of rows) {
          if (!seen.has(e.request_id)) {
            if (seen.size === limit) {
              older = events.at(-1)?.seq ?? at + 1;
              break walk;
            }
            seen.add(e.request_id);
          }
          events.push(e);
        }
        if (rows.length < 1000) break;
        cursor = (rows.at(-1) as LogEvent).seq - 1;
      }
    }
    const byReq = new Map<string, (typeof events)[number][]>();
    for (const e of events) {
      const list = byReq.get(e.request_id);
      if (list) list.push(e);
      else byReq.set(e.request_id, [e]);
    }
    const meta = (m: string | null) => (m ? (JSON.parse(m) as JsonObject) : null);
    const out: LogRequest[] = [];
    for (const evs of byReq.values()) {
      evs.reverse();
      const first = evs[0];
      out.push({
        ts: first?.ts ?? "",
        actor: first?.actor ?? "",
        note: (meta(first?.meta ?? null)?.note as string | undefined) ?? null,
        events: evs.map((e) => {
          const from = e.op === "move" ? meta(e.meta)?.from_path : undefined;
          return {
            op: e.op,
            path: e.path,
            created: e.prev_hash === null,
            fromPath: typeof from === "string" ? from : null,
            // Entries link to where the file is now (as of `at`), or to nothing once it is gone.
            current: snap.byId.get(e.concept_id)?.path ?? null,
          };
        }),
      });
    }
    return renderLog(out, prefix ? `Log: ${prefix}` : "Library log", {
      before: older,
      prefix,
    });
  }

  private toRequest(id: string, events: EventRow[]): RequestRow {
    const first = events[0];
    return {
      request_id: id,
      ts: first?.ts ?? "",
      actor: first?.actor ?? "",
      note: (first?.meta?.note as string | undefined) ?? null,
      by: (first?.meta?.by as RequestRow["by"] | undefined) ?? null,
      events,
    };
  }

  private row(snap: Snapshot, e: Entry): ConceptRow {
    if (e.kind === "attachment") {
      const info = this.blobInfo(e.hash);
      return {
        path: e.path,
        kind: e.kind,
        hash: e.hash,
        seq: e.seq,
        size: info.size,
        media: info.media,
      };
    }
    const r = this.record(e.hash);
    return {
      path: e.path,
      kind: e.kind,
      hash: e.hash,
      seq: e.seq,
      type: str(field(r, "type")) ?? "",
      title: str(field(r, "title")),
      description: str(field(r, "description")),
      status: effectiveStatus(field(r, "status")),
      status_set: typeof field(r, "status") === "string" && field(r, "status") !== "",
      tags: tagsOf(r),
      trust_tier: trustTier(r.generated, this.verifiedAt(e.concept_id, snap.seq)),
      stale: isStale(field(r, "stale_after"), this.clock().getTime()),
    };
  }

  /** GET /tree: files under a prefix; with `depth`, deeper levels collapse into directory entries. */
  /**
   * GET /outline: every file's path, kind, title and sequence, for the app's file tree. Lean on
   * purpose: titles come from the record cache, and nothing else per file is looked up (no trust
   * tier, no attachment sizes), so it stays cheap to ask for after every burst of writes.
   */
  outline(opts: { at?: number } = {}) {
    const snap = this.snapshot(opts.at);
    // Open comment threads, at head only (comments are not versioned with content).
    const atHead = snap.seq === this.headSeq();
    const open = atHead ? this.openThreadCounts() : new Map<string, number>();
    const stale = atHead ? this.staleFlags() : new Map<string, Staleness>();
    const files = snap.sorted().map((e) => ({
      path: e.path,
      kind: e.kind,
      title: e.kind === "concept" ? (str(field(this.record(e.hash), "title")) ?? null) : null,
      seq: e.seq,
      ...(open.has(e.concept_id) ? { comments: open.get(e.concept_id) } : {}),
      ...(stale.has(e.concept_id) ? { stale: stale.get(e.concept_id) } : {}),
    }));
    return { seq: snap.seq, files };
  }

  /** Concepts the staleness process flagged, told apart by the time now (as in `work`). */
  private staleFlags(): Map<string, Staleness> {
    const now = this.clock().getTime();
    const rows = this.sql.all<{ concept_id: string; stale_ms: number }>(
      `SELECT f.concept_id, c.stale_ms FROM flags f JOIN concepts c ON c.concept_id = f.concept_id
       WHERE f.kind IN ('stale', 'stale_soon') AND c.stale_ms IS NOT NULL`,
    );
    return new Map(rows.map((r) => [r.concept_id, r.stale_ms <= now ? "stale" : "stale_soon"]));
  }

  tree(opts: { prefix?: string; depth?: number; at?: number } = {}) {
    const snap = this.snapshot(opts.at);
    const prefix = normalizeDir(opts.prefix);
    const entries: (ConceptRow | { path: string; kind: "dir"; files: number })[] = [];
    const dirs = new Map<string, number>();
    for (const e of snap.sorted()) {
      if (!underPrefix(e.path, prefix) || e.path === prefix) continue;
      const rest = prefix === "" ? e.path : e.path.slice(prefix.length + 1);
      const parts = rest.split("/");
      if (opts.depth !== undefined && parts.length > opts.depth) {
        const d = [prefix, ...parts.slice(0, opts.depth)].filter(Boolean).join("/");
        dirs.set(d, (dirs.get(d) ?? 0) + 1);
        continue;
      }
      entries.push(this.row(snap, e));
    }
    for (const [path, files] of dirs) entries.push({ path, kind: "dir", files });
    entries.sort((a, b) => (a.path < b.path ? -1 : 1));
    return { seq: snap.seq, entries };
  }

  /** GET /concepts: a frontmatter query; any combination of filters; paginated by offset. */
  concepts(
    q: {
      type?: string;
      tag?: string;
      status?: string;
      trust?: string;
      stale?: boolean;
      prefix?: string;
      at?: number;
      limit?: number;
      offset?: number;
    } = {},
  ) {
    const snap = this.snapshot(q.at);
    const prefix = normalizeDir(q.prefix);
    const limit = Math.min(Math.max(q.limit ?? 100, 1), 1000);
    const offset = Math.max(q.offset ?? 0, 0);
    const rows = snap
      .sorted()
      .filter((e) => e.kind === "concept" && underPrefix(e.path, prefix))
      .map((e) => this.row(snap, e))
      .filter(
        (r) =>
          (q.type === undefined || (r.type ?? "").toLowerCase() === q.type.trim().toLowerCase()) &&
          (q.tag === undefined || (r.tags ?? []).includes(q.tag)) &&
          (q.status === undefined || r.status === q.status) &&
          (q.trust === undefined || r.trust_tier === q.trust) &&
          (q.stale === undefined || r.stale === q.stale),
      );
    const items = rows.slice(offset, offset + limit);
    return {
      seq: snap.seq,
      total: rows.length,
      items,
      next_offset: offset + limit < rows.length ? offset + limit : null,
      ...(rows.length === 0 && q.type !== undefined ? this.typesLike(snap, q.type) : {}),
    };
  }

  /** The library's types closest to `want`, for a query that matched nothing. */
  private typesLike(snap: Snapshot, want: string): { types: string[]; types_near: boolean } {
    const types = new Set<string>();
    for (const e of snap.sorted()) {
      if (e.kind !== "concept") continue;
      const t = str(field(this.record(e.hash), "type"));
      if (t) types.add(t);
    }
    const w = want.trim().toLowerCase();
    const all = [...types].sort();
    const near = all.filter((t) => {
      const l = t.toLowerCase();
      return l.includes(w) || w.includes(l);
    });
    return near.length > 0
      ? { types: near.slice(0, 20), types_near: true }
      : { types: all.slice(0, 20), types_near: false };
  }

  /** GET /search: FTS over title, body and tags at head, ranked, with snippets. */
  search(q: string, opts: { prefix?: string; limit?: number } = {}) {
    const terms = q
      .split(/\s+/)
      .filter(Boolean)
      .map((t) => {
        const star = t.endsWith("*");
        const word = (star ? t.slice(0, -1) : t).replace(/"/g, '""');
        return word ? `"${word}"${star ? "*" : ""}` : "";
      })
      .filter(Boolean);
    if (terms.length === 0) throw new OkfError(400, "empty_query", "Send a search query in `q`.");
    const prefix = normalizeDir(opts.prefix);
    const limit = Math.min(Math.max(opts.limit ?? 20, 1), 200);
    const rows = this.sql.all<{ path: string; title: string; snippet: string; score: number }>(
      `SELECT paths.path AS path, fts.title AS title,
              snippet(fts, 2, char(2), char(3), '…', 16) AS snippet, bm25(fts) AS score
       FROM fts JOIN paths ON paths.concept_id = fts.concept_id
       WHERE fts MATCH ? AND (? = '' OR paths.path = ? OR paths.path LIKE ? ESCAPE '\\')
       ORDER BY score LIMIT ?`,
      terms.join(" "),
      prefix,
      prefix,
      `${escapeLike(prefix)}/%`,
      limit,
    );
    // FTS5 marks each matched token alone; adjacent ones become one highlight.
    const results = rows.map((r) => ({
      ...r,
      // The text's own backslashes and asterisks are escaped, so only highlights read as **.
      snippet: r.snippet
        .replace(/[\\*]/g, "\\$&")
        .replace(ADJACENT_MARKS, "$1")
        .replaceAll(MARK_OPEN, "**")
        .replaceAll(MARK_CLOSE, "**"),
    }));
    return { seq: this.headSeq(), results };
  }

  /** GET /grep: literal or regex match over rendered concepts, frontmatter included, like grep -n. */
  grep(
    pattern: string,
    opts: { regex?: boolean; prefix?: string; limit?: number; at?: number } = {},
  ) {
    if (!pattern) throw new OkfError(400, "empty_pattern", "Send a pattern.");
    let test: (line: string) => boolean;
    if (opts.regex) {
      let re: RegExp;
      try {
        re = new RegExp(pattern);
      } catch (e) {
        throw new OkfError(400, "bad_regex", `Invalid regular expression: ${(e as Error).message}`);
      }
      test = (line) => re.test(line);
    } else test = (line) => line.includes(pattern);
    const snap = this.snapshot(opts.at);
    const prefix = normalizeDir(opts.prefix);
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 1000);
    const matches: { path: string; line: number; text: string }[] = [];
    let truncated = false;
    outer: for (const e of snap.sorted()) {
      if (e.kind !== "concept" || !underPrefix(e.path, prefix)) continue;
      const lines = this.renderEntry(snap, e, false).split("\n");
      for (let i = 0; i < lines.length; i++) {
        const text = lines[i] ?? "";
        if (!test(text)) continue;
        if (matches.length >= limit) {
          truncated = true;
          break outer;
        }
        matches.push({ path: e.path, line: i + 1, text });
      }
    }
    return { seq: snap.seq, matches, truncated };
  }

  /**
   * GET /links: outbound links with current targets, inbound links, and broken ones. With `at`,
   * outbound and broken are as of that sequence; inbound links are only known at head.
   */
  links(input: string, opts: { at?: number } = {}) {
    const snap = this.snapshot(opts.at);
    const e = snap.lookup(normalizePath(input) ?? "");
    if (e?.kind !== "concept") throw notFound(input);
    const r = this.record(e.hash);
    // `raw` is each link as `read` renders it: its target's current path, in its written form.
    const outbound: { raw: string; path: string; anchor: string | null; kind: LinkKind }[] = [];
    const broken: { raw: string; path: string; kind: LinkKind }[] = [];
    for (const [l, kind] of linkGraph(r)) {
      const target = this.targetAt(snap, l);
      const raw = this.href(snap, e, l);
      if (target) outbound.push({ raw, path: target.path, anchor: l.anchor, kind });
      else broken.push({ raw, path: l.path, kind });
    }
    const inbound =
      snap.seq !== this.headSeq()
        ? []
        : this.sql
            .all<{
              from_id: string;
              to_path: string;
              raw: string;
              anchor: string | null;
              form: StoredLink["form"] | StoredSource["form"];
              kind: LinkKind;
            }>(
              "SELECT from_id, to_path, raw, anchor, form, kind FROM links WHERE to_id = ? AND from_id <> ?",
              e.concept_id,
              e.concept_id,
            )
            .flatMap((l) => {
              const from = snap.byId.get(l.from_id);
              if (!from) return [];
              const link = {
                raw: l.raw,
                path: l.to_path,
                anchor: l.anchor,
                form: l.form,
                target: e.concept_id,
              } as StoredSource;
              const raw = this.href(snap, from, link);
              return [{ path: from.path, raw, anchor: l.anchor, kind: l.kind }];
            })
            .sort((a, b) => (a.path < b.path ? -1 : 1));
    return { path: e.path, outbound, inbound, broken };
  }

  /** GET /events: the change feed, ascending by seq. */
  events(opts: { since?: number; prefix?: string; actor?: string; limit?: number } = {}) {
    const prefix = normalizeDir(opts.prefix);
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 1000);
    const rows = this.sql.all<EventRow & { meta: string | null }>(
      `SELECT * FROM events WHERE seq > ?
         AND (? = '' OR path = ? OR path LIKE ? ESCAPE '\\')
         AND (? IS NULL OR actor = ?)
       ORDER BY seq LIMIT ?`,
      opts.since ?? 0,
      prefix,
      prefix,
      `${escapeLike(prefix)}/%`,
      opts.actor ?? null,
      opts.actor ?? null,
      limit,
    );
    const events = rows.map((e) => ({
      ...e,
      meta: e.meta ? (JSON.parse(e.meta) as JsonObject) : null,
    }));
    const last = events.at(-1)?.seq;
    return { head: this.headSeq(), events, next: events.length === limit && last ? last : null };
  }

  /**
   * GET /requests: requests newest first, each with its events. `before` is a seq cursor for
   * paging back; `since` keeps only requests that started after that seq.
   */
  /**
   * GET /requests: requests newest first. Filters: path prefix, exact actor, and UTC dates
   * `from` and `to` (YYYY-MM-DD, inclusive); a request matches when one of its events does.
   */
  requests(
    opts: {
      before?: number;
      since?: number;
      prefix?: string;
      actor?: string;
      from?: string;
      to?: string;
      limit?: number;
    } = {},
  ) {
    const prefix = normalizeDir(opts.prefix);
    const limit = Math.min(Math.max(opts.limit ?? 20, 1), 200);
    for (const [name, v] of [
      ["from", opts.from],
      ["to", opts.to],
    ] as const) {
      if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
        throw new OkfError(400, "bad_param", `\`${name}\` must be a date like 2026-09-30.`);
      }
    }
    const ids = this.sql.all<{ request_id: string; last: number }>(
      `SELECT request_id, MIN(seq) AS first, MAX(seq) AS last FROM events
       WHERE (? = '' OR path = ? OR path LIKE ? ESCAPE '\\')
         AND (? = '' OR actor = ?)
         AND (? = '' OR substr(ts, 1, 10) >= ?) AND (? = '' OR substr(ts, 1, 10) <= ?)
       GROUP BY request_id HAVING last < ? AND first > ? ORDER BY last DESC LIMIT ?`,
      prefix,
      prefix,
      `${escapeLike(prefix)}/%`,
      opts.actor ?? "",
      opts.actor ?? "",
      opts.from ?? "",
      opts.from ?? "",
      opts.to ?? "",
      opts.to ?? "",
      opts.before ?? Number.MAX_SAFE_INTEGER,
      opts.since ?? 0,
      limit,
    );
    const requests = ids.map((r) => this.request(r.request_id));
    const last = ids.at(-1)?.last;
    return { requests, next: ids.length === limit && last ? last : null };
  }

  request(id: string): RequestRow {
    const rows = this.sql.all<EventRow & { meta: string | null }>(
      "SELECT * FROM events WHERE request_id = ? ORDER BY seq",
      id,
    );
    if (rows.length === 0) throw new OkfError(404, "not_found", `No request ${id}.`);
    return this.toRequest(
      id,
      rows.map((e) => ({ ...e, meta: e.meta ? (JSON.parse(e.meta) as JsonObject) : null })),
    );
  }

  /** GET /history: every event for the path's concept, across moves. */
  history(input: string) {
    const p = normalizePath(input) ?? "";
    let id = this.lookupRow(p)?.concept_id;
    if (!id) {
      id = this.sql.all<{ concept_id: string }>(
        "SELECT concept_id FROM events WHERE path IN (?, ?) ORDER BY seq DESC LIMIT 1",
        p,
        `${p}.md`,
      )[0]?.concept_id;
    }
    if (!id) throw notFound(input);
    const rows = this.sql.all<EventRow & { meta: string | null }>(
      "SELECT * FROM events WHERE concept_id = ? ORDER BY seq",
      id,
    );
    return {
      path: this.pathOf(id) ?? p,
      events: rows.map((e) => ({ ...e, meta: e.meta ? (JSON.parse(e.meta) as JsonObject) : null })),
    };
  }

  private pathOf(id: string): string | undefined {
    return this.sql.all<{ path: string }>("SELECT path FROM paths WHERE concept_id = ?", id)[0]
      ?.path;
  }

  /** The library as a conformant bundle at `at`, with index.md and log.md synthesized. */
  exportBundle(at?: number): { seq: number; files: ExportFile[] } {
    const snap = this.snapshot(at);
    const files: ExportFile[] = [];
    const dirs = new Set<string>([""]);
    for (const e of snap.sorted()) {
      for (let d = dirname(e.path); d !== ""; d = dirname(d)) dirs.add(d);
      if (e.kind === "concept")
        files.push({ path: e.path, text: this.renderEntry(snap, e, false) });
      else {
        const info = this.blobInfo(e.hash);
        files.push({ path: e.path, blob: { hash: e.hash, size: info.size, media: info.media } });
      }
    }
    for (const d of [...dirs].sort()) {
      files.push({ path: d ? `${d}/index.md` : "index.md", text: this.index(d, snap) });
    }
    files.push({ path: "log.md", text: this.log({ at: snap.seq, limit: null }) });
    return { seq: snap.seq, files };
  }

  // ---------------------------------------------------------------- tier 2: beyond files

  /** GET /sources: a concept's sources with footnote counts and internal targets' signals. */
  sources(input: string, opts: { at?: number } = {}) {
    const snap = this.snapshot(opts.at);
    const e = snap.lookup(normalizePath(input) ?? "");
    if (e?.kind !== "concept") throw notFound(input);
    const r = this.record(e.hash);
    const counts = scanDoc(r.doc, e.path).footnoteCounts;
    const list = field(r, "sources");
    const ids = new Set<string>();
    const sources: JsonObject[] = [];
    for (const [i, s] of (Array.isArray(list) ? list : []).entries()) {
      if (!s || typeof s !== "object" || Array.isArray(s)) continue;
      const id = str(s.id);
      if (id) ids.add(id);
      const stored = r.sources?.find((x) => x.index === i);
      const target = stored ? this.targetAt(snap, stored) : undefined;
      let internal: JsonObject | null = null;
      if (target?.kind === "concept") {
        const tr = this.record(target.hash);
        internal = {
          path: target.path,
          trust_tier: trustTier(tr.generated, this.verifiedAt(target.concept_id, snap.seq)),
          stale: isStale(field(tr, "stale_after"), this.clock().getTime()),
          status: effectiveStatus(field(tr, "status")),
          inbound_links: this.inboundCount(target.concept_id),
          usage_count: this.usageCount(target.concept_id),
        };
      } else if (target) internal = { path: target.path };
      else if (stored) internal = { path: stored.path, broken: true };
      // The resource as rendered: an internal one shows its target's current path.
      const entry: JsonObject = { ...s };
      if (stored) entry.resource = this.href(snap, e, stored);
      sources.push({ ...entry, cited: id ? (counts.get(id) ?? 0) : 0, internal });
    }
    return {
      path: e.path,
      sources,
      unmatched_footnotes: [...counts.keys()].filter((label) => !ids.has(label)),
    };
  }

  /**
   * GET /diff: unified diff of a concept's rendering between two sequences. `to` defaults to head;
   * `from` defaults to just before the concept's latest content change at or before `to`.
   */
  diff(input: string, opts: { from?: number; to?: number } = {}) {
    const p = normalizePath(input) ?? "";
    const to = opts.to ?? this.headSeq();
    const snapTo = this.snapshot(to);
    const id = snapTo.lookup(p)?.concept_id ?? this.lastConceptAt(p);
    if (!id) throw notFound(input);
    let from = opts.from;
    if (from === undefined) {
      const last = this.sql.all<{ seq: number }>(
        "SELECT seq FROM events WHERE concept_id = ? AND seq <= ? AND op NOT IN ('move', 'verify', 'comment') ORDER BY seq DESC LIMIT 1",
        id,
        to,
      )[0];
      from = last ? last.seq - 1 : 0;
    }
    const snapFrom = this.snapshot(from);
    const a = snapFrom.byId.get(id);
    const b = snapTo.byId.get(id);
    // Without the `generated` stamp, which changes with every write and says nothing new.
    const text = (snap: Snapshot, e: Entry | undefined) => {
      if (!e) return "";
      if (e.kind === "concept") return this.renderEntry(snap, e, false, true);
      return `(attachment ${e.hash})\n`;
    };
    // Each side is labelled by its own version's seq, not the library's.
    const label = (e: Entry | undefined, seq: number) =>
      e ? `${e.path}@${e.seq}` : `/dev/null@${seq}`;
    return {
      path: (b ?? a)?.path ?? p,
      from,
      to,
      diff: unifiedDiff(text(snapFrom, a), text(snapTo, b), {
        from: label(a, from),
        to: label(b, to),
      }),
    };
  }

  private lastConceptAt(path: string): string | undefined {
    return this.sql.all<{ concept_id: string }>(
      "SELECT concept_id FROM events WHERE path IN (?, ?) ORDER BY seq DESC LIMIT 1",
      path,
      `${path}.md`,
    )[0]?.concept_id;
  }

  /**
   * GET /work: the work queue (spec: Write path and maintainers). Staleness, broken links and
   * lint come from flags; stale soon only when asked for (`kind`) or for one concept (`path`).
   * Ranked by inbound links, then age.
   */
  work(opts: { kind?: string; limit?: number; path?: string } = {}) {
    const snap = this.snapshot();
    const now = this.clock().getTime();
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
    const items: WorkItem[] = [];
    const want = (k: string) => opts.kind === undefined || opts.kind === k;
    // One file's items (the app's concept page), whatever the queue's length.
    const only = opts.path === undefined ? undefined : (normalizePath(opts.path) ?? "");
    const mine = (path: string) => only === undefined || path === only;
    // Stale soon is a look-ahead: listed when asked for, or on one concept's page, not in the
    // queue of what needs doing now.
    const soon = opts.kind === "stale_soon" || (opts.kind === undefined && only !== undefined);
    if (want("stale") || soon) {
      // From the staleness process's flags (TEMPRA-63), told apart by the time now, so a concept
      // flagged stale soon is stale the moment its date passes, between two runs.
      const rows = this.sql.all<{ concept_id: string; stale_after: string; stale_ms: number }>(
        `SELECT f.concept_id, c.stale_after, c.stale_ms FROM flags f
         JOIN concepts c ON c.concept_id = f.concept_id
         WHERE f.kind IN ('stale', 'stale_soon') AND c.stale_ms IS NOT NULL`,
      );
      for (const row of rows) {
        const e = snap.byId.get(row.concept_id);
        if (e?.kind !== "concept" || !mine(e.path)) continue;
        const staleAfter = row.stale_after;
        if (row.stale_ms <= now) {
          if (!want("stale")) continue;
          items.push({
            kind: "stale",
            path: e.path,
            since: staleAfter,
            detail: `stale_after ${staleAfter} has passed`,
            suggested_action:
              "Re-check the concept against its sources and resource. Update it (which restamps generated) and move stale_after forward, or set status: deprecated if it no longer holds.",
            inbound_links: this.inboundCount(e.concept_id),
          });
        } else if (soon) {
          items.push({
            kind: "stale_soon",
            path: e.path,
            since: staleAfter,
            detail: `stale_after ${staleAfter} is within ${STALE_SOON_DAYS} days`,
            suggested_action:
              "Re-check the concept against its sources before then. If it still holds, move stale_after forward; only a new stale_after resets the clock.",
            inbound_links: this.inboundCount(e.concept_id),
          });
        }
      }
    }
    // Missing-heading lint is not stored: work it out for every concept with an anchored link.
    const anchorLint = new Map<string, LintWarning[]>();
    if (want("lint")) {
      for (const [id, lint] of this.anchorLints(snap)) {
        const e = snap.byId.get(id);
        if (e && mine(e.path)) anchorLint.set(id, lint);
      }
    }
    const flags = this.sql.all<{
      concept_id: string;
      kind: string;
      since_seq: number;
      detail: string;
    }>(
      `SELECT f.concept_id, f.kind, f.since_seq, f.detail FROM flags f
       JOIN paths p ON p.concept_id = f.concept_id
       WHERE f.kind NOT IN ('stale', 'stale_soon', 'structure')`,
    );
    // A concept with only missing-heading lint gets a lint item too, dated by its latest version.
    for (const id of anchorLint.keys()) {
      if (flags.some((f) => f.concept_id === id && f.kind === "lint")) continue;
      const e = snap.byId.get(id);
      if (e) flags.push({ concept_id: id, kind: "lint", since_seq: e.seq, detail: "[]" });
    }
    for (const f of flags) {
      if (!want(f.kind)) continue;
      const e = snap.byId.get(f.concept_id);
      if (!e || !mine(e.path)) continue;
      const since =
        this.sql.all<{ ts: string }>("SELECT ts FROM events WHERE seq = ?", f.since_seq)[0]?.ts ??
        "";
      let detail = f.detail;
      let action = "Fix the frontmatter or body with edit; the lint messages say what is wrong.";
      if (f.kind === "broken_link") {
        const targets = JSON.parse(f.detail) as string[];
        detail = `links to missing ${targets.map((t) => `/${t}`).join(", ")}`;
        action =
          "Write the missing concept, point the link at an existing one, or remove the link.";
      } else if (f.kind === "lint") {
        detail = [
          ...this.freshLint(snap, e, JSON.parse(f.detail) as LintWarning[]),
          ...(anchorLint.get(f.concept_id) ?? []),
        ]
          .map((l) => l.message)
          .join(" ");
      }
      items.push({
        kind: f.kind,
        path: e.path,
        since,
        detail,
        suggested_action: action,
        inbound_links: this.inboundCount(e.concept_id),
      });
    }
    if (want("structure")) {
      // The structure process's flags (TEMPRA-64): a concept's own, or a directory's, reported on
      // its index.md. Directory flags are kept current by writes, so a directory gone has none.
      for (const f of this.sql.all<{ concept_id: string; since_seq: number; detail: string }>(
        "SELECT concept_id, since_seq, detail FROM flags WHERE kind = 'structure'",
      )) {
        const dir = isDirKey(f.concept_id) ? f.concept_id.slice(4) : null;
        const e = dir === null ? snap.byId.get(f.concept_id) : undefined;
        if (dir === null && e?.kind !== "concept") continue;
        const path = e ? e.path : dirIndex(dir ?? "");
        if (!mine(path)) continue;
        const issues = JSON.parse(f.detail) as StructureIssue[];
        items.push({
          kind: "structure",
          path,
          since:
            this.sql.all<{ ts: string }>("SELECT ts FROM events WHERE seq = ?", f.since_seq)[0]
              ?.ts ?? "",
          detail: issues.map((i) => i.message).join(" "),
          suggested_action: structureAction(issues),
          inbound_links: e ? this.inboundCount(e.concept_id) : 0,
        });
      }
    }
    if (want("comment")) {
      // One concept's page asks for its own threads only (the partial index, by concept).
      const onlyId =
        only === undefined ? null : (snap.lookup(only)?.concept_id ?? "(no such concept)");
      // Open threads on concepts that exist, from the partial index on open threads.
      const threads = this.sql.all<{
        id: string;
        concept_id: string;
        actor: string;
        anchor: string | null;
        replies: number;
        last_actor: string;
        ts: string;
        body: string;
      }>(
        `SELECT t.id, t.concept_id, t.actor, t.anchor, t.replies, t.last_actor, e.ts,
                (SELECT body FROM comments c WHERE c.thread_id = t.id ORDER BY c.seq LIMIT 1) AS body
         FROM threads t JOIN paths p ON p.concept_id = t.concept_id
         JOIN events e ON e.seq = t.last_seq
         WHERE t.status = 'open' AND (? IS NULL OR t.concept_id = ?)`,
        onlyId,
        onlyId,
      );
      for (const t of threads) {
        const e = snap.byId.get(t.concept_id);
        if (!e || !mine(e.path)) continue;
        const quote = t.anchor ? (JSON.parse(t.anchor) as StoredAnchor).quote : null;
        const said = clip(t.body ?? "", 160);
        const on = quote ? ` on “${clip(quote, 80)}”` : "";
        const replies =
          t.replies > 0
            ? ` (${t.replies} ${t.replies === 1 ? "reply" : "replies"}, last by ${t.last_actor})`
            : "";
        items.push({
          kind: "comment",
          path: e.path,
          since: t.ts,
          detail: `${t.actor} commented${on}: ${said}${replies}`,
          suggested_action:
            "Read the thread with `comments`, make the change it asks for, then reply with `comment` and resolve it. If you only have a question, reply without resolving; if the last reply is yours, wait for an answer.",
          inbound_links: this.inboundCount(e.concept_id),
          thread: t.id,
        });
      }
    }
    items.sort((a, b) => b.inbound_links - a.inbound_links || (a.since < b.since ? -1 : 1));
    const counts: Record<string, number> = {};
    for (const i of items) counts[i.kind] = (counts[i.kind] ?? 0) + 1;
    return { seq: snap.seq, total: items.length, counts, items: items.slice(0, limit) };
  }

  /**
   * Every concept at head with a link to a heading its target does not have, and that lint;
   * worked out from the snapshot like `anchorLint`, kept for the seq it was worked out at.
   */
  private anchorLints(snap = this.snapshot()): Map<string, LintWarning[]> {
    if (this.anchorCache?.seq === snap.seq) return this.anchorCache.lint;
    if (this.catchUpAnchors(snap) && this.anchorCache) return this.anchorCache.lint;
    const lint = new Map<string, LintWarning[]>();
    const headings = new Map<string, Set<string>>();
    for (const { from_id } of this.sql.all<{ from_id: string }>(
      "SELECT DISTINCT from_id FROM links WHERE kind = 'body' AND anchor IS NOT NULL AND anchor <> '#'",
    )) {
      const e = snap.byId.get(from_id);
      if (e?.kind !== "concept") continue;
      const found = this.anchorLint(snap, e, headings);
      if (found.length > 0) lint.set(from_id, found);
    }
    this.anchorCache = { seq: snap.seq, lint };
    this.anchorTouched = [];
    return lint;
  }

  /**
   * What `work()` counts, by kind, its total and the stale-soon total, from aggregate queries over
   * the flags and threads rather than item by item (TEMPRA-86): for `summary` and `health`.
   */
  private workCounts(): { counts: Record<string, number>; total: number; stale_soon: number } {
    const now = this.clock().getTime();
    const counts: Record<string, number> = {};
    const add = (kind: string, n: number) => {
      if (n > 0) counts[kind] = (counts[kind] ?? 0) + n;
    };
    const stale = this.sql.all<{ stale: number | null; soon: number | null }>(
      `SELECT SUM(c.stale_ms <= ?) AS stale, SUM(c.stale_ms > ?) AS soon FROM flags f
       JOIN concepts c ON c.concept_id = f.concept_id
       JOIN paths p ON p.concept_id = f.concept_id AND p.kind = 'concept'
       WHERE f.kind IN ('stale', 'stale_soon') AND c.stale_ms IS NOT NULL`,
      now,
      now,
    )[0];
    add("stale", stale?.stale ?? 0);
    for (const r of this.sql.all<{ kind: string; n: number }>(
      `SELECT f.kind, COUNT(*) AS n FROM flags f JOIN paths p ON p.concept_id = f.concept_id
       WHERE f.kind NOT IN ('stale', 'stale_soon', 'structure') GROUP BY f.kind`,
    )) {
      add(r.kind, r.n);
    }
    // A concept with only missing-heading lint has a lint item too.
    const linted = new Set(
      this.sql
        .all<{ concept_id: string }>("SELECT concept_id FROM flags WHERE kind = 'lint'")
        .map((r) => r.concept_id),
    );
    add("lint", [...this.anchorLints().keys()].filter((id) => !linted.has(id)).length);
    add(
      "structure",
      this.sql.all<{ n: number }>(
        `SELECT COUNT(*) AS n FROM flags f LEFT JOIN paths p ON p.concept_id = f.concept_id
         WHERE f.kind = 'structure' AND (f.concept_id LIKE 'dir:%' OR p.kind = 'concept')`,
      )[0]?.n ?? 0,
    );
    add(
      "comment",
      this.sql.all<{ n: number }>(
        `SELECT COUNT(*) AS n FROM threads t JOIN paths p ON p.concept_id = t.concept_id
         JOIN events e ON e.seq = t.last_seq WHERE t.status = 'open'`,
      )[0]?.n ?? 0,
    );
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    return { counts, total, stale_soon: stale?.soon ?? 0 };
  }

  /**
   * POST /verify: adds `{ by, at }` to `verified` as one verify event; the content version is
   * unchanged (spec: OKF conformance). Only `human:` and `process:` actors may verify.
   */
  verify(ctx: RequestContext, input: string): WriteResult {
    if (!ctx.actor.startsWith("human:") && !ctx.actor.startsWith("process:")) {
      throw new OkfError(
        403,
        "cannot_verify",
        "Only human: and process: actors may verify; agents do not claim verification.",
      );
    }
    return this.guard(() =>
      this.sql.transaction(() => {
        const w = this.begin(ctx);
        const p = normalizePath(input);
        const row = p ? this.lookupRow(p) : undefined;
        if (row?.kind !== "concept") throw notFound(input);
        const seq = this.recordVerification(w, row.concept_id, row.path, row.hash, {
          by: ctx.actor,
          at: w.now,
        });
        return {
          request_id: ctx.request_id,
          seq,
          results: [{ op: "verify", path: row.path, hash: row.hash, seq, lint: [] }],
        };
      }),
    );
  }

  // ---------------------------------------------------------------- comments

  /**
   * One comment action as one request (tempra-dev: app/comments): open a thread on a concept
   * (optionally on a quote), reply, resolve or reopen. Recorded as a `comment` event whose meta
   * carries the action in full, so the ledger stays the source of truth; the `threads` and
   * `comments` tables follow in the same transaction. The concept's version does not change.
   */
  comment(ctx: RequestContext, action: CommentAction): CommentResult {
    return this.guard(() =>
      this.sql.transaction(() => {
        const w = this.begin(ctx);
        const id = action.kind === "open" ? this.openThread(w, action) : this.actOn(w, action);
        const view = this.threadViews(this.threadRows("t.id = ?", [id]), true)[0];
        if (!view) throw new Error("thread vanished");
        return {
          request_id: ctx.request_id,
          seq: this.headSeq(),
          thread: view,
          people: this.peopleOf(id),
        };
      }),
    );
  }

  private openThread(w: WriteState, a: Extract<CommentAction, { kind: "open" }>): string {
    const p = normalizePath(a.path);
    const row = p ? this.lookupRow(p) : undefined;
    if (row?.kind !== "concept") throw notFound(a.path);
    const body = commentBody(a.body, true) as string;
    let anchor: StoredAnchor | null = null;
    if (a.anchor) {
      const raw = a.anchor.from;
      // The app sends the document's text and where it saw it; an agent, markdown as read.
      const quote = checkQuote(
        typeof raw === "number" ? a.anchor.quote : quoteText(String(a.anchor.quote ?? "")),
      );
      const doc = this.textOf(row);
      const text = doc.text;
      const starts = occurrences(text, quote);
      const hint =
        typeof raw === "number" && Number.isInteger(raw) && raw >= 0 && raw <= text.length
          ? raw
          : undefined;
      let at: number | undefined;
      if (hint !== undefined && text.startsWith(quote, hint)) at = hint;
      else if (starts.length === 1 || (starts.length > 1 && hint !== undefined)) {
        at = starts.reduce((best, s) =>
          Math.abs(s - (hint ?? 0)) < Math.abs(best - (hint ?? 0)) ? s : best,
        );
      } else if (starts.length > 1) {
        throw new OkfError(
          409,
          "quote_ambiguous",
          `The quote occurs ${starts.length} times in ${row.path}; quote more of the sentence so it occurs once.`,
        );
      }
      if (at === undefined) {
        throw new OkfError(
          409,
          "quote_not_found",
          `The quote is not in the current body of ${row.path}; read it again and quote it exactly, or comment on the whole concept.`,
        );
      }
      anchor = { ...selectorAt(doc, at, at + quote.length), seq: this.headSeq() };
    }
    const id = crypto.randomUUID();
    const commentId = crypto.randomUUID();
    const seq = this.appendEvent(w.ctx, w.now, {
      op: "comment",
      path: row.path,
      prev_hash: row.hash,
      hash: row.hash,
      concept_id: row.concept_id,
      meta: {
        comment: {
          kind: "open",
          thread: id,
          id: commentId,
          body,
          anchor: anchor as unknown as JsonObject | null,
          ...mentionsMeta(a.mentions),
        },
      },
    });
    this.sql.run(
      `INSERT INTO threads (id, concept_id, actor, anchor, status, created_seq, last_seq, last_actor)
       VALUES (?, ?, ?, ?, 'open', ?, ?, ?)`,
      id,
      row.concept_id,
      w.ctx.actor,
      anchor ? JSON.stringify(anchor) : null,
      seq,
      seq,
      w.ctx.actor,
    );
    this.addComment(commentId, id, w, body, seq);
    return id;
  }

  private actOn(w: WriteState, a: Exclude<CommentAction, { kind: "open" }>): string {
    const t = this.sql.all<{ id: string; concept_id: string; status: ThreadStatus }>(
      "SELECT id, concept_id, status FROM threads WHERE id = ?",
      a.thread,
    )[0];
    const row = t
      ? this.sql.all<PathRow>(
          "SELECT path, concept_id, hash, kind, last_seq AS seq, created_seq FROM paths WHERE concept_id = ?",
          t.concept_id,
        )[0]
      : undefined;
    // A thread on a deleted concept is kept (a revert brings both back) but takes no actions.
    if (!t || !row) throw new OkfError(404, "not_found", `No comment thread ${a.thread}.`);
    const body = commentBody(a.body, a.kind === "reply");
    if (a.kind === "resolve" && t.status === "resolved") {
      throw new OkfError(409, "already_resolved", "The thread is already resolved.");
    }
    if (a.kind === "reopen" && t.status === "open") {
      throw new OkfError(409, "already_open", "The thread is already open.");
    }
    const commentId = body ? crypto.randomUUID() : null;
    const seq = this.appendEvent(w.ctx, w.now, {
      op: "comment",
      path: row.path,
      prev_hash: row.hash,
      hash: row.hash,
      concept_id: row.concept_id,
      meta: {
        comment: {
          kind: a.kind,
          thread: t.id,
          ...(commentId ? { id: commentId, body, ...mentionsMeta(a.mentions) } : {}),
        },
      },
    });
    if (commentId && body) this.addComment(commentId, t.id, w, body, seq);
    if (a.kind === "resolve") {
      this.sql.run(
        "UPDATE threads SET status = 'resolved', resolved_by = ?, resolved_seq = ? WHERE id = ?",
        w.ctx.actor,
        seq,
        t.id,
      );
    } else if (a.kind === "reopen") {
      this.sql.run(
        "UPDATE threads SET status = 'open', resolved_by = NULL, resolved_seq = NULL WHERE id = ?",
        t.id,
      );
    }
    this.sql.run(
      `UPDATE threads SET last_seq = ?, last_actor = ?, replies = replies + ? WHERE id = ?`,
      seq,
      w.ctx.actor,
      commentId ? 1 : 0,
      t.id,
    );
    return t.id;
  }

  private addComment(id: string, thread: string, w: WriteState, body: string, seq: number) {
    this.sql.run(
      "INSERT INTO comments (id, thread_id, actor, body, ts, seq) VALUES (?, ?, ?, ?, ?, ?)",
      id,
      thread,
      w.ctx.actor,
      body,
      w.now,
      seq,
    );
  }

  /**
   * The people a thread's action may concern, by users id from each event's `by`: who opened or
   * wrote in the thread, and who wrote or verified its concept (TEMPRA-72).
   */
  private peopleOf(thread: string): CommentResult["people"] {
    const persons = (where: string, ...params: SqlValue[]) =>
      this.sql
        .all<{ person: string | null }>(
          `SELECT DISTINCT json_extract(meta, '$.by.person') AS person FROM events
           WHERE ${where} AND meta IS NOT NULL LIMIT 100`,
          ...params,
        )
        .flatMap((r) => (r.person ? [r.person] : []));
    const t = this.sql.all<{ concept_id: string }>(
      "SELECT concept_id FROM threads WHERE id = ?",
      thread,
    )[0];
    return {
      participants: persons(
        "op = 'comment' AND json_extract(meta, '$.comment.thread') = ? AND json_extract(meta, '$.comment.body') IS NOT NULL",
        thread,
      ),
      writers: t ? persons("op NOT IN ('comment', 'move') AND concept_id = ?", t.concept_id) : [],
    };
  }

  /** A concept's text at head, which anchors quote. */
  private textOf(e: Entry) {
    return docText(this.record(e.hash).doc);
  }

  private threadRows(where: string, params: SqlValue[], tail = "") {
    return this.sql.all<ThreadRow>(
      `SELECT t.*, p.path, p.hash, p.kind, p.last_seq AS seq FROM threads t
       JOIN paths p ON p.concept_id = t.concept_id
       WHERE ${where} ${tail}`,
      ...params,
    );
  }

  /** Threads as returned: their comments, and anchors located in each concept's current body. */
  private threadViews(rows: ThreadRow[], withComments: boolean): ThreadView[] {
    const byThread = new Map<string, CommentView[]>();
    const actions = new Map<string, ThreadAction[]>();
    const mentioned = new Map<string, string[]>();
    // Who did each action, by seq: a comment and the action that added it share one.
    const bySeq = new Map<number, ActionBy>();
    if (rows.length > 0 && withComments) {
      // Every action from the ledger, where resolve and reopen are recorded too.
      const ids = [...new Set(rows.map((r) => r.concept_id))];
      const events = this.sql.all<{ seq: number; actor: string; ts: string; meta: string | null }>(
        `SELECT seq, actor, ts, meta FROM events
         WHERE op = 'comment' AND concept_id IN (${ids.map(() => "?").join(", ")}) ORDER BY seq`,
        ...ids,
      );
      for (const e of events) {
        const meta = e.meta ? (JSON.parse(e.meta) as JsonObject) : {};
        const c = meta.comment as
          | { kind?: string; thread?: string; id?: string; mentions?: Mention[] }
          | undefined;
        if (!c?.thread || !c.kind) continue;
        const by = meta.by as { person?: unknown; agent?: unknown } | undefined;
        if (by && typeof by.person === "string") {
          bySeq.set(
            e.seq,
            typeof by.agent === "string"
              ? { person: by.person, agent: by.agent }
              : { person: by.person },
          );
        }
        if (c.id && Array.isArray(c.mentions) && c.mentions.length > 0) {
          mentioned.set(
            c.id,
            c.mentions.map((m) => ("handle" in m ? `@${m.handle}` : `@${m.name}`)),
          );
        }
        const list = actions.get(c.thread) ?? [];
        list.push({
          kind: c.kind as ThreadAction["kind"],
          actor: e.actor,
          ...(bySeq.has(e.seq) ? { by: bySeq.get(e.seq) } : {}),
          ts: e.ts,
          seq: e.seq,
          comment: c.id ?? null,
        });
        actions.set(c.thread, list);
      }
      const comments = this.sql.all<CommentView & { thread_id: string }>(
        `SELECT id, thread_id, actor, body, ts, seq FROM comments
         WHERE thread_id IN (${rows.map(() => "?").join(", ")}) ORDER BY seq`,
        ...rows.map((r) => r.id),
      );
      for (const c of comments) {
        const list = byThread.get(c.thread_id) ?? [];
        const mentions = mentioned.get(c.id);
        list.push({
          id: c.id,
          actor: c.actor,
          ...(bySeq.has(c.seq) ? { by: bySeq.get(c.seq) } : {}),
          body: c.body,
          ts: c.ts,
          seq: c.seq,
          ...(mentions ? { mentions } : {}),
        });
        byThread.set(c.thread_id, list);
      }
    }
    // One text per concept, however many of its threads are on the page.
    const texts = new Map<string, ReturnType<typeof docText>>();
    return rows.map((r) => {
      const anchor = r.anchor ? (JSON.parse(r.anchor) as StoredAnchor) : null;
      let located: { from: number; to: number } | null = null;
      if (anchor) {
        let text = texts.get(r.concept_id);
        if (text === undefined) {
          text = this.textOf(r);
          texts.set(r.concept_id, text);
        }
        located = locate(text, anchor);
      }
      return {
        id: r.id,
        path: r.path,
        status: r.status,
        actor: r.actor,
        created_seq: r.created_seq,
        last_seq: r.last_seq,
        last_actor: r.last_actor,
        resolved_by: r.resolved_by,
        resolved_seq: r.resolved_seq,
        replies: r.replies,
        anchor,
        located,
        outdated: anchor !== null && located === null,
        comments: byThread.get(r.id) ?? [],
        actions: actions.get(r.id) ?? [],
      };
    });
  }

  /**
   * GET /comments: threads on concepts that exist, most recent activity first, each with its
   * comments. `path` narrows to one concept; `status` is open (default), resolved or all;
   * `before` is a last_seq cursor for the next page.
   */
  comments(opts: { path?: string; status?: string; limit?: number; before?: number } = {}) {
    const status = opts.status ?? "open";
    if (!["open", "resolved", "all"].includes(status)) {
      throw new OkfError(400, "bad_param", "`status` is open, resolved or all.");
    }
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const where: string[] = ["t.last_seq < ?"];
    const params: SqlValue[] = [opts.before ?? Number.MAX_SAFE_INTEGER];
    let path: string | null = null;
    if (opts.path !== undefined) {
      const p = normalizePath(opts.path);
      const row = p ? this.lookupRow(p) : undefined;
      if (!row) throw notFound(opts.path);
      path = row.path;
      where.push("t.concept_id = ?");
      params.push(row.concept_id);
    }
    if (status !== "all") {
      where.push("t.status = ?");
      params.push(status);
    }
    const rows = this.threadRows(
      where.join(" AND "),
      [...params, limit],
      "ORDER BY t.last_seq DESC LIMIT ?",
    );
    const last = rows.at(-1)?.last_seq;
    return {
      head: this.headSeq(),
      path,
      threads: this.threadViews(rows, true),
      next: rows.length === limit && last ? last : null,
    };
  }

  /** GET /comments/{thread}: one thread with its comments. */
  thread(id: string): ThreadView {
    const view = this.threadViews(this.threadRows("t.id = ?", [id]), true)[0];
    if (!view) throw new OkfError(404, "not_found", `No comment thread ${id}.`);
    return view;
  }

  /** Open threads per concept path, for the tree. */
  private openThreadCounts(): Map<string, number> {
    const rows = this.sql.all<{ concept_id: string; n: number }>(
      "SELECT concept_id, COUNT(*) AS n FROM threads WHERE status = 'open' GROUP BY concept_id",
    );
    return new Map(rows.map((r) => [r.concept_id, r.n]));
  }

  /** How many open threads a concept has (for `read`), from the partial index. */
  private openThreadsOf(conceptId: string): number {
    return (
      this.sql.all<{ n: number }>(
        "SELECT COUNT(*) AS n FROM threads WHERE concept_id = ? AND status = 'open'",
        conceptId,
      )[0]?.n ?? 0
    );
  }

  // ---------------------------------------------------------------- maintainers and stats

  /**
   * The ledger as JSON lines (spec: Backups and recovery): every blob row, then every event, in
   * sequence order. Concept records are inline; attachment bytes stay in R2 under blobs/<hash>.
   */
  dump(): string {
    const lines: string[] = [];
    const blobs = this.sql.all<{
      hash: string;
      size: number;
      location: string;
      content: string | ArrayBuffer | null;
      media: string | null;
    }>("SELECT hash, size, location, content, media FROM blobs ORDER BY rowid");
    for (const b of blobs) {
      const content =
        b.content === null || typeof b.content === "string"
          ? b.content
          : new TextDecoder().decode(b.content);
      lines.push(JSON.stringify({ t: "blob", ...b, content }));
    }
    const events = this.sql.all<EventRow & { meta: string | null }>(
      "SELECT * FROM events ORDER BY seq",
    );
    for (const e of events) {
      lines.push(JSON.stringify({ t: "event", ...e, meta: e.meta ? JSON.parse(e.meta) : null }));
    }
    return lines.length ? `${lines.join("\n")}\n` : "";
  }

  /**
   * The staleness process (TEMPRA-63): one range query over the indexed `stale_ms` finds every
   * concept that is stale or stale soon, and the flags are brought in line with it. A write keeps
   * its concept's flags current when `stale_after` moves, so a run only catches what time alone
   * changed. Returns what newly became stale soon or stale, for alerts and the digest.
   */
  maintainStaleness(): StalenessRun {
    const now = this.clock();
    const t = now.getTime();
    return this.sql.transaction(() => {
      const seq = this.headSeq();
      const due = this.sql.all<{
        concept_id: string;
        stale_after: string;
        stale_ms: number;
        path: string;
      }>(
        `SELECT c.concept_id, c.stale_after, c.stale_ms, p.path FROM concepts c
         JOIN paths p ON p.concept_id = c.concept_id WHERE c.stale_ms <= ?`,
        t + STALE_SOON_DAYS * 86_400_000,
      );
      const flagged = new Map(
        this.sql
          .all<{ concept_id: string; kind: string }>(
            "SELECT concept_id, kind FROM flags WHERE kind IN ('stale', 'stale_soon')",
          )
          .map((f) => [f.concept_id, f.kind]),
      );
      const run: StalenessRun = { stale: 0, stale_soon: 0, became: { stale: [], stale_soon: [] } };
      for (const r of due) {
        const state: Staleness = r.stale_ms <= t ? "stale" : "stale_soon";
        run[state]++;
        const was = flagged.get(r.concept_id);
        flagged.delete(r.concept_id);
        if (was === state) continue;
        this.setStaleFlag(r.concept_id, r.stale_after, seq);
        run.became[state].push(r.path);
      }
      // Left over: flags whose concept is no longer due (a clock set back, a restored row).
      for (const id of flagged.keys()) this.setStaleFlag(id, null, seq);
      for (const k of ["stale", "stale_soon"] as const) run.became[k].sort();
      this.sql.run(
        `INSERT INTO cursors (maintainer, seq) VALUES ('staleness', ?)
         ON CONFLICT(maintainer) DO UPDATE SET seq = excluded.seq`,
        seq,
      );
      this.setMaintenance({
        staleness_at: iso(now),
        staleness_counts: JSON.stringify({ stale: run.stale, stale_soon: run.stale_soon }),
      });
      return run;
    });
  }

  /**
   * The structure process (TEMPRA-64): directory and index health. Writes keep the flags of the
   * directories they touch current; this daily run checks the whole library again, which catches
   * what a write changed elsewhere (a concept left with no links in). It runs only when the ledger
   * moved since its cursor. Returns the counts now, and what was newly flagged.
   */
  maintainStructure(): StructureRun {
    const now = this.clock();
    return this.sql.transaction(() => {
      const seq = this.headSeq();
      const cursor =
        this.sql.all<{ seq: number }>("SELECT seq FROM cursors WHERE maintainer = 'structure'")[0]
          ?.seq ?? -1;
      const became = cursor === seq ? [] : this.syncStructure(null, seq).became;
      const flags = this.sql.all<{ concept_id: string; detail: string }>(
        "SELECT concept_id, detail FROM flags WHERE kind = 'structure'",
      );
      const run: StructureRun = {
        skipped: cursor === seq,
        concepts: 0,
        directories: 0,
        codes: {},
        became: [],
      };
      for (const f of flags) {
        if (isDirKey(f.concept_id)) run.directories++;
        else run.concepts++;
        for (const i of JSON.parse(f.detail) as StructureIssue[]) {
          run.codes[i.code] = (run.codes[i.code] ?? 0) + 1;
        }
      }
      const paths = new Map(
        this.sql
          .all<{ concept_id: string; path: string }>(
            "SELECT concept_id, path FROM paths WHERE concept_id IN (SELECT value FROM json_each(?))",
            JSON.stringify(became.filter((k) => !isDirKey(k))),
          )
          .map((r) => [r.concept_id, r.path]),
      );
      run.became = became
        .map((k) => (isDirKey(k) ? dirIndex(k.slice(4)) : (paths.get(k) ?? "")))
        .filter((p) => p !== "")
        .sort();
      this.sql.run(
        `INSERT INTO cursors (maintainer, seq) VALUES ('structure', ?)
         ON CONFLICT(maintainer) DO UPDATE SET seq = excluded.seq`,
        seq,
      );
      this.setMaintenance({
        structure_at: iso(now),
        structure_counts: JSON.stringify({
          concepts: run.concepts,
          directories: run.directories,
          codes: run.codes,
        }),
      });
      return run;
    });
  }

  /**
   * The library's health summary (TEMPRA-66), worked out now: open work by kind, the concepts
   * changed since anyone last verified them (the newest first), and when. No model involved.
   */
  private computeHealth(): LibraryHealth {
    const work = this.workCounts();
    const n = (k: string) => work.counts[k] ?? 0;
    const unverified = `FROM paths p JOIN events e ON e.seq = p.last_seq
       WHERE p.kind = 'concept' AND e.op <> 'verify'`;
    const rows = this.sql.all<{ path: string; seq: number; ts: string; actor: string }>(
      `SELECT p.path, p.last_seq AS seq, e.ts, e.actor ${unverified} ORDER BY p.last_seq DESC LIMIT ?`,
      HEALTH_NEWEST,
    );
    return {
      at: iso(this.clock()),
      seq: this.headSeq(),
      counts: {
        stale: n("stale"),
        stale_soon: work.stale_soon,
        broken_link: n("broken_link"),
        lint: n("lint"),
        structure: n("structure"),
        comment: n("comment"),
      },
      unverified: {
        total: this.sql.all<{ n: number }>(`SELECT COUNT(*) AS n ${unverified}`)[0]?.n ?? 0,
        newest: rows,
      },
    };
  }

  /** The health process: the summary, kept in meta for start, the app and the digests. */
  maintainHealth(): LibraryHealth {
    const health = this.computeHealth();
    this.setMaintenance({ health: JSON.stringify(health) });
    return health;
  }

  /** The summary the daily pass kept, or one worked out now before the first pass has run. */
  health(): LibraryHealth {
    const kept = this.maintenance().health;
    return kept ? (JSON.parse(kept) as LibraryHealth) : this.computeHealth();
  }

  /** The usage-rollup maintainer: drops read counts older than the usage window. */
  pruneUsage(): number {
    this.flushReads();
    const before = this.sql.all<{ n: number }>("SELECT COUNT(*) AS n FROM access_log")[0]?.n ?? 0;
    this.sql.run("DELETE FROM access_log WHERE day < ?", this.windowStart());
    const after = this.sql.all<{ n: number }>("SELECT COUNT(*) AS n FROM access_log")[0]?.n ?? 0;
    return before - after;
  }

  /**
   * What the next maintenance pass would find to do (TEMPRA-82), for scheduling the library's
   * alarm: whether the ledger moved since the last export, and when the next export, stale or
   * stale-soon concept and read count falls due. Indexed lookups only.
   */
  maintenanceDue(now: Date): MaintenanceDue {
    const t = now.getTime();
    const m = this.maintenance();
    const seq = this.headSeq();
    const min = (q: string, ...p: SqlValue[]) =>
      this.sql.all<{ t: number | null }>(q, ...p)[0]?.t ?? null;
    const soonMs = STALE_SOON_DAYS * 86_400_000;
    // The next concept to come within the stale-soon window, and the next to pass its date.
    const staleAt = [
      min("SELECT MIN(stale_ms) AS t FROM concepts WHERE stale_ms > ?", t + soonMs),
      min("SELECT MIN(stale_ms) AS t FROM concepts WHERE stale_ms > ?", t),
    ]
      .map((x, i) => (x === null ? null : i === 0 ? x - soonMs : x))
      .filter((x): x is number => x !== null);
    const oldestRead = [
      this.sql.all<{ day: string | null }>("SELECT MIN(day) AS day FROM access_log")[0]?.day,
      ...this.reads.keys(),
    ]
      .filter((d): d is string => !!d)
      .sort()[0];
    const expiry = m.export_expiry;
    return {
      exportPending: seq > 0 && seq !== Number(m.export_seq ?? -1),
      // Unknown until a pass has recorded it: due, so the next pass finds out.
      exportExpiry: expiry === undefined ? t : expiry === "none" ? null : Date.parse(expiry),
      staleAt: staleAt.length > 0 ? Math.min(...staleAt) : null,
      usageExpiry: oldestRead
        ? Date.parse(`${oldestRead}T00:00:00Z`) + USAGE_WINDOW_DAYS * 86_400_000
        : null,
    };
  }

  /** Maintainer bookkeeping (last run, cursors) kept in the meta table under `maint:`. */
  maintenance(): Record<string, string> {
    const rows = this.sql.all<{ key: string; value: string }>(
      "SELECT key, value FROM meta WHERE key LIKE 'maint:%'",
    );
    return Object.fromEntries(rows.map((r) => [r.key.slice(6), r.value]));
  }

  setMaintenance(values: Record<string, string>) {
    for (const [k, v] of Object.entries(values)) {
      this.sql.run(
        "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        `maint:${k}`,
        v,
      );
    }
  }

  /** GET /stats (spec: Observability): sizes, counts and each maintainer's cursor lag. */
  /**
   * Bytes the library uses against its storage limit (v2 spec: Limits): its SQLite (concepts,
   * ledger, indexes) plus every attachment it has stored in R2.
   */
  storageBytes(): number {
    const r2 =
      this.sql.all<{ n: number | null }>(
        "SELECT SUM(size) AS n FROM blobs WHERE location = 'r2'",
      )[0]?.n ?? 0;
    return (this.size ? this.size() : 0) + r2;
  }

  /** Which of these attachment hashes this library already holds (TEMPRA-91: only new ones are recorded in D1). */
  hasBlobs(hashes: string[]): Set<string> {
    const have = new Set<string>();
    for (const h of new Set(hashes)) {
      if (this.sql.all("SELECT 1 FROM blobs WHERE hash = ? AND location = 'r2'", h).length > 0) {
        have.add(h);
      }
    }
    return have;
  }

  /** The attachment hashes this library references in R2, for the daily blob sweep. */
  blobHashes(): string[] {
    return this.sql
      .all<{ hash: string }>("SELECT hash FROM blobs WHERE location = 'r2'")
      .map((r) => r.hash);
  }

  /**
   * GET /agents: who has acted in the library, each person and each of their agents, from the
   * `by` the ledger records (TEMPRA-75), most recent first. An agent becomes one of the
   * library's members the first time it acts here. Requests recorded before then have none.
   */
  contributors() {
    // Kept by the ledger's triggers (TEMPRA-86): the groups of `by` with their counts.
    const rows = this.sql.all<{
      person: string;
      agent: string | null;
      requests: number;
      first_seq: number;
      last_seq: number;
    }>(
      `SELECT person, agent, requests, first_seq, last_seq FROM contributors
       ORDER BY last_seq DESC LIMIT 500`,
    );
    return rows.map((r) => {
      const last = this.sql.all<{ actor: string; ts: string }>(
        "SELECT actor, ts FROM events WHERE seq = ?",
        r.last_seq,
      )[0];
      return { ...r, actor: last?.actor ?? "", last_ts: last?.ts ?? "" };
    });
  }

  stats() {
    const one = (q: string) => this.sql.all<{ n: number }>(q)[0]?.n ?? 0;
    const seq = this.headSeq();
    // Kept by the ledger's triggers (TEMPRA-86), not counted over it.
    const ledger = this.sql.all<{ events: number; requests: number }>(
      "SELECT events, requests FROM ledger_counts WHERE id = 1",
    )[0];
    const m = this.maintenance();
    const exportSeq = m.export_seq ? Number(m.export_seq) : 0;
    const stalenessSeq =
      this.sql.all<{ seq: number }>("SELECT seq FROM cursors WHERE maintainer = 'staleness'")[0]
        ?.seq ?? 0;
    const structureSeq =
      this.sql.all<{ seq: number }>("SELECT seq FROM cursors WHERE maintainer = 'structure'")[0]
        ?.seq ?? 0;
    return {
      seq,
      paths: one("SELECT COUNT(*) AS n FROM paths"),
      concepts: one("SELECT COUNT(*) AS n FROM paths WHERE kind = 'concept'"),
      attachments: one("SELECT COUNT(*) AS n FROM paths WHERE kind = 'attachment'"),
      events: ledger?.events ?? 0,
      requests: ledger?.requests ?? 0,
      bytes: this.size ? this.size() : null,
      // Every maintainer here is a process: deterministic, run by Tempra from the daily alarm.
      // Managed agents will be listed beside them as kind "agent".
      maintainers: {
        export: {
          kind: "process",
          cursor: exportSeq,
          lag: seq - exportSeq,
          last_run: m.export_at ?? null,
          last_key: m.export_key ?? null,
        },
        usage: { kind: "process", last_run: m.usage_at ?? null, window_days: USAGE_WINDOW_DAYS },
        staleness: {
          kind: "process",
          cursor: stalenessSeq,
          lag: seq - stalenessSeq,
          last_run: m.staleness_at ?? null,
          ...(JSON.parse(m.staleness_counts ?? '{"stale":0,"stale_soon":0}') as {
            stale: number;
            stale_soon: number;
          }),
          soon_days: STALE_SOON_DAYS,
        },
        structure: {
          kind: "process",
          cursor: structureSeq,
          lag: seq - structureSeq,
          last_run: m.structure_at ?? null,
          ...(JSON.parse(m.structure_counts ?? '{"concepts":0,"directories":0,"codes":{}}') as {
            concepts: number;
            directories: number;
            codes: Record<string, number>;
          }),
        },
        health: {
          kind: "process",
          last_run: m.health ? (JSON.parse(m.health) as LibraryHealth).at : null,
        },
      },
      next_run: m.next_run ?? null,
    };
  }

  /**
   * What happened since a person last looked (TEMPRA-72): changes to content after `since`, by
   * anyone but that person acting in the app themselves (their agents count: the owner wants to
   * see what their agents did). Counted in requests, so a batch is one change.
   */
  activity(opts: { since: number; person?: string | null }) {
    const since = Math.max(0, Math.floor(opts.since || 0));
    const row = this.sql.all<{ n: number; last: number | null }>(
      `SELECT COUNT(DISTINCT request_id) AS n, MAX(seq) AS last FROM events
       WHERE seq > ? AND op != 'comment'
         AND NOT (? != '' AND COALESCE(json_extract(meta, '$.by.person'), '') = ?
                  AND json_extract(meta, '$.by.agent') IS NULL)`,
      since,
      opts.person ?? "",
      opts.person ?? "",
    )[0];
    return { since, head: this.headSeq(), changes: row?.n ?? 0 };
  }

  /**
   * The daily digest's counts for one library (TEMPRA-74): what happened since `since` (an ISO
   * time), by people and by agents, comment threads opened and resolved, and where the library
   * stands: the library health summary's counts (TEMPRA-66) and its unverified concepts.
   */
  digest(opts: { since: string }) {
    const rows = this.sql.all<{
      actor: string;
      op: string;
      meta: string | null;
      request_id: string;
    }>("SELECT actor, op, meta, request_id FROM events WHERE ts >= ? ORDER BY seq", opts.since);
    const people = new Set<string>();
    const agents = new Set<string>();
    let opened = 0;
    let resolved = 0;
    for (const r of rows) {
      if (r.op === "comment") {
        const kind = (r.meta ? (JSON.parse(r.meta) as JsonObject) : {}).comment as
          | { kind?: string }
          | undefined;
        if (kind?.kind === "open") opened++;
        if (kind?.kind === "resolve") resolved++;
        continue;
      }
      (r.actor.startsWith("human:") ? people : agents).add(r.request_id);
    }
    // The library's health summary (TEMPRA-66), as the daily pass left it.
    const health = this.health();
    return {
      head: this.headSeq(),
      changes: { people: people.size, agents: agents.size },
      threads: { opened, resolved },
      health: { ...health.counts, unverified: health.unverified.total } as Record<string, number>,
    };
  }

  /**
   * Counts for the MCP `start` entry point and the library list; with a person's cursor, also
   * what changed since they last looked (`activity`).
   */
  summary(seen?: { since: number; person?: string | null }) {
    // Counted in SQL, never a record per concept (TEMPRA-86); types in the order the paths were
    // first stored, as a walk of the snapshot met them.
    const rows = this.sql.all<{ kind: Kind; type: string; n: number }>(
      `SELECT p.kind, CASE WHEN p.kind = 'concept' THEN COALESCE(NULLIF(c.type, ''), '(no type)') END AS type,
              COUNT(*) AS n
       FROM paths p LEFT JOIN concepts c ON c.concept_id = p.concept_id
       GROUP BY 1, 2 ORDER BY MIN(p.rowid)`,
    );
    const types: Record<string, number> = {};
    let concepts = 0;
    let attachments = 0;
    for (const r of rows) {
      if (r.kind === "attachment") attachments += r.n;
      else {
        concepts += r.n;
        types[r.type] = (types[r.type] ?? 0) + r.n;
      }
    }
    const work = this.workCounts();
    return {
      seq: this.headSeq(),
      concepts,
      attachments,
      types,
      open_work: work.total,
      stale_soon: work.stale_soon,
      health: this.health(),
      open_comments:
        this.sql.all<{ n: number }>(
          `SELECT COUNT(*) AS n FROM threads t JOIN paths p ON p.concept_id = t.concept_id
           WHERE t.status = 'open'`,
        )[0]?.n ?? 0,
      ...(seen ? { activity: this.activity(seen) } : {}),
    };
  }

  // ---------------------------------------------------------------- signed download URLs

  /** A per-library HMAC key, created on first use; it never leaves the object. */
  private signingKey(): Uint8Array {
    const row = this.sql.all<{ value: string }>(
      "SELECT value FROM meta WHERE key = 'signing_key'",
    )[0];
    if (row) return hexToBytes(row.value);
    const key = randomBytes(32);
    this.sql.run("INSERT INTO meta (key, value) VALUES ('signing_key', ?)", bytesToHex(key));
    return key;
  }

  /** A short-lived token for a download URL: a file's bytes or an export at a seq. */
  signDownload(payload: DownloadPayload, ttlSeconds = 900): string {
    const exp = Math.floor(this.clock().getTime() / 1000) + ttlSeconds;
    const body = b64url(new TextEncoder().encode(JSON.stringify({ ...payload, exp })));
    return `${body}.${b64url(hmac(sha256, this.signingKey(), new TextEncoder().encode(body)))}`;
  }

  /** Checks a download token's signature and expiry. */
  openDownload(token: string): DownloadPayload {
    const [body, sig] = token.split(".");
    const bad = new OkfError(403, "bad_download", "This download link is invalid or has expired.");
    if (!body || !sig) throw bad;
    const expected = b64url(hmac(sha256, this.signingKey(), new TextEncoder().encode(body)));
    if (expected.length !== sig.length || !equalBytes(expected, sig)) throw bad;
    let payload: DownloadPayload & { exp: number };
    try {
      payload = JSON.parse(new TextDecoder().decode(fromB64url(body)));
    } catch {
      throw bad;
    }
    if (payload.exp * 1000 < this.clock().getTime()) throw bad;
    return payload;
  }
}

export type DownloadPayload =
  | { k: "file"; path: string; hash: string; media: string | null }
  | { k: "export"; at: number; name?: string };

/** What one run of the structure process found: flags now set, and what was newly flagged. */
export interface StructureRun {
  /** Nothing was written since the last run, so nothing was checked again. */
  skipped: boolean;
  /** Concepts and directories flagged, and how many flags carry each check. */
  concepts: number;
  directories: number;
  codes: Record<string, number>;
  /** Concepts, or directories' index.md, flagged by this run that were not before. */
  became: string[];
}

/** How many of the newest unverified changes the health summary names. */
/** What a library's next maintenance pass would have to do, and when (TEMPRA-82); times in ms. */
export interface MaintenanceDue {
  /** The ledger moved since the last export. */
  exportPending: boolean;
  /** When the oldest export but the newest passes retention; null with nothing to prune. */
  exportExpiry: number | null;
  /** The next moment a concept comes within the stale-soon window or passes `stale_after`. */
  staleAt: number | null;
  /** When the oldest read count leaves the usage window. */
  usageExpiry: number | null;
}

export const HEALTH_NEWEST = 5;

/** A library's health summary (TEMPRA-66), as the daily pass leaves it in meta. */
export interface LibraryHealth {
  /** When it was worked out, and the ledger's head then. */
  at: string;
  seq: number;
  /** Open work by kind; stale_soon looks ahead and is not part of the queue. */
  counts: {
    stale: number;
    stale_soon: number;
    broken_link: number;
    lint: number;
    structure: number;
    comment: number;
  };
  /** Concepts whose latest change came after their latest verification (or that have none). */
  unverified: {
    total: number;
    newest: { path: string; seq: number; ts: string; actor: string }[];
  };
}

/** What one run of the staleness process found: counts now, and paths that changed state. */
export interface StalenessRun {
  stale: number;
  stale_soon: number;
  became: { stale: string[]; stale_soon: string[] };
}

export interface WorkItem {
  kind: string;
  path: string;
  since: string;
  detail: string;
  suggested_action: string;
  inbound_links: number;
  /** For a `comment` item: the thread to answer. */
  thread?: string;
}

/** A comment's mentions for its event's meta: only when there are some. */
function mentionsMeta(mentions: Mention[] | undefined): JsonObject {
  if (!mentions || mentions.length === 0) return {};
  return { mentions: mentions.slice(0, 20) as unknown as JsonObject[] } as JsonObject;
}

/** `s` on one line, cut to `n` characters. */
function clip(s: string, n: number): string {
  const line = s.replace(/\s+/g, " ").trim();
  return line.length > n ? `${line.slice(0, n - 1)}…` : line;
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** Constant-time string comparison. */
function equalBytes(a: string, b: string): boolean {
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

type WriteMode = "write" | "import";

/** A threads row joined with its concept's current path. */
interface ThreadRow extends Entry {
  id: string;
  actor: string;
  anchor: string | null;
  status: ThreadStatus;
  created_seq: number;
  last_seq: number;
  last_actor: string;
  resolved_by: string | null;
  resolved_seq: number | null;
  replies: number;
}

interface WriteState {
  ctx: RequestContext;
  now: string;
  mode: WriteMode;
  source: string | null;
  /** Paths created by this request, with pre-assigned concept IDs. */
  pending: Map<string, string>;
  /** Paths written by this request and their concept IDs. */
  written: Map<string, string>;
  /** Concepts whose outbound links changed state, for flag refresh. */
  affected: Set<string>;
}
