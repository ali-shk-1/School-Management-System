-- Migration: optional email on user accounts + OTP-based password reset.
--
-- * users.email        — optional (Gmail or any mailbox), unique when set.
--                        Entered by ali when creating/editing an account.
-- * password_resets    — one-time codes emailed by "Forgot password" on the
--                        login page. Only a keyed hash of the code is stored.
--
-- SAFE TO RUN on a live database: adds a nullable column and a new table.
-- Re-runnable (IF NOT EXISTS).

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(255);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (email);

CREATE TABLE IF NOT EXISTS password_resets (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  otp_hash    VARCHAR(128) NOT NULL,
  expires_at  TIMESTAMP(3) NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS password_resets_user_id_idx ON password_resets (user_id);

COMMIT;
