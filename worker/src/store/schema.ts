import type { SqlHandle } from "./sql";

/**
 * The Library DO schema (spec: Data model). `blobs` and `events` are the source of truth and are
 * append-only; every other table is derived and can be rebuilt by replaying `events`. A concept's
 * blob is its record: the stored tree and its markdown (tempra-dev: decisions/structured-documents);
 * `fts` indexes the markdown.
 *
 * Version 1 is a restart (TEMPRA-22): libraries stored in an earlier format are not read.
 */
export const SCHEMA_VERSION = 1;

/**
 * Counts over the whole ledger, kept by triggers as events are appended (TEMPRA-86), so `stats`
 * and `contributors` never scan it: the number of events and requests, and per person and agent
 * (the `by` in an event's meta, TEMPRA-75) their requests and first and last seq. Libraries from
 * before get these once, filled from the ledger (`LibraryStore`'s `addLedgerCounts`).
 */
export const LEDGER_COUNTS = `
CREATE TABLE IF NOT EXISTS ledger_counts (
  id       INTEGER PRIMARY KEY CHECK (id = 1),
  events   INTEGER NOT NULL,
  requests INTEGER NOT NULL
);
INSERT OR IGNORE INTO ledger_counts (id, events, requests) VALUES (1, 0, 0);
-- person and agent as json_extract gives them (agent may be NULL); agent_key tells NULL apart.
CREATE TABLE IF NOT EXISTS contributors (
  person    NOT NULL,
  agent,
  agent_key TEXT NOT NULL,
  requests  INTEGER NOT NULL,
  first_seq INTEGER NOT NULL,
  last_seq  INTEGER NOT NULL,
  PRIMARY KEY (person, agent_key)
);
CREATE INDEX IF NOT EXISTS contributors_last ON contributors(last_seq);
CREATE TRIGGER IF NOT EXISTS events_counted AFTER INSERT ON events
BEGIN
  UPDATE ledger_counts SET events = events + 1,
    requests = requests + NOT EXISTS (
      SELECT 1 FROM events WHERE request_id = NEW.request_id AND seq <> NEW.seq)
  WHERE id = 1;
  INSERT INTO contributors (person, agent, agent_key, requests, first_seq, last_seq)
  SELECT json_extract(NEW.meta, '$.by.person'), json_extract(NEW.meta, '$.by.agent'),
         CASE WHEN json_extract(NEW.meta, '$.by.agent') IS NULL THEN 'n'
              ELSE 's' || json_extract(NEW.meta, '$.by.agent') END,
         1, NEW.seq, NEW.seq
  WHERE NEW.meta IS NOT NULL AND json_extract(NEW.meta, '$.by.person') IS NOT NULL
  ON CONFLICT (person, agent_key) DO UPDATE SET last_seq = excluded.last_seq,
    requests = requests + NOT EXISTS (
      SELECT 1 FROM events e WHERE e.request_id = NEW.request_id AND e.seq <> NEW.seq
        AND json_extract(e.meta, '$.by.person') = json_extract(NEW.meta, '$.by.person')
        AND json_extract(e.meta, '$.by.agent') IS json_extract(NEW.meta, '$.by.agent'));
END;
`;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS blobs (
  hash      TEXT PRIMARY KEY,
  size      INTEGER NOT NULL,
  location  TEXT NOT NULL,
  content   BLOB,
  media     TEXT,
  width     INTEGER,
  height    INTEGER
);
-- blobs.width and height: an image's size in pixels from its header (TEMPRA-152); 0 when checked
-- and unknown, NULL when never worked out (a library from before, filled on first read). Kept out
-- of the CREATE TABLE, whose text SQLite rewrites on ALTER TABLE (a comment in it broke DROP
-- COLUMN on the SQLite that bun 1.3 ships).

CREATE TABLE IF NOT EXISTS events (
  seq         INTEGER PRIMARY KEY,
  ts          TEXT NOT NULL,
  actor       TEXT NOT NULL,
  request_id  TEXT NOT NULL,
  op          TEXT NOT NULL,
  path        TEXT NOT NULL,
  prev_hash   TEXT,
  hash        TEXT,
  concept_id  TEXT NOT NULL,
  meta        TEXT
);
CREATE INDEX IF NOT EXISTS events_path ON events(path, seq);
CREATE INDEX IF NOT EXISTS events_request ON events(request_id);
CREATE INDEX IF NOT EXISTS events_concept ON events(concept_id, seq);

