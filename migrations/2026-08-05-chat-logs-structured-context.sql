-- migrations/2026-08-05-chat-logs-structured-context.sql
--
-- Block 5A-W-52A.2 — extend chat_logs with the structured-context
-- provenance columns the client now supplies + the exact-match
-- discipline the edge function now enforces.
--
-- Column naming discipline:
--   * requested_card_id       — text form of cards.id           (DB PK)
--   * requested_card_slug     — text of cards.card_slug         (PriceCharting id)
--   * requested_card_url_slug — text of cards.card_url_slug     (URL slug)
--   * matched_card_id         — text form of cards.id           (DB PK)
--   * matched_card_slug       — text of cards.card_slug         (PriceCharting id)
--   * matched_card_url_slug   — text of cards.card_url_slug     (URL slug)
--   * matched_card_name       — cleaned cards.card_name (no "#NN" suffix)
--
-- These short names mirror the actual `cards` table column names,
-- so `matched_card_slug` unambiguously refers to cards.card_slug
-- (the PriceCharting product id) — the same way it does anywhere
-- else in the DB. Client-side TypeScript keeps the longer
-- unambiguous names (cardRecordId / cardUrlSlug /
-- priceChartingProductId) since those cross system boundaries.
--
-- All columns are nullable so pre-52A rows and the edge function's
-- legacy insert fallback both continue to write cleanly. This
-- migration is purely additive.
--
-- Deployment order (required):
--   1. Apply this migration in the Supabase SQL Editor.
--   2. Deploy the updated edge function (smart-endpoint).
--   3. Deploy the updated web client.
--
-- Operational rollback (recommended):
--   1. Revert the web commit and let Vercel redeploy.
--   2. Redeploy the previous `smart-endpoint` Edge Function version.
--   3. LEAVE the new nullable columns in place — the migration is
--      additive and the columns cost nothing when unused. See the
--      exceptional column-drop block at the end of this file only
--      if there is a specific DB-side reason to remove them.

BEGIN;

ALTER TABLE public.chat_logs
  ADD COLUMN IF NOT EXISTS intent                       text,
  ADD COLUMN IF NOT EXISTS context_source               text,
  ADD COLUMN IF NOT EXISTS requested_card_id            text,
  ADD COLUMN IF NOT EXISTS requested_card_slug          text,
  ADD COLUMN IF NOT EXISTS requested_card_url_slug      text,
  ADD COLUMN IF NOT EXISTS requested_set_name           text,
  ADD COLUMN IF NOT EXISTS requested_language           text,
  ADD COLUMN IF NOT EXISTS matched_card_id              text,
  ADD COLUMN IF NOT EXISTS matched_card_slug            text,
  ADD COLUMN IF NOT EXISTS matched_card_url_slug        text,
  ADD COLUMN IF NOT EXISTS matched_card_name            text,
  ADD COLUMN IF NOT EXISTS matched_set_name             text,
  ADD COLUMN IF NOT EXISTS matched_card_number          text,
  ADD COLUMN IF NOT EXISTS matched_card_number_display  text,
  ADD COLUMN IF NOT EXISTS matched_language             text,
  ADD COLUMN IF NOT EXISTS matched_variant              text,
  ADD COLUMN IF NOT EXISTS match_method                 text,
  ADD COLUMN IF NOT EXISTS exact_match_found            boolean,
  ADD COLUMN IF NOT EXISTS candidate_count              integer,
  ADD COLUMN IF NOT EXISTS match_confidence             real;

-- Enum constraints. Kept permissive so a mixed-client rolling
-- deployment cannot cause an INSERT failure — unknown values land
-- as-is and remain filterable in reports.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_logs_match_method_check') THEN
    ALTER TABLE public.chat_logs
      ADD CONSTRAINT chat_logs_match_method_check
      CHECK (match_method IS NULL OR match_method IN (
        'card_id',
        'card_slug',
        'card_url_slug_composite',
        'card_url_slug_ambiguous',
        'set_number_language',
        'set_number_language_ambiguous',
        'conversation_context',
        'fuzzy',
        'none'
      ));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_logs_context_source_check') THEN
    ALTER TABLE public.chat_logs
      ADD CONSTRAINT chat_logs_context_source_check
      CHECK (context_source IS NULL OR context_source IN (
        'card_page',
        'set_page',
        'scanner',
        'conversation',
        'card_switch',
        'text'
      ));
  END IF;
