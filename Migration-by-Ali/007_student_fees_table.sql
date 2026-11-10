-- Migration: add student_fees table (per-student "Total Fee" override).
--
-- Backs the new Fees -> "Students Fee" sub-page, where ali (and anyone
-- granted the new student-fees.* permissions) sets one total-fee amount
-- per individual student — overriding the class-wide amount from
-- class_fees for that one student (e.g. a sibling discount, a
-- scholarship, or any other special-case fee).
--
-- Lookup order used by the app: a student's own student_fees row wins
-- if present; otherwise it falls back to the class_fees row for their
-- class; otherwise Total Fee/Discount are simply omitted, exactly as
-- before this migration. This does NOT change how fee_payments'
-- amount_due/amount_paid or balance are calculated anywhere else.
--
-- Safe to run on a live database: this only adds a new table, it does
-- not touch any existing table or row.

BEGIN;

CREATE TABLE IF NOT EXISTS student_fees (
  student_fee_id SERIAL PRIMARY KEY,
  student_id     INTEGER NOT NULL UNIQUE REFERENCES students(student_id) ON DELETE CASCADE,
  total_fee      NUMERIC(10, 2) NOT NULL,
  updated_at     TIMESTAMP NOT NULL DEFAULT now(),
  updated_by     VARCHAR(50)
);

COMMIT;

-- After running this, run `npx prisma generate` to regenerate the
-- Prisma client against the updated schema.prisma (StudentFee model).
