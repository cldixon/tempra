-- Library health rows (TEMPRA-92; tempra-dev: v2/library-maintenance, Health rows): each library
-- reports its own problems from its maintenance pass, and the operator digest reads only these
-- rows, waking no library. One row per library, written by its object when what it reports
-- changed; `next_run` is when its next pass is due, so a library whose alarm stopped is found by
-- an indexed range. Additive: a library has no row until its first use or pass after the deploy.
CREATE TABLE IF NOT EXISTS library_health (
  library    TEXT PRIMARY KEY, -- the library's do_id
  problems   TEXT,             -- a JSON array of sentences for the operator; NULL when none
  open_work  INTEGER NOT NULL DEFAULT 0, -- open work in the health summary (TEMPRA-66)
  counts     TEXT,             -- that summary's counts as JSON; NULL when there is no open work
  next_run   TEXT,             -- when the library's next maintenance pass is due
  checked_at TEXT NOT NULL     -- when the row last changed
);
CREATE INDEX IF NOT EXISTS library_health_problems ON library_health (library)
  WHERE problems IS NOT NULL;
CREATE INDEX IF NOT EXISTS library_health_next_run ON library_health (next_run);
CREATE INDEX IF NOT EXISTS library_health_open ON library_health (open_work, library)
  WHERE open_work > 0;
