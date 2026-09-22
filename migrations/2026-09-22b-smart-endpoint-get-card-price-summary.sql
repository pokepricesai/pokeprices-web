-- migrations/2026-09-22b-smart-endpoint-get-card-price-summary.sql
--
-- Stage 1 of the smart-endpoint audit (2026-09-22). Adds a compact
-- per-card price summary RPC so the AI assistant can answer historic /
-- trend questions ("has this gone up in the last 90 days?", "what
-- was it worth a year ago?", "is this near its high?") from real data
-- instead of inferring from the pre-computed card_trends deltas or
-- hallucinating from model memory.
--
-- Callers: supabase/functions/smart-endpoint/index.ts (new tool
--          `get_price_history_summary`).
--
-- Return shape (single row):
--   * latest_date        — most recent daily_prices row in the window
--   * first_date         — earliest daily_prices row in the window
--   * observation_count  — number of observations in the window (day rows)
--   * latest_raw_usd     — most-recent raw price in USD cents
--   * latest_psa9_usd    — most-recent PSA 9 price in USD cents
--   * latest_psa10_usd   — most-recent PSA 10 price in USD cents
--   * raw_high_usd       — window max raw price (nulls / zeros ignored)
--   * raw_low_usd        — window min raw price (nulls / zeros ignored)
--   * raw_pct_change     — % change from first-in-window to latest, raw
--   * psa10_high_usd     — window max PSA 10 price
--   * psa10_low_usd      — window min PSA 10 price
--   * psa10_pct_change   — % change from first-in-window to latest, PSA10
--
-- The RPC returns NO row when the card has zero observations in the
-- window. Callers should treat empty as "unknown / say so plainly" and
-- MUST NOT invent a price.
--
-- Slug argument convention matches get_card_price_history: pass the
-- BARE card_slug (e.g. "959616") — the function prepends 'pc-'
-- internally.
--
-- Reversible: pure additive.

DROP FUNCTION IF EXISTS public.get_card_price_summary_for_ai(text, integer);

CREATE OR REPLACE FUNCTION public.get_card_price_summary_for_ai(
  pc_slug        text,
  period_days    integer DEFAULT 90
)
RETURNS TABLE (
  card_slug            text,
  period_days          integer,
  latest_date          date,
  first_date           date,
  observation_count    integer,
  latest_raw_usd       integer,
  latest_psa9_usd      integer,
  latest_psa10_usd     integer,
  raw_high_usd         integer,
  raw_low_usd          integer,
  raw_pct_change       numeric,
  psa10_high_usd       integer,
  psa10_low_usd        integer,
  psa10_pct_change     numeric
)
LANGUAGE sql STABLE
AS $$
  WITH bounds AS (
    SELECT
      -- Clamp to a sensible range to keep the sequential scan bounded.
      GREATEST(1, LEAST(COALESCE(period_days, 90), 730))::integer AS days
  ),
  win AS (
    SELECT
      dp.date, dp.raw_usd, dp.psa9_usd, dp.psa10_usd
    FROM daily_prices dp, bounds b
    WHERE dp.card_slug = 'pc-' || pc_slug
      AND dp.date >= CURRENT_DATE - (b.days || ' days')::interval
  ),
  agg AS (
    SELECT
      COUNT(*)::integer                                         AS obs,
      MIN(date)                                                 AS first_date,
      MAX(date)                                                 AS last_date,
      MAX(raw_usd)   FILTER (WHERE raw_usd   IS NOT NULL AND raw_usd   > 0) AS raw_high,
      MIN(raw_usd)   FILTER (WHERE raw_usd   IS NOT NULL AND raw_usd   > 0) AS raw_low,
      MAX(psa10_usd) FILTER (WHERE psa10_usd IS NOT NULL AND psa10_usd > 0) AS psa10_high,
      MIN(psa10_usd) FILTER (WHERE psa10_usd IS NOT NULL AND psa10_usd > 0) AS psa10_low
    FROM win
  ),
  first_row AS (
    SELECT raw_usd AS raw_first, psa10_usd AS psa10_first
    FROM win
    WHERE date = (SELECT first_date FROM agg)
    LIMIT 1
  ),
  last_row AS (
    SELECT raw_usd AS raw_last, psa9_usd AS psa9_last, psa10_usd AS psa10_last
    FROM win
    WHERE date = (SELECT last_date FROM agg)
    LIMIT 1
  )
  SELECT
    pc_slug                                                            AS card_slug,
    (SELECT days FROM bounds)                                          AS period_days,
    agg.last_date                                                      AS latest_date,
    agg.first_date                                                     AS first_date,
    agg.obs                                                            AS observation_count,
    last_row.raw_last                                                  AS latest_raw_usd,
    last_row.psa9_last                                                 AS latest_psa9_usd,
    last_row.psa10_last                                                AS latest_psa10_usd,
    agg.raw_high                                                       AS raw_high_usd,
    agg.raw_low                                                        AS raw_low_usd,
    CASE
      WHEN first_row.raw_first IS NULL OR first_row.raw_first = 0 THEN NULL
      WHEN last_row.raw_last   IS NULL                            THEN NULL
      ELSE ROUND(
        ((last_row.raw_last::numeric - first_row.raw_first) / first_row.raw_first) * 100,
        1
      )
    END                                                                AS raw_pct_change,
    agg.psa10_high                                                     AS psa10_high_usd,
    agg.psa10_low                                                      AS psa10_low_usd,
    CASE
      WHEN first_row.psa10_first IS NULL OR first_row.psa10_first = 0 THEN NULL
      WHEN last_row.psa10_last   IS NULL                              THEN NULL
      ELSE ROUND(
        ((last_row.psa10_last::numeric - first_row.psa10_first) / first_row.psa10_first) * 100,
        1
      )
    END                                                                AS psa10_pct_change
  FROM agg
  LEFT JOIN first_row ON true
  LEFT JOIN last_row  ON true
  WHERE agg.obs > 0;
$$;

GRANT EXECUTE ON FUNCTION public.get_card_price_summary_for_ai(text, integer)
  TO authenticated, anon, service_role;

COMMENT ON FUNCTION public.get_card_price_summary_for_ai(text, integer) IS
  'AI assistant helper: single-row price summary for a card over the last N days (default 90, capped 730). Returns latest/high/low/change/observation_count for raw + PSA10. Zero rows when there is no data in the window. Complements card_trends (which stores pre-computed 7d/30d/90d/365d deltas) with an on-demand summary keyed to the caller-chosen period.';
