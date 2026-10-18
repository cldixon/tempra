-- The blob sweep without listing R2 or waking every library (TEMPRA-81, TEMPRA-91; tempra-dev:
-- v2/blob-sweep). Additive: nothing here is trusted until every library has been counted once.

-- Every blob put in R2 (blobs/<hash>), recorded before the bytes go up; backfilled once from a
-- listing of the bucket.
CREATE TABLE IF NOT EXISTS blobs_stored (
  hash    TEXT PRIMARY KEY,
  created TEXT NOT NULL
);

-- A library references a blob. Recorded by the write path before the write commits, and replaced
-- by a recount from the library's own blobs table. `added` keeps a recount from dropping a row a
-- write has just recorded.
CREATE TABLE IF NOT EXISTS blob_refs (
  hash    TEXT NOT NULL,
  library TEXT NOT NULL, -- the library's do_id
  added   TEXT NOT NULL,
  PRIMARY KEY (hash, library)
);
CREATE INDEX IF NOT EXISTS blob_refs_library ON blob_refs (library);

-- Where each library's references stand. counted: when its rows were last replaced from the
-- library (or the library was created); NULL until then. pending: a restore's token, set before
-- the restore and cleared by the recount that carries it. Deletion waits while any existing
-- library is uncounted or pending.
CREATE TABLE IF NOT EXISTS blob_ref_libraries (
  library TEXT PRIMARY KEY,
  counted TEXT,
  pending TEXT
);
CREATE INDEX IF NOT EXISTS blob_ref_libraries_open ON blob_ref_libraries (library)
  WHERE counted IS NULL OR pending IS NOT NULL;

-- The delete step reads the oldest orphans first.
CREATE INDEX IF NOT EXISTS blob_orphans_since ON blob_orphans (since);

-- The sweep's own progress: full_at (the last full recount), listing (the backfill's cursor, or
-- done), scan (the orphan scan's last hash, or done).
CREATE TABLE IF NOT EXISTS sweep_state (
  key     TEXT PRIMARY KEY,
  value   TEXT NOT NULL,
  updated TEXT NOT NULL
);
