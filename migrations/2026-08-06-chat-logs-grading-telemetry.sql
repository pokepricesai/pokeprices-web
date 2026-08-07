-- migrations/2026-08-06-chat-logs-grading-telemetry.sql
--
-- Block 5A-W-52B — grading-analysis telemetry columns on
-- chat_logs. Purely additive: four nullable columns record
-- whether a grade_card intent was answered from the deterministic
-- calculator and what verdict it produced.
--
-- Fields:
--   grading_analysis_used       — true when the calculator ran
--                                 (grade_card intent AND an exact
--                                 structured card was loaded AND
--                                 daily_prices had a row).
--   grading_recommendation_code — LIKELY_NEGATIVE / CONDITION_DEPENDENT /
--                                 LIKELY_POSITIVE / INSUFFICIENT_DATA
--   grading_break_even_grade    — the lowest PSA grade whose net
--                                 proceeds cover fees + grading
--                                 costs + raw opportunity cost.
--                                 NULL when no grade breaks even.
--   grading_data_confidence     — high | medium | low, from the
--                                 calculator's dataQuality.confidence.
--
-- Deployment: apply this migration in the Supabase SQL Editor
-- before deploying the 52B edge function. The edge function will
-- fall through to the pre-52B log shape via the existing
-- legacy-shape retry if these columns aren't present yet (see
-- logChat in supabase/functions/smart-endpoint/index.ts).

BEGIN;

ALTER TABLE public.chat_logs
  ADD COLUMN IF NOT EXISTS grading_analysis_used       boolean,
  ADD COLUMN IF NOT EXISTS grading_recommendation_code text,
  ADD COLUMN IF NOT EXISTS grading_break_even_grade    integer,
  ADD COLUMN IF NOT EXISTS grading_data_confidence     text;

-- Enum guard for the recommendation code. Kept permissive so a
-- future block adding a new code doesn't cause an INSERT failure
-- during a rolling deploy.
--
-- 52B.1 adds INSUFFICIENT_COST_DATA — emitted when the chosen
-- grading service is paused or when no available service tier
-- accommodates the card's expected value. Distinct from
-- INSUFFICIENT_DATA (a card-price failure) so audits can tell
-- them apart.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chat_logs_grading_recommendation_code_check'
  ) THEN
    ALTER TABLE public.chat_logs
      ADD CONSTRAINT chat_logs_grading_recommendation_code_check
      CHECK (
        grading_recommendation_code IS NULL
        OR grading_recommendation_code IN (
          'LIKELY_NEGATIVE',
          'CONDITION_DEPENDENT',
          'LIKELY_POSITIVE',
          'INSUFFICIENT_DATA',
          'INSUFFICIENT_COST_DATA'
        )
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chat_logs_grading_data_confidence_check'
  ) THEN
    ALTER TABLE public.chat_logs
      ADD CONSTRAINT chat_logs_grading_data_confidence_check
      CHECK (
        grading_data_confidence IS NULL
        OR grading_data_confidence IN ('high', 'medium', 'low')
      );
  END IF;
END $$;

-- Audit index: how often did the calculator produce
-- LIKELY_NEGATIVE recommendations for grade_card intents? Helps
-- track how many "should I grade this?" questions the
-- deterministic layer is answering against grading, and whether
-- the AI's prose stays consistent with that verdict.
CREATE INDEX IF NOT EXISTS idx_chat_logs_grading_recommendation
  ON public.chat_logs (created_at DESC)
  WHERE grading_recommendation_code IS NOT NULL;

COMMIT;

-- ─── Verification ───────────────────────────────────
--
-- 1. The four columns exist:
--
--    SELECT column_name FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='chat_logs'
--      AND column_name IN (
--        'grading_analysis_used','grading_recommendation_code',
--        'grading_break_even_grade','grading_data_confidence'
--      )
--    ORDER BY column_name;
--    -- expect: 4 rows.
--
-- 2. Both CHECK constraints exist:
--
--    SELECT conname FROM pg_constraint
--    WHERE conname IN (
--      'chat_logs_grading_recommendation_code_check',
--      'chat_logs_grading_data_confidence_check'
--    );
--    -- expect: 2 rows.
--
-- 3. Audit index exists:
--
--    SELECT indexname FROM pg_indexes
--    WHERE tablename='chat_logs' AND indexname='idx_chat_logs_grading_recommendation';
--    -- expect: 1 row.
