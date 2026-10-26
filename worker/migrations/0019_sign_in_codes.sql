-- A code beside the sign-in link (TEMPRA-188; tempra-dev: v2/accounts, The code): the link's row
-- also holds the code's hash (SHA-256 of the email and the code) and how many wrong codes were
-- tried against that email while it was live; at CODE_TRIES the code no longer works (the link
-- still does). Using the link or the code uses up the row.
ALTER TABLE sign_in_links ADD COLUMN code_hash TEXT;
ALTER TABLE sign_in_links ADD COLUMN tries INTEGER NOT NULL DEFAULT 0;
