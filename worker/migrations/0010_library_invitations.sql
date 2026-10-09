-- Invitations to a library (tempra-dev: v2/sharing, TEMPRA-61). Only Tempra accounts are
-- invited, so an invitation names its user and is accepted from the app while signed in; the
-- email carries no secret. Accepting makes a library_members row.
CREATE TABLE library_invitations (
  id         TEXT PRIMARY KEY,
  library    TEXT NOT NULL REFERENCES libraries(id),
  user       TEXT NOT NULL REFERENCES users(id),
  role       TEXT NOT NULL CHECK (role IN ('read', 'write')),
  invited_by TEXT NOT NULL,
  created    TEXT NOT NULL,
  expires    TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending'
             CHECK (status IN ('pending', 'accepted', 'declined', 'revoked')),
  decided    TEXT
);
-- At most one pending invitation per person per library.
CREATE UNIQUE INDEX library_invitations_pending ON library_invitations (library, user)
  WHERE status = 'pending';
CREATE INDEX library_invitations_user ON library_invitations (user, status);
CREATE INDEX library_invitations_library ON library_invitations (library, created);
