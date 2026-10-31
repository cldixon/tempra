-- Monthly quotas (TEMPRA-232; tempra-dev: v2/limits, Monthly quotas): each library's storage,
-- recorded by its object after a write (a minute apart at most), so an account's storage across
-- its libraries is one D1 read. 0 until the library's next write.
ALTER TABLE libraries ADD COLUMN storage_bytes INTEGER NOT NULL DEFAULT 0;
