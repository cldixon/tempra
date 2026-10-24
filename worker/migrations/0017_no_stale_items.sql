-- Staleness is the agents' housekeeping (their `work` queue), not a person's (TEMPRA-142;
-- tempra-dev: v2/notifications, decisions/staleness-is-for-agents): the daily maintainer no
-- longer makes `stale` items, and the ones it made go. The kind stays allowed by the CHECK and
-- `due` stays as a column, unused, since SQLite cannot drop either without recreating the table.
DELETE FROM notifications WHERE kind = 'stale';
