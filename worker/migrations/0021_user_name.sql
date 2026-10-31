-- The account's name (TEMPRA-54; tempra-dev: v2/accounts, Name): optional, the person's own
-- words, NULL when not given. It gives the avatar its initials; it is not an actor and replaces
-- the handle nowhere. Additive.
ALTER TABLE users ADD COLUMN name TEXT;
