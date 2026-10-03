-- v2 A4 (v2 spec: Migration, A4 as built): who may create an account when SIGNUP=invite.

-- Emails allowed to create an account.
CREATE TABLE invites (
  email   TEXT PRIMARY KEY,
  created TEXT NOT NULL
);

-- Emails that asked to sign in without an invite; the operator can invite them later.
CREATE TABLE waitlist (
  email   TEXT PRIMARY KEY,
  created TEXT NOT NULL,
  ip      TEXT
);
