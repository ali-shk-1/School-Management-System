-- 004_students_perf_indexes.sql
-- Adapted from v8's 004_students_single_name_and_perf_indexes.sql:
-- the name-merge portion is intentionally EXCLUDED (first_name/last_name
-- stay as separate columns in this version). Only the index additions
-- are carried over, indexing first_name/last_name instead of a merged
-- `name` column.

CREATE INDEX IF NOT EXISTS students_class_section_idx
  ON students (class, section);

CREATE INDEX IF NOT EXISTS students_first_name_idx
  ON students (first_name);

CREATE INDEX IF NOT EXISTS students_last_name_idx
  ON students (last_name);

CREATE INDEX IF NOT EXISTS expenses_created_at_idx
  ON expenses (created_at);