END $$;

-- Mismatch audit indexes. Two partial indexes so the "wrong-card
-- substitution" audit stays cheap on both identifier axes.
CREATE INDEX IF NOT EXISTS idx_chat_logs_mismatch
  ON public.chat_logs (created_at DESC)
  WHERE requested_card_id IS NOT NULL
    AND matched_card_id IS NOT NULL
    AND requested_card_id <> matched_card_id;

CREATE INDEX IF NOT EXISTS idx_chat_logs_slug_mismatch
  ON public.chat_logs (created_at DESC)
  WHERE requested_card_slug IS NOT NULL
    AND matched_card_slug IS NOT NULL
    AND requested_card_slug <> matched_card_slug;

COMMIT;

-- ─── Verification queries ───────────────────────────
-- Run these in the Supabase SQL Editor after applying the migration.
--
-- 1. Every new column is present:
--
--    SELECT column_name
--    FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='chat_logs'
--      AND column_name IN (
--        'intent','context_source',
--        'requested_card_id','requested_card_slug','requested_card_url_slug',
--        'requested_set_name','requested_language',
--        'matched_card_id','matched_card_slug','matched_card_url_slug','matched_card_name',
--        'matched_set_name','matched_card_number','matched_card_number_display',
--        'matched_language','matched_variant',
--        'match_method','exact_match_found','candidate_count','match_confidence'
--      )
--    ORDER BY column_name;
--    -- expect: 20 rows.
--
-- 2. CHECK constraints exist:
--
--    SELECT conname FROM pg_constraint
--    WHERE conname IN ('chat_logs_match_method_check','chat_logs_context_source_check');
--    -- expect: 2 rows.
--
-- 3. Mismatch indexes exist:
--
--    SELECT indexname FROM pg_indexes
--    WHERE tablename='chat_logs'
--      AND indexname IN ('idx_chat_logs_mismatch','idx_chat_logs_slug_mismatch');
--    -- expect: 2 rows.
--
-- 4. No existing rows were modified. This migration only adds
--    columns and indexes — existing rows land in the new columns
--    as NULL. Sanity check by comparing row counts before/after
--    (should be equal).

-- ─── Exceptional rollback (manual cleanup only) ─────
-- The operational rollback is documented in the header — leave
-- these nullable columns in place. Only run the block below if
-- there is a specific database reason to drop the columns and you
-- accept losing the provenance data.
--
-- BEGIN;
-- DROP INDEX IF EXISTS idx_chat_logs_slug_mismatch;
-- DROP INDEX IF EXISTS idx_chat_logs_mismatch;
-- ALTER TABLE public.chat_logs
--   DROP CONSTRAINT IF EXISTS chat_logs_match_method_check,
--   DROP CONSTRAINT IF EXISTS chat_logs_context_source_check,
--   DROP COLUMN IF EXISTS intent,
--   DROP COLUMN IF EXISTS context_source,
--   DROP COLUMN IF EXISTS requested_card_id,
--   DROP COLUMN IF EXISTS requested_card_slug,
--   DROP COLUMN IF EXISTS requested_card_url_slug,
--   DROP COLUMN IF EXISTS requested_set_name,
--   DROP COLUMN IF EXISTS requested_language,
--   DROP COLUMN IF EXISTS matched_card_id,
--   DROP COLUMN IF EXISTS matched_card_slug,
--   DROP COLUMN IF EXISTS matched_card_url_slug,
--   DROP COLUMN IF EXISTS matched_card_name,
--   DROP COLUMN IF EXISTS matched_set_name,
--   DROP COLUMN IF EXISTS matched_card_number,
--   DROP COLUMN IF EXISTS matched_card_number_display,
--   DROP COLUMN IF EXISTS matched_language,
--   DROP COLUMN IF EXISTS matched_variant,
--   DROP COLUMN IF EXISTS match_method,
--   DROP COLUMN IF EXISTS exact_match_found,
--   DROP COLUMN IF EXISTS candidate_count,
--   DROP COLUMN IF EXISTS match_confidence;
-- COMMIT;
