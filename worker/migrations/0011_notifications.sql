-- Notifications (tempra-dev: TEMPRA-58, TEMPRA-72, TEMPRA-74). Items addressed to one person
-- (a reply on their thread, a mention, a new thread on what they wrote, an invitation, an access
-- change) are fanned out here by the Worker after the write commits, so the inbox and its counts
-- are one D1 query, never a call to each library. General activity is not stored: it is counted
-- from each library's ledger after the person's cursor (library_seen).
CREATE TABLE notifications (
  id       TEXT PRIMARY KEY,
  user     TEXT NOT NULL,
  -- The library it happened in; null for none (reserved).
  library  TEXT,
  kind     TEXT NOT NULL CHECK (kind IN ('reply', 'mention', 'thread', 'invitation', 'access', 'report')),
  -- Where: the library as {owner}/{slug} when it happened, the concept, the thread, the ledger seq.
  place    TEXT NOT NULL DEFAULT '',
  path     TEXT,
  thread   TEXT,
  seq      INTEGER,
  -- Who did it: the ledger actor, and the person behind it (a users id; null for none).
  actor    TEXT NOT NULL,
  by_user  TEXT,
  -- One line of what was said or done.
  excerpt  TEXT NOT NULL DEFAULT '',
  created  TEXT NOT NULL,
  read_at  TEXT,
  done_at  TEXT,
  -- Immediate mail: pending until the batch goes out; then sent, or skipped (read first, mail off,
  -- over the day's cap); null when it is never mailed.
  mail     TEXT CHECK (mail IN ('pending', 'sent', 'skipped'))
);
-- The inbox, newest first (rowid order within a user), and its unread count.
CREATE INDEX notifications_user ON notifications (user);
CREATE INDEX notifications_unread ON notifications (user, library) WHERE read_at IS NULL AND done_at IS NULL;
-- The mail batcher's queue.
CREATE INDEX notifications_mail ON notifications (user, created) WHERE mail = 'pending';

-- "Seen up to seq N": one cursor per person per library, replacing the browser's local storage.
CREATE TABLE library_seen (
  user    TEXT NOT NULL,
  library TEXT NOT NULL,
  seq     INTEGER NOT NULL,
  updated TEXT NOT NULL,
  PRIMARY KEY (user, library)
);

-- Mail preferences: the account's row has library '', a library's override its id; a null
-- setting follows the account. unsub_key (account row only) is the one-click unsubscribe link's
-- secret; mail_day and mail_count enforce the daily cap; digest_at is the last digest sent.
CREATE TABLE notification_prefs (
  user       TEXT NOT NULL,
  library    TEXT NOT NULL DEFAULT '',
  immediate  INTEGER,
  digest     INTEGER,
  unsub_key  TEXT,
  mail_day   TEXT,
  mail_count INTEGER NOT NULL DEFAULT 0,
  digest_at  TEXT,
  PRIMARY KEY (user, library)
);
CREATE UNIQUE INDEX notification_prefs_unsub ON notification_prefs (unsub_key) WHERE unsub_key IS NOT NULL;

-- Notification mail that failed to send, by day, for the operator's digest.
CREATE TABLE mail_failures (
  day   TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0
);
