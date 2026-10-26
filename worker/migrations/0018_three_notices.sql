-- Notifications from zero (TEMPRA-173; tempra-dev: decisions/notifications-from-zero): a person
-- is told of an invitation, a mention and a reply, and nothing else. New threads on a page they
-- wrote or verified (`thread`), pages they verified that changed (`verify`) and changes to their
-- access (`access`) are no longer made, and the ones made go. The kinds stay allowed by the CHECK,
-- since SQLite cannot change it without recreating the table.
DELETE FROM notifications WHERE kind IN ('thread', 'verify', 'access');
