-- pre-apply-preview.sql — one simple read-only comparison query.
--
-- Pastes into Supabase Studio SQL Editor. No DDL, no transaction
-- block, no temporary function. One SELECT, five rows, three JSON
-- columns per row (input, old, new).
--
-- Validates the v4 inner body produces the expected shape before
-- the operator approves the CREATE OR REPLACE on production.

WITH inputs(label, input) AS (
    VALUES
        ('popular-busy',    '715593'),
        ('pc-prefix',       'pc-715593'),
        ('no-metrics',      '14451085'),
        ('kebab (defect)',  'charizard-1st-edition-4'),
        ('nonexistent',     'this-card-does-not-exist-12345')
),
exploded AS (
    SELECT i.label, i.input,
           CASE WHEN i.input LIKE 'pc-%' THEN substring(i.input FROM 4) ELSE i.input END AS clean_slug,
           'pc-' || (CASE WHEN i.input LIKE 'pc-%' THEN substring(i.input FROM 4) ELSE i.input END) AS pc_slug
      FROM inputs i
),
ath_per_input AS (
    SELECT e.label,
           (SELECT MAX(raw_usd) FROM daily_prices WHERE card_slug = e.pc_slug AND raw_usd > 0) AS ath_raw_usd,
           (SELECT COUNT(*)     FROM daily_prices WHERE card_slug = e.pc_slug AND raw_usd > 0) AS obs_count
      FROM exploded e
),
new_body AS (
    SELECT
        e.label,
        e.input,
        json_build_object('results',
            COALESCE(
                (SELECT json_agg(row_to_json(t)) FROM (
                    SELECT
                        c.card_name,
                        c.set_name,
                        'raw'::text                              AS grade,
                        clp.raw_usd                              AS current_price,
                        ap.ath_raw_usd                           AS ath_price,
                        (SELECT MIN(date) FROM daily_prices
                          WHERE card_slug = e.pc_slug
                            AND ap.ath_raw_usd IS NOT NULL
                            AND raw_usd = ap.ath_raw_usd)        AS ath_date,
                        CASE
                            WHEN ap.obs_count < 90               THEN NULL
                            WHEN clp.raw_usd IS NULL             THEN NULL
                            WHEN clp.raw_usd <= 0                THEN NULL  -- guard: avoid frontend ATH div-by-zero when drawdown = -100
                            WHEN ap.ath_raw_usd IS NULL
                                 OR ap.ath_raw_usd = 0           THEN NULL
                            WHEN clp.raw_usd >= ap.ath_raw_usd   THEN 0::numeric
                            ELSE GREATEST(
                                 -100::numeric,
                                 ((clp.raw_usd::numeric - ap.ath_raw_usd)
                                    * 100.0 / ap.ath_raw_usd))
                        END                                       AS drawdown_pct,
                        NULL::integer                             AS bottom_price,
                        NULL::date                                AS bottom_date,
                        NULL::numeric                             AS recovery_pct,
                        NULL::integer                             AS high_12m,
                        NULL::boolean                             AS is_new_12m_high,
                        NULL::numeric                             AS slope_30d,
                        NULL::numeric                             AS slope_90d,
                        NULL::numeric                             AS slope_365d,
                        NULL::numeric                             AS volatility_30d,
                        NULL::numeric                             AS volatility_90d,
                        tr.raw_pct_30d                            AS pct_30d,
                        tr.raw_pct_90d                            AS pct_90d,
                        tr.raw_pct_180d                           AS pct_180d,
                        tr.raw_pct_365d                           AS pct_365d,
                        cv.sales_30d                              AS sales_30d,
                        ap.obs_count::integer                     AS data_points_total,
                        NULL::text                                AS confidence
                    FROM cards c
                    LEFT JOIN card_latest_prices clp ON clp.card_slug = e.pc_slug
                    LEFT JOIN card_trends       tr  ON tr.card_slug  = e.clean_slug
                    LEFT JOIN card_volume       cv  ON cv.card_slug  = c.card_slug
                                                   AND cv.grade      = 'Ungraded'
                    WHERE c.card_slug = e.clean_slug
                    LIMIT 1
                ) t),
                '[]'::json
            )
        ) AS new_proposed
    FROM exploded e
    JOIN ath_per_input ap USING (label)
)
SELECT
    n.label,
    n.input,
    public.get_card_metrics(n.input) AS old_production,
    n.new_proposed
FROM new_body n
ORDER BY n.label;

-- OPERATOR EYEBALL CHECKLIST
--
-- popular-busy (715593):
--   old_production: 10 rows, all grade='cgc95', same current_price=8607700,
--                   varying sales_30d (cartesian noise), drawdown_pct=0 (STALE
--                   April 2026 metrics_daily snapshot).
--   new_proposed:   1 row, grade='raw', current_price=647244 ($6,472.44),
--                   ath_price=1270600 ($12,706.00) at ath_date=2026-10-15 ish,
--                   drawdown_pct ≈ -49, sales_30d=4 (Ungraded card_volume),
--                   pct_30d ≈ -19, pct_365d ≈ +47, data_points_total ≈ 316.
--
-- pc-prefix (pc-715593): byte-equivalent to popular-busy after clean_slug strip.
--
-- no-metrics (14451085):
--   old_production: {"results": []}  (no metrics_daily rows).
--   new_proposed:   1 row, grade='raw', current_price = card_latest_prices
--                   raw_usd, drawdown_pct=NULL (thin history, obs_count<90),
--                   sales_30d=30 (Ungraded card_volume present).
--                   This is NEW DATA for a card where the UI previously
--                   had nothing — safe since the UI null-handles.
--
-- kebab (charizard-1st-edition-4):
--   old_production: {"results": []}
--   new_proposed:   {"results": []}   (cards.card_slug is numeric; no match).
--
-- nonexistent:
--   old_production: {"results": []}
--   new_proposed:   {"results": []}
