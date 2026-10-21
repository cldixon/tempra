-- The Inbox absorbs Needs you (layout take 4, TEMPRA-116; tempra-dev: v2/notifications,
-- decisions/three-activity-surfaces). Two new kinds: `verify` (a concept the person verified
-- changed since) and `stale` (a concept stale or going stale within 14 days). Both are keyed
-- (user, library, key), unique among open items, so a page edited ten times is one item. Items
-- carry what the Inbox shows without asking each library: the page's title, the agent behind
-- the actor, how many edits came since the person verified, and when the page goes stale.
--
-- SQLite cannot change a CHECK in place, so the table is recreated with its rows kept.
CREATE TABLE notifications_v2 (
  id       TEXT PRIMARY KEY,
  user     TEXT NOT NULL,
  library  TEXT,
  kind     TEXT NOT NULL CHECK (kind IN ('reply', 'mention', 'thread', 'invitation', 'access', 'report', 'verify', 'stale')),
  place    TEXT NOT NULL DEFAULT '',
  path     TEXT,
  thread   TEXT,
  seq      INTEGER,
  actor    TEXT NOT NULL,
  by_user  TEXT,
  excerpt  TEXT NOT NULL DEFAULT '',
  created  TEXT NOT NULL,
  read_at  TEXT,
  done_at  TEXT,
  mail     TEXT CHECK (mail IN ('pending', 'sent', 'skipped')),
  -- `verify` and `stale` items: '<kind>:<path>', unique among the person's open items in a library.
  key      TEXT,
  -- The concept's title when the item was made or last updated.
  title    TEXT,
  -- The agent acting for by_user (agents.ts), to name it ("Claude Code"); null for a person.
  by_agent TEXT,
  -- `verify`: content changes since the person's latest verification.
  count    INTEGER,
  -- `stale`: the concept's stale_after when the item was made.
  due      TEXT
);
INSERT INTO notifications_v2 (id, user, library, kind, place, path, thread, seq, actor, by_user, excerpt, created, read_at, done_at, mail)
  SELECT id, user, library, kind, place, path, thread, seq, actor, by_user, excerpt, created, read_at, done_at, mail FROM notifications;
DROP TABLE notifications;
ALTER TABLE notifications_v2 RENAME TO notifications;

CREATE INDEX notifications_user ON notifications (user, created);
CREATE INDEX notifications_unread ON notifications (user, library) WHERE read_at IS NULL AND done_at IS NULL;
CREATE INDEX notifications_mail ON notifications (user, created) WHERE mail = 'pending';
CREATE INDEX notifications_library ON notifications (library);
-- One open item per key: the upsert's conflict target.
CREATE UNIQUE INDEX notifications_key ON notifications (user, library, key)
  WHERE key IS NOT NULL AND done_at IS NULL;
-- Closing by what resolves an item: a page's verify or stale items, a thread's comment items.
CREATE INDEX notifications_open_path ON notifications (library, path, kind) WHERE done_at IS NULL;
CREATE INDEX notifications_open_thread ON notifications (library, thread) WHERE done_at IS NULL AND thread IS NOT NULL;
