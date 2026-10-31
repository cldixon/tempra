-- Outgoing mail through MAIL_QUEUE (TEMPRA-89; tempra-dev: decisions/mail-through-a-queue): each
-- mail's dedupe key, claimed by the consumer before it sends and marked sent after, so a
-- redelivered message or a producer's repeat never mails twice. Pruned after 14 days.
CREATE TABLE mail_sent (
  key        TEXT PRIMARY KEY,
  claimed_at TEXT NOT NULL,
  sent_at    TEXT
);
CREATE INDEX mail_sent_claimed ON mail_sent (claimed_at);
