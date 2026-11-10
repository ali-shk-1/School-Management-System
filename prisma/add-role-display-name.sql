-- Adds an editable display name per role, independent of the fixed
-- role_name slug (which stays as the stable key used everywhere in code:
-- permissions rows, page-visibility rows, JWT claims, etc).
-- Run this against the database, then run `prisma generate` / restart the app.

ALTER TABLE roles ADD COLUMN IF NOT EXISTS display_name VARCHAR(50);
