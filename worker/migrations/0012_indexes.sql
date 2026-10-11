-- Indexes for queries that scanned their table (TEMPRA-78), and for the daily prune (TEMPRA-79).
-- Additive and safe to re-run.

-- libraryByDoId: every download and server page, and once per library in the library list.
-- do_id names the Durable Object; every writer sets it to the library's id, so it is unique.
CREATE UNIQUE INDEX IF NOT EXISTS libraries_do_id ON libraries (do_id);

-- An account's tokens and its token limit (created_by, or library for older tokens with no
-- minter); tokens.library also backs the foreign key checked when a library is deleted.
CREATE INDEX IF NOT EXISTS tokens_created_by ON tokens (created_by);
CREATE INDEX IF NOT EXISTS tokens_library ON tokens (library, created_by);

-- The per-IP sign-in rate limit, and the daily prune of old links.
CREATE INDEX IF NOT EXISTS sign_in_links_ip ON sign_in_links (ip, created);
CREATE INDEX IF NOT EXISTS sign_in_links_created ON sign_in_links (created);

-- The daily prune of expired sessions (idle_expires never passes expires).
CREATE INDEX IF NOT EXISTS sessions_idle_expires ON sessions (idle_expires);

-- Deleting a library removes its rows from these by library.
CREATE INDEX IF NOT EXISTS notifications_library ON notifications (library);
CREATE INDEX IF NOT EXISTS library_seen_library ON library_seen (library);
CREATE INDEX IF NOT EXISTS notification_prefs_library ON notification_prefs (library);

-- The daily digest's recipients.
CREATE INDEX IF NOT EXISTS notification_prefs_digest ON notification_prefs (user) WHERE digest = 1;