CREATE TABLE IF NOT EXISTS paths (
  path        TEXT PRIMARY KEY,
  concept_id  TEXT NOT NULL UNIQUE,
  hash        TEXT NOT NULL REFERENCES blobs(hash),
  kind        TEXT NOT NULL,
  last_seq    INTEGER NOT NULL,
  created_seq INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS concepts (
  concept_id   TEXT PRIMARY KEY,
  type         TEXT NOT NULL,
  title        TEXT,
  description  TEXT,
  resource     TEXT,
  status       TEXT NOT NULL,
  stale_after  TEXT,
  -- stale_after as epoch ms, for the staleness process's range query (TEMPRA-63).
  stale_ms     INTEGER,
  generated_by TEXT,
  generated_at TEXT,
  extra        TEXT,
  lint         TEXT
);
CREATE INDEX IF NOT EXISTS concepts_stale ON concepts(stale_ms) WHERE stale_ms IS NOT NULL;
CREATE TABLE IF NOT EXISTS verifications (
  concept_id TEXT NOT NULL, by TEXT NOT NULL, at TEXT NOT NULL, seq INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS verifications_concept ON verifications(concept_id, seq);
CREATE TABLE IF NOT EXISTS tags (concept_id TEXT, tag TEXT, PRIMARY KEY (concept_id, tag));
-- Body links and internal \`sources[].resource\` citations, told apart by \`kind\`.
CREATE TABLE IF NOT EXISTS links (
  from_id    TEXT NOT NULL,
  to_id      TEXT,
  to_path    TEXT,
  anchor     TEXT,
  form       TEXT NOT NULL,
  raw        TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'body'
);
CREATE INDEX IF NOT EXISTS links_from_id ON links(from_id);
CREATE INDEX IF NOT EXISTS links_to_id ON links(to_id);
CREATE INDEX IF NOT EXISTS links_to_path ON links(to_path);
CREATE TABLE IF NOT EXISTS redirects (
  old_path   TEXT PRIMARY KEY,
  concept_id TEXT NOT NULL,
  since_seq  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sources (
  concept_id  TEXT NOT NULL,
  id          TEXT,
  resource    TEXT NOT NULL,
  internal_id TEXT,
  cited       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sources_concept ON sources(concept_id);
CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(concept_id UNINDEXED, title, body, tags);
-- Each concept's row in fts, so a write replaces it by rowid instead of scanning fts (TEMPRA-87).
CREATE TABLE IF NOT EXISTS fts_rows (concept_id TEXT PRIMARY KEY, fts_rowid INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS cursors (maintainer TEXT PRIMARY KEY, seq INTEGER NOT NULL);
-- One row per day, concept and actor, so reads are counted with an upsert.
CREATE TABLE IF NOT EXISTS access_log (day TEXT, concept_id TEXT, actor TEXT, reads INTEGER);
CREATE UNIQUE INDEX IF NOT EXISTS access_log_key ON access_log(day, concept_id, actor);
CREATE TABLE IF NOT EXISTS flags (
  concept_id TEXT, kind TEXT, since_seq INTEGER, detail TEXT,
  PRIMARY KEY (concept_id, kind)
);
CREATE INDEX IF NOT EXISTS flags_kind ON flags(kind);

CREATE TABLE IF NOT EXISTS threads (
  id           TEXT PRIMARY KEY,
  concept_id   TEXT NOT NULL,
  actor        TEXT NOT NULL,
  anchor       TEXT,
  status       TEXT NOT NULL,
  created_seq  INTEGER NOT NULL,
  last_seq     INTEGER NOT NULL,
  last_actor   TEXT NOT NULL,
  resolved_by  TEXT,
  resolved_seq INTEGER,
  replies      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS threads_concept ON threads(concept_id, last_seq);
CREATE INDEX IF NOT EXISTS threads_last ON threads(last_seq);
CREATE INDEX IF NOT EXISTS threads_open ON threads(concept_id) WHERE status = 'open';
CREATE TABLE IF NOT EXISTS comments (
  id        TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  actor     TEXT NOT NULL,
  body      TEXT NOT NULL,
  ts        TEXT NOT NULL,
  seq       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS comments_thread ON comments(thread_id, seq);
-- Historical snapshots look for each concept's last content event; with op in it, this index
-- covers that query, so it never reads event rows.
CREATE INDEX IF NOT EXISTS events_content ON events(concept_id, seq, op) WHERE op != 'comment';
${LEDGER_COUNTS}`;

/**
 * Creates the schema in a new library; a no-op when it is current. A library stored in another
 * version is refused: there is no migration across the TEMPRA-22 restart.
 */
export function migrate(sql: SqlHandle): void {
  sql.script("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);");
  const row = sql.all<{ value: string }>("SELECT value FROM meta WHERE key = 'schema_version'")[0];
  if (row && Number(row.value) === SCHEMA_VERSION) return;
  if (row) {
    throw new Error(
      `Library schema version ${row.value} is not ${SCHEMA_VERSION}; it predates the TEMPRA-22 restart and must be deleted.`,
    );
  }
  sql.transaction(() => {
    sql.script(SCHEMA);
    sql.run("INSERT INTO meta (key, value) VALUES ('schema_version', ?)", String(SCHEMA_VERSION));
  });
}
