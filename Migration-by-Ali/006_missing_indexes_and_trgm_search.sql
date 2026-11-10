-- Migration: close the remaining indexing gaps found in a follow-up
-- performance audit. Two categories:
--
-- 1. Plain btree indexes on FK columns and a date column that Postgres
--    never auto-creates (only the PK side of a FK is auto-indexed) and
--    that weren't covered by earlier migrations. These ARE mirrored in
--    prisma/schema.prisma (see @@index additions on User, Staff,
--    FeePayment, Expense).
--
-- 2. pg_trgm GIN indexes for leading-wildcard LIKE search
--    ('%term%'), same fix as migration 005 applied to students.name,
--    now extended to the two other search-by-substring endpoints that
--    were missed: GET /api/fees/receipts?search= (student_name, plus
--    numeric roll_no/receipt_no which stay on a plain scan — trgm only
--    helps free-text columns) and GET /api/staff?search= (name, cnic).
--    These are Postgres-specific and intentionally NOT modeled in
--    schema.prisma, same rationale as 005.
--
-- SAFE TO RUN on a live database: index-only, no data changes. All
-- CREATE INDEX use IF NOT EXISTS so this is safe to re-run.

BEGIN;

-- ── FK / filter columns missing a plain index ──────────────────────────
CREATE INDEX IF NOT EXISTS users_role_id_idx        ON users (role_id);
CREATE INDEX IF NOT EXISTS staff_designation_id_idx  ON staff (designation_id);
CREATE INDEX IF NOT EXISTS staff_admin_id_idx        ON staff (admin_id);
CREATE INDEX IF NOT EXISTS expenses_category_id_idx  ON expenses (category_id);

-- GET /api/fees/daily filters `payment_date >= :date AND < :date+1day`
-- and sorts `ORDER BY payment_date DESC` — never had a supporting index.
CREATE INDEX IF NOT EXISTS fee_payments_payment_date_idx ON fee_payments (payment_date);

-- ── Substring search columns needing pg_trgm (already enabled in 005) ──
CREATE INDEX IF NOT EXISTS payment_receipts_student_name_trgm_idx
  ON payment_receipts USING GIN (student_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS staff_name_trgm_idx
  ON staff USING GIN (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS staff_cnic_trgm_idx
  ON staff USING GIN (cnic gin_trgm_ops);

COMMIT;

-- After running this:
--   1. `npx prisma db pull` (optional) to confirm Prisma sees the plain
--      btree indexes — they're already hand-added to schema.prisma in
--      this same change, so db pull should report no diff for those.
--   2. `npx prisma generate` to refresh the client.
--   3. No app code changes needed for the trgm indexes — the existing
--      LIKE '%term%' queries in app/api/fees/receipts/route.ts and
--      app/api/staff/route.ts pick them up automatically.
