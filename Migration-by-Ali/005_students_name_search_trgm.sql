-- 005_students_name_search_trgm.sql
-- Adapted from v8's version: same pg_trgm rationale (a plain btree can't
-- serve leading-wildcard LIKE '%term%' lookups), but targets
-- first_name/last_name separately since this version keeps them as
-- separate columns rather than a merged `name` column.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS students_first_name_trgm_idx
  ON students USING GIN (first_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS students_last_name_trgm_idx
  ON students USING GIN (last_name gin_trgm_ops);
