-- Migration: allow ONE receipt number to cover several months.
--
-- Until now payment_receipts.receipt_no was the primary key, so every
-- receipt row had its own unique number (1 receipt = 1 fee_payments row).
-- To let a single submission cover several months, each month still gets
-- its own receipt ROW (its own payment_id, academic_month and amounts, so
-- every month lands in the right place), but all rows from the same
-- submission share the same receipt_no.
--
-- This adds a new surrogate primary key (receipt_id) and keeps receipt_no
-- as a plain, non-unique, indexed column that keeps auto-numbering from
-- its existing sequence. Existing rows keep their receipt_no unchanged.
-- Safe on a live database: no row is deleted or renumbered.

BEGIN;

-- 1. New surrogate key.
ALTER TABLE payment_receipts ADD COLUMN receipt_id SERIAL;

-- 2. Swap the primary key from receipt_no to receipt_id.
ALTER TABLE payment_receipts DROP CONSTRAINT payment_receipts_pkey;
ALTER TABLE payment_receipts ADD CONSTRAINT payment_receipts_pkey PRIMARY KEY (receipt_id);

-- 3. receipt_no stays auto-numbered (its sequence/default are untouched),
--    but is no longer unique. Index it for lookups/search.
CREATE INDEX IF NOT EXISTS payment_receipts_receipt_no_idx ON payment_receipts (receipt_no);

COMMIT;
