-- 2026-09-06-eic-b5-ai-usage.sql
--
-- EIC Block 5 — small telemetry table for admin AI calls (Editorial
-- Strategist, Insights AI-assist, and any future admin AI features).
--
-- Rationale for a new table rather than reusing chat_logs:
--   * chat_logs carries ~35 columns that are card-specific
--     (matched_card_slug, grading_break_even_grade, requested_pc_product_id,
--     …). Editorial AI has none of those.
--   * ai_usage is the minimum useful set — 12 columns, one row per
--     AI call, indexed by (created_at, feature).
--   * RLS enabled with zero policies. All access through the same
--     service-role client the admin routes already use.
--
-- Cost fields are stored as numeric(12,6) so 0.001234 USD survives
-- a round-trip without rounding surprises.

BEGIN;

CREATE TABLE IF NOT EXISTS public.ai_usage (
  id                     bigserial PRIMARY KEY,
  created_at             timestamptz  NOT NULL DEFAULT now(),
  feature                text         NOT NULL,
  model                  text         NOT NULL,
  admin_email            text,
  session_id             text,
  input_tokens           integer      NOT NULL DEFAULT 0,
  output_tokens          integer      NOT NULL DEFAULT 0,
  cache_creation_tokens  integer      NOT NULL DEFAULT 0,
  cache_read_tokens      integer      NOT NULL DEFAULT 0,
  cost_usd               numeric(12, 6) NOT NULL DEFAULT 0,
  latency_ms             integer,
  error                  text
);

CREATE INDEX IF NOT EXISTS ai_usage_created_at_idx
  ON public.ai_usage (created_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_feature_idx
  ON public.ai_usage (feature);

ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;
-- No policies. Service role only. Same posture as insights,
-- editorial_projects and release_calendar.

COMMIT;
