-- A fourth notice, `quota` (TEMPRA-232; tempra-dev: decisions/notifications-from-zero, addendum
-- 2026-10-31): once at 80% and once at 100% of each monthly quota, in the bell and by mail, on
-- no library (it opens /account#usage). The CHECK on kind gains it; SQLite cannot change a CHECK
-- in place, so the table is recreated with its rows and indexes kept, as 0016 did.
CREATE TABLE notifications_v3 (
  id       TEXT PRIMARY KEY,
  user     TEXT NOT NULL,
  library  TEXT,
  kind     TEXT NOT NULL CHECK (kind IN ('reply', 'mention', 'thread', 'invitation', 'access', 'report', 'verify', 'stale', 'quota')),
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
  key      TEXT,
  title    TEXT,
  by_agent TEXT,
  count    INTEGER,
  due      TEXT
);
INSERT INTO notifications_v3 (id, user, library, kind, place, path, thread, seq, actor, by_user, excerpt, created, read_at, done_at, mail, key, title, by_agent, count, due)
  SELECT id, user, library, kind, place, path, thread, seq, actor, by_user, excerpt, created, read_at, done_at, mail, key, title, by_agent, count, due FROM notifications;
DROP TABLE notifications;
ALTER TABLE notifications_v3 RENAME TO notifications;

CREATE INDEX notifications_user ON notifications (user, created);
CREATE INDEX notifications_unread ON notifications (user, library) WHERE read_at IS NULL AND done_at IS NULL;
CREATE INDEX notifications_mail ON notifications (user, created) WHERE mail = 'pending';
CREATE INDEX notifications_library ON notifications (library);
CREATE UNIQUE INDEX notifications_key ON notifications (user, library, key)
  WHERE key IS NOT NULL AND done_at IS NULL;
CREATE INDEX notifications_open_path ON notifications (library, path, kind) WHERE done_at IS NULL;
CREATE INDEX notifications_open_thread ON notifications (library, thread) WHERE done_at IS NULL AND thread IS NOT NULL;
