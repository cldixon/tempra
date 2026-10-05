-- The waitlist as a review queue (v2 spec: Accounts and sign-in, The waitlist).
-- notified: when the operator was told; decided/decision: invited or dismissed, NULL while waiting.
ALTER TABLE waitlist ADD COLUMN notified TEXT;
ALTER TABLE waitlist ADD COLUMN decided TEXT;
ALTER TABLE waitlist ADD COLUMN decision TEXT;
CREATE INDEX waitlist_notified ON waitlist (notified);
