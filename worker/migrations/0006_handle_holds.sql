-- Handles released by a rename or an account deletion stay with their former account for a while
-- (v2 spec: Handles and the namespace): nobody else can take one, and its old URLs redirect.
CREATE TABLE handle_holds (
  handle   TEXT PRIMARY KEY,
  user     TEXT NOT NULL,
  released TEXT NOT NULL
);
