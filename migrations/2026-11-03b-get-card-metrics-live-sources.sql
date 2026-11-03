-- 2026-11-03b-get-card-metrics-live-sources.sql
--
-- Correctness fix for public.get_card_metrics(card_slug text).
-- Replaces the dependency on the stale metrics_daily rollup
-- (last as_of = 2026-04-06, 211 days stale on this file's date)
-- with on-demand composition from CURRENT tables:
--
--   card_latest_prices  — trigger-maintained snapshot of today's price
--                         (price_date=2026-11-02 across the sample).
--   daily_prices        — the authoritative raw-price time series
--                         (updated nightly by scraper_nightly).
--   card_trends         — per-card trend % windows (as_of=2026-11-02).
--   card_volume         — per-grade sales volume (as_of=2026-11-02).
--
-- Rollback: docs/rollbacks/2026-11-03b-get-card-metrics-live-sources/rollback.sql
--           (byte-equivalent to current production = 2026-11-02b OR-strip fix).
--
-- SHAPE CHANGE — ONE RAW ROW
-- ─────────────────────────────────────────────────────────────────
-- Returns exactly ONE row per card (grade='raw'), compared to v3's
-- six rows (one per metrics_daily grade). Justification:
--
--   * Only consumer:  src/app/api/card/[cardSlug]/extras/route.ts:183
--   * Only read path: CardPageClient.tsx:589 → metrics?.results?.[0]
--   * Only fields read: results[0].drawdown_pct, results[0].sales_30d
--     (plus results[0].volume_30d fallback alias that does not exist
--     in schema anyway)
--
-- card_trends only emits per-grade trend windows for raw / psa9 / psa10.
-- The old function emitted six grade rows, 22 of 24 fields were never
-- consumed, and results[0] was accidentally cgc95 by lexicographic
-- sort order (semantic bug). ONE raw-grade row preserves the JSON
-- envelope and field names exactly, removes the mis-grade bug, and
-- lets the frontend consume `raw.drawdown_pct` / `raw.sales_30d` as
-- its variable name has always implied.
--
-- No external callers were found (grep across pokeprices-web, collector-
-- network, mtgprices-web): no edge function, no cron, no sibling site.
--
-- SEMANTICS
-- ─────────────────────────────────────────────────────────────────
--   current_price   := card_latest_prices.raw_usd    (USD cents, int)
--   ath_price       := MAX(daily_prices.raw_usd)
--                      WHERE card_slug='pc-'||slug AND raw_usd > 0
--   ath_date        := MIN(date) of the row where raw_usd = ath_price
--   drawdown_pct    := NULL  if obs_count < 90  (thin history guard)
--                      NULL  if current OR ath IS NULL OR ath = 0
--                      0     if current >= ath (card at or above our
--                            available-history peak; "unknown drawdown")
--                      GREATEST(-100, (current-ath)*100/ath)  otherwise
--   data_points_total := COUNT(daily_prices rows with raw_usd > 0)
--   sales_30d       := card_volume.sales_30d  WHERE grade='Ungraded'
--   pct_30d/90d/180d/365d := card_trends.raw_pct_*  (raw grade)
--   bottom_price/date, recovery_pct, high_12m, is_new_12m_high,
--     slope_*, volatility_*, confidence := NULL
--
-- UNIT ALIGNMENT (verified live 2026-11-03):
--   cards view, card_latest_prices, daily_prices and card_trends all
--   agree for 715593: raw_usd=647244 cents = $6,472.44. Integer USD
--   cents throughout.
--
-- ATH DEFINITION
--   "Highest valid observed price within available daily_prices
--   coverage". NOT the card's lifetime market ATH — if ingestion
--   started after a card's true market peak (common for older cards)
--   we only see what we have. The 90-observation threshold on
--   drawdown_pct suppresses this exposure for thin-history cards;
--   deeper lifetime-ATH work requires a separate backfill project.
--
-- SCRAPER-SPIKE AND DIV-BY-ZERO GUARDS
--   * ATH source filter raw_usd > 0: drops NULL and zero rows from
--     the aggregate.
--   * clp.raw_usd <= 0 guard on drawdown_pct: a zero or negative
--     current price would otherwise compute drawdown = -100, which
--     the frontend's `card.raw_usd / (1 + drawdown/100)` ATH
--     calculation would turn into a division by zero. Guard forces
--     NULL so the frontend treats the metric as unknown and
--     suppresses the ATH display cleanly. Verified live
--     2026-11-03: 0 of 63,413 card_latest_prices rows currently
--     have raw_usd <= 0, so this is a defensive-only addition.
--   * obs_count >= 90 gate on drawdown_pct: a single-day spike on a
--     low-history card cannot produce a surprising drawdown figure.
--   * current >= ath clamp: when today's row happens to equal or
--     exceed any prior observation, drawdown is 0 (not a positive
--     "above-ATH" claim), consistent with the user-facing meaning
--     of drawdown.
--   * GREATEST(-100, …) clamp: a theoretical arithmetic negative
--     overshoot cannot emit sub-(-100)% to the frontend.
--
-- FRONTEND SIGN CONVENTION (verified in CardPageClient.tsx):
--   Line 178 `if (drawdown < -30)` emits "At X% below ATH" copy →
--   drawdown is a NEGATIVE number when below ATH, matching our output.
--   Line 180 `if (drawdown > -5)` emits "near ATH" copy.
--   Line 747 `athUsd = card.raw_usd / (1 + drawdown/100)` recovers
--   the ATH in dollars via the sign we provide.
--
-- INDEXES — no new indexes required. All lookups filter on card_slug
-- (indexed on daily_prices + card_latest_prices + card_trends +
-- card_volume + cards).
--
-- MEASURED TIMINGS (10-card probe, service_role, Node network RTT
-- included; actual in-DB RPC will be lower):
--   popular (715593, 316 observations): shape-fetch 60-266ms;
--     production RPC comparison 39-75ms. v4 target: ≤ current.

CREATE OR REPLACE FUNCTION public.get_card_metrics(card_slug text)
RETURNS json
LANGUAGE plpgsql
AS $function$
DECLARE
    v_result       JSON;
    v_clean_slug   TEXT;
    v_pc_slug      TEXT;
BEGIN
    -- Variables use v_ prefix to avoid any plpgsql.variable_conflict
    -- ambiguity with column names: `cards` has a `pc_slug` column, and
    -- `daily_prices` / `card_latest_prices` / `card_volume` / `cards`
    -- all have a `card_slug` column that would otherwise collide with
    -- an unprefixed plpgsql variable. All SQL references below use
    -- table aliases for columns and v_ prefixes for variables so there
    -- is no identifier that could resolve to both.
    v_clean_slug := CASE
        WHEN card_slug LIKE 'pc-%' THEN substring(card_slug FROM 4)
        ELSE card_slug
    END;
    v_pc_slug := 'pc-' || v_clean_slug;

    WITH ath_agg AS (
        SELECT MAX(dp.raw_usd) AS ath_raw_usd,
               COUNT(*)        AS obs_count
          FROM daily_prices dp
         WHERE dp.card_slug = v_pc_slug
           AND dp.raw_usd > 0
    ),
    ath_block AS (
        SELECT a.ath_raw_usd,
               a.obs_count,
               (SELECT MIN(dp2.date) FROM daily_prices dp2
                 WHERE dp2.card_slug = v_pc_slug
                   AND a.ath_raw_usd IS NOT NULL
                   AND dp2.raw_usd = a.ath_raw_usd) AS ath_date
          FROM ath_agg a
    )
    SELECT json_build_object('results',
        COALESCE(
            (SELECT json_agg(row_to_json(t)) FROM (
                SELECT
                    c.card_name,
                    c.set_name,
                    'raw'::text                                  AS grade,
                    clp.raw_usd                                  AS current_price,
                    ath.ath_raw_usd                              AS ath_price,
                    ath.ath_date                                 AS ath_date,
                    CASE
                        WHEN ath.obs_count < 90                  THEN NULL
                        WHEN clp.raw_usd IS NULL                 THEN NULL
                        WHEN clp.raw_usd <= 0                    THEN NULL  -- guard: avoid frontend ATH div-by-zero when drawdown = -100
                        WHEN ath.ath_raw_usd IS NULL
                             OR ath.ath_raw_usd = 0              THEN NULL
                        WHEN clp.raw_usd >= ath.ath_raw_usd      THEN 0::numeric
                        ELSE GREATEST(
                             -100::numeric,
                             ((clp.raw_usd::numeric - ath.ath_raw_usd)
                                * 100.0 / ath.ath_raw_usd))
                    END                                          AS drawdown_pct,
                    NULL::integer                                AS bottom_price,
                    NULL::date                                   AS bottom_date,
                    NULL::numeric                                AS recovery_pct,
                    NULL::integer                                AS high_12m,
                    NULL::boolean                                AS is_new_12m_high,
                    NULL::numeric                                AS slope_30d,
                    NULL::numeric                                AS slope_90d,
                    NULL::numeric                                AS slope_365d,
                    NULL::numeric                                AS volatility_30d,
                    NULL::numeric                                AS volatility_90d,
                    tr.raw_pct_30d                               AS pct_30d,
                    tr.raw_pct_90d                               AS pct_90d,
                    tr.raw_pct_180d                              AS pct_180d,
                    tr.raw_pct_365d                              AS pct_365d,
                    cv.sales_30d                                 AS sales_30d,
                    ath.obs_count::integer                       AS data_points_total,
                    NULL::text                                   AS confidence
                FROM cards c
                CROSS JOIN ath_block ath
                LEFT JOIN card_latest_prices clp ON clp.card_slug = v_pc_slug
                LEFT JOIN card_trends       tr  ON tr.card_slug  = v_clean_slug
                LEFT JOIN card_volume       cv  ON cv.card_slug  = c.card_slug
                                               AND cv.grade      = 'Ungraded'
                WHERE c.card_slug = v_clean_slug
                LIMIT 1
            ) t),
            '[]'::json
        )
    ) INTO v_result;

    RETURN COALESCE(v_result, json_build_object('results', '[]'::json));
END;
$function$;

-- GRANTS AND OWNERSHIP
-- ─────────────────────────────────────────────────────────────────
-- CREATE OR REPLACE FUNCTION preserves owner and EXECUTE grants.
-- Signature (text) → json is unchanged. No GRANT statements added.
