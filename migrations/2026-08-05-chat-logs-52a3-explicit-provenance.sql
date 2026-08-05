-- migrations/2026-08-05-chat-logs-52a3-explicit-provenance.sql
--
-- Block 5A-W-52A.3 — additive follow-up to
-- migrations/2026-08-05-chat-logs-structured-context.sql.
--
-- Goals:
--   1. Add explicitly-named provenance columns so a reader cannot
--      confuse a DB primary key (cards.id) with a PriceCharting
--      product identifier (cards.card_slug). The 52A.2 columns
--      requested_card_id / requested_card_slug were short and
--      matched the DB column names but read ambiguously in log
--      audits. The 52A.3 columns spell the identifier type out.
--      A mismatch query must never compare a DB primary key
--      against a PriceCharting product ID or a URL slug — the
--      new columns and mismatch indexes below enforce like-with-
--      like comparisons.
--   2. Extend the context_source CHECK constraint to accept
--      'candidate_selection' — a new turn type introduced when the
--      user picks one card from an ambiguous-match candidate list.
--   3. Extend the match_method CHECK constraint to accept
--      'ambiguous_free_text' — the value written when a free-text
--      search_cards call returned more than one candidate and the
--      edge function short-circuited to the selection response.
--
-- Backward compatibility:
--   * No columns are dropped or renamed. The 52A.2 short-form
--     columns (requested_card_id, requested_card_slug,
--     matched_card_id, matched_card_slug) remain in place and
--     continue to receive the same values via dual-write. Existing
--     analytics queries keep working unchanged.
--   * All new columns are nullable.
--   * The edge function dual-writes to both the short-form and the
--     long-form columns going forward, so a manual analyst can use
--     whichever naming reads clearer.
--
-- Deployment order:
--   1. Apply this migration in the Supabase SQL Editor.
--   2. Deploy the 52A.3 edge function.
--   3. Deploy the 52A.3 web client.

BEGIN;

-- ─── New explicit provenance columns ────────────────
ALTER TABLE public.chat_logs
  ADD COLUMN IF NOT EXISTS requested_card_record_id  text,
  ADD COLUMN IF NOT EXISTS requested_pc_product_id   text,
  ADD COLUMN IF NOT EXISTS matched_card_record_id    text,
  ADD COLUMN IF NOT EXISTS matched_pc_product_id     text;

-- ─── Extend context_source enum with candidate_selection ───
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chat_logs_context_source_check'
  ) THEN
    ALTER TABLE public.chat_logs DROP CONSTRAINT chat_logs_context_source_check;
  END IF;
  ALTER TABLE public.chat_logs
    ADD CONSTRAINT chat_logs_context_source_check
    CHECK (context_source IS NULL OR context_source IN (
      'card_page',
      'set_page',
      'scanner',
      'conversation',
      'card_switch',
      'candidate_selection',
      'text'
    ));
END $$;

-- ─── Extend match_method enum with ambiguous_free_text ─────
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chat_logs_match_method_check'
  ) THEN
    ALTER TABLE public.chat_logs DROP CONSTRAINT chat_logs_match_method_check;
  END IF;
  ALTER TABLE public.chat_logs
    ADD CONSTRAINT chat_logs_match_method_check
    CHECK (match_method IS NULL OR match_method IN (
      'card_id',
      'card_slug',
      'card_url_slug_composite',
      'card_url_slug_ambiguous',
      'set_number_language',
      'set_number_language_ambiguous',
      'ambiguous_free_text',
      'conversation_context',
      'fuzzy',
      'none'
    ));
END $$;

-- ─── Mismatch-audit index on the explicit columns ──────
--
-- The 52A.2 idx_chat_logs_mismatch index remains valid — it still
-- indexes `requested_card_id <> matched_card_id`, both of which
-- always hold the DB primary key. We add companion indexes on the
-- new explicit-name columns so audits written against the newer
-- names run cheaply too.
CREATE INDEX IF NOT EXISTS idx_chat_logs_record_id_mismatch
  ON public.chat_logs (created_at DESC)
  WHERE requested_card_record_id IS NOT NULL
    AND matched_card_record_id   IS NOT NULL
    AND requested_card_record_id <> matched_card_record_id;

CREATE INDEX IF NOT EXISTS idx_chat_logs_pc_product_mismatch
  ON public.chat_logs (created_at DESC)
  WHERE requested_pc_product_id IS NOT NULL
    AND matched_pc_product_id   IS NOT NULL
    AND requested_pc_product_id <> matched_pc_product_id;

COMMIT;

-- ─── Verification queries ───────────────────────────
--
-- 1. The four new columns exist:
--
--    SELECT column_name FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='chat_logs'
--      AND column_name IN (
--        'requested_card_record_id','requested_pc_product_id',
--        'matched_card_record_id','matched_pc_product_id'
--      )
--    ORDER BY column_name;
--    -- expect: 4 rows.
--
-- 2. The extended CHECK constraints exist and contain the new values:
--
--    SELECT conname, pg_get_constraintdef(oid)
--    FROM pg_constraint
--    WHERE conname IN (
--      'chat_logs_context_source_check',
--      'chat_logs_match_method_check'
--    );
--    -- expect 'candidate_selection' in context_source and
--    -- 'ambiguous_free_text' in match_method.
--
-- 3. The new mismatch-audit indexes exist:
--
--    SELECT indexname FROM pg_indexes
--    WHERE tablename='chat_logs'
--      AND indexname IN (
--        'idx_chat_logs_record_id_mismatch',
--        'idx_chat_logs_pc_product_mismatch'
--      );
--    -- expect: 2 rows.

-- ─── Exceptional rollback (manual cleanup only) ─────
--
-- BEGIN;
-- DROP INDEX IF EXISTS idx_chat_logs_pc_product_mismatch;
-- DROP INDEX IF EXISTS idx_chat_logs_record_id_mismatch;
-- ALTER TABLE public.chat_logs
--   DROP CONSTRAINT IF EXISTS chat_logs_match_method_check,
--   DROP CONSTRAINT IF EXISTS chat_logs_context_source_check,
--   DROP COLUMN IF EXISTS requested_card_record_id,
--   DROP COLUMN IF EXISTS requested_pc_product_id,
--   DROP COLUMN IF EXISTS matched_card_record_id,
--   DROP COLUMN IF EXISTS matched_pc_product_id;
-- -- Re-add the 52A.2 CHECK constraints without the new values.
-- COMMIT;
