-- The account's theme (layout take 4, TEMPRA-113; tempra-dev: app/workspace, Theme): 'light' or
-- 'dark', or NULL for the system's. The shell puts it on its root so a page never flashes the
-- wrong scheme. Additive.
ALTER TABLE users ADD COLUMN theme TEXT;
