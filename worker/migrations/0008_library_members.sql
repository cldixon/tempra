-- Phase B sharing (tempra-dev: v2/sharing, TEMPRA-59): other accounts' access to a library.
-- The owner stays libraries.owner and is never a member row. `read` reads and comments;
-- `write` also writes content and verifies.
CREATE TABLE library_members (
  library    TEXT NOT NULL REFERENCES libraries(id),
  user       TEXT NOT NULL REFERENCES users(id),
  role       TEXT NOT NULL CHECK (role IN ('read', 'write')),
  granted_by TEXT,
  created    TEXT NOT NULL,
  PRIMARY KEY (library, user)
);
-- The libraries shared with an account.
CREATE INDEX library_members_user ON library_members (user);
