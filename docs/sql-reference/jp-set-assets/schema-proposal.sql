-- Block 5A-W-50G — PROPOSED schema addition for Japanese set assets.
--
-- STATUS: DRAFT — DO NOT APPLY UNTIL REVIEWED.
--
-- This file is stored under docs/sql-reference/ (NOT migrations/) so
-- no migration runner accidentally executes it. When approved, the
-- final version will be renamed to
-- migrations/2026-08-DD-set-metadata-asset-provenance.sql and applied
-- manually in the Supabase SQL Editor.
--
-- Adds logo/symbol/provenance columns to set_metadata. All new
-- columns are nullable and null-defaulted so this migration is a
-- pure additive change — existing English rows and Japanese rows
-- alike keep working. RLS is not affected (set_metadata is a public
-- read-only reference table).
--
-- Rollback:
--   ALTER TABLE set_metadata
--     DROP COLUMN IF EXISTS logo_url,
--     DROP COLUMN IF EXISTS symbol_url,
--     DROP COLUMN IF EXISTS logo_source,
--     DROP COLUMN IF EXISTS symbol_source,
--     DROP COLUMN IF EXISTS logo_source_id,
--     DROP COLUMN IF EXISTS logo_confidence,
--     DROP COLUMN IF EXISTS logo_review_status,
--     DROP COLUMN IF EXISTS logo_retrieved_at;

ALTER TABLE set_metadata
  ADD COLUMN IF NOT EXISTS logo_url            text,
  ADD COLUMN IF NOT EXISTS symbol_url          text,
  ADD COLUMN IF NOT EXISTS logo_source         text,
  ADD COLUMN IF NOT EXISTS symbol_source       text,
  ADD COLUMN IF NOT EXISTS logo_source_id      text,
  ADD COLUMN IF NOT EXISTS logo_confidence     text,
  ADD COLUMN IF NOT EXISTS logo_review_status  text,
  ADD COLUMN IF NOT EXISTS logo_retrieved_at   timestamptz;

-- Enum constraints. Idempotent add via DO block so re-running is safe.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'set_metadata_logo_confidence_check') THEN
    ALTER TABLE set_metadata
      ADD CONSTRAINT set_metadata_logo_confidence_check
      CHECK (logo_confidence IS NULL OR logo_confidence IN ('confirmed','probable','ambiguous','unavailable'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'set_metadata_logo_review_status_check') THEN
    ALTER TABLE set_metadata
      ADD CONSTRAINT set_metadata_logo_review_status_check
      CHECK (logo_review_status IS NULL OR logo_review_status IN ('pending','confirmed','rejected','unavailable'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'set_metadata_logo_source_check') THEN
    ALTER TABLE set_metadata
      ADD CONSTRAINT set_metadata_logo_source_check
      CHECK (logo_source IS NULL OR logo_source IN ('tcgdex','bulbapedia','pokemon-card','manual','bundled'));
  END IF;
END $$;

-- Helpful partial index for the review workflow so an admin dashboard
-- can quickly list rows that still need human attention.
CREATE INDEX IF NOT EXISTS idx_set_metadata_review_pending
  ON set_metadata (logo_review_status)
  WHERE logo_review_status = 'pending';

-- Verification queries (informational — paste after apply):
--   SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_name = 'set_metadata' AND column_name LIKE 'logo\_%' OR column_name LIKE 'symbol\_%';
--
--   SELECT logo_review_status, COUNT(*) FROM set_metadata
--    WHERE language = 'jp' GROUP BY logo_review_status;
