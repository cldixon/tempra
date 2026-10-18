-- A person's agent can create a library for them (TEMPRA-100, tempra-dev: v2/sharing). Additive.

-- What the creator said the library is for: optional, one line each, shown to agents at `start`
-- and in the library list. Nothing reads them to authorize anything.
ALTER TABLE libraries ADD COLUMN title TEXT;
ALTER TABLE libraries ADD COLUMN description TEXT;

-- Libraries a "selected" app connection created and so reaches, beside the ones picked at
-- consent. A grant's props live encrypted in the OAuth provider's KV and are copied into each
-- access token, so they cannot be changed safely after consent; rows here are only ever
-- inserted, so two creates on one connection cannot drop each other's library. `grant_id` is
-- the random id in the grant's props (AccountGrant.id), never the provider's grant id, and
-- every read also matches `user`, so a row can only widen the connection that wrote it.
CREATE TABLE grant_libraries (
  grant_id TEXT NOT NULL,
  user     TEXT NOT NULL REFERENCES users(id),
  library  TEXT NOT NULL REFERENCES libraries(id),
  created  TEXT NOT NULL,
  PRIMARY KEY (grant_id, library)
);
-- Deleting a library or an account removes its rows.
CREATE INDEX IF NOT EXISTS grant_libraries_library ON grant_libraries (library);
CREATE INDEX IF NOT EXISTS grant_libraries_user ON grant_libraries (user);
