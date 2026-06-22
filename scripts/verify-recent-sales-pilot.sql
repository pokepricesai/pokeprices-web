-- ============================================================================
-- Block 4B-W-2A — Read-only verification for the pilot allow-list seed.
-- ============================================================================
--
-- Operator runs this AFTER applying migrations/2026-06-17-recent-sales-pilot-100.sql.
-- All queries are read-only.
--
-- Expected after a successful seed (real-id manifest):
--   * total_enabled_pilot_rows     = 58   (technical pilot target)
--   * invalid_mappings             = 0
--   * duplicate_ids                = 0
--   * low_confidence_rows          = 0
--   * recent_sales_rows            = 0   (Stage-1 invariant)
--   * market_import_runs_rows      = 0   (Stage-1 invariant)
-- ============================================================================

-- (1) Enabled pilot count.
SELECT 'enabled_pilot_count' AS check_name,
       COUNT(*)              AS value
FROM   public.recent_sales_card_allow_list
WHERE  provider = 'pricecharting'
  AND  enabled  = TRUE
  AND  reason  LIKE 'pilot:%';

-- (2) Count by primary pilot category (reason prefix).
SELECT 'count_by_category'                                                AS check_name,
       split_part(replace(reason,'pilot:',''),' - ',1)::text              AS category,
       COUNT(*)                                                           AS value
FROM   public.recent_sales_card_allow_list
WHERE  provider = 'pricecharting'
  AND  enabled  = TRUE
  AND  reason  LIKE 'pilot:%'
GROUP BY 2
ORDER BY 2;

-- (3) Rows with a valid active provider link.
SELECT 'pilot_rows_with_valid_link' AS check_name, COUNT(*) AS value
FROM   public.recent_sales_card_allow_list a
JOIN   public.provider_card_links l
       ON  l.provider         = a.provider
       AND l.provider_card_id = a.provider_card_id
       AND l.is_active        = TRUE
       AND l.card_slug IS NOT NULL
WHERE  a.provider = 'pricecharting'
  AND  a.enabled  = TRUE
  AND  a.reason  LIKE 'pilot:%';

-- (4) Rows with link confidence below 0.900 (must be zero).
SELECT 'low_confidence_rows' AS check_name, COUNT(*) AS value
FROM   public.recent_sales_card_allow_list a
JOIN   public.provider_card_links l
       ON  l.provider         = a.provider
       AND l.provider_card_id = a.provider_card_id
       AND l.is_active        = TRUE
WHERE  a.provider = 'pricecharting'
  AND  a.enabled  = TRUE
  AND  a.reason  LIKE 'pilot:%'
  AND  l.confidence < 0.900;

-- (5) Duplicate provider_card_id within the pilot (must be zero).
SELECT 'duplicate_ids' AS check_name, COUNT(*) AS value
FROM   (
  SELECT provider_card_id
  FROM   public.recent_sales_card_allow_list
  WHERE  provider = 'pricecharting'
    AND  enabled  = TRUE
    AND  reason  LIKE 'pilot:%'
  GROUP BY provider_card_id
  HAVING COUNT(*) > 1
) d;

-- (6) Rows with no active provider link (must be zero).
SELECT 'invalid_mappings' AS check_name, COUNT(*) AS value
FROM   public.recent_sales_card_allow_list a
LEFT JOIN public.provider_card_links l
       ON  l.provider         = a.provider
       AND l.provider_card_id = a.provider_card_id
       AND l.is_active        = TRUE
WHERE  a.provider = 'pricecharting'
  AND  a.enabled  = TRUE
  AND  a.reason  LIKE 'pilot:%'
  AND  (l.provider_card_id IS NULL OR l.card_slug IS NULL);

-- (7) Sealed product count in the pilot.
SELECT 'sealed_pilot_rows' AS check_name, COUNT(*) AS value
FROM   public.recent_sales_card_allow_list a
JOIN   public.provider_card_links l
       ON  l.provider         = a.provider
       AND l.provider_card_id = a.provider_card_id
       AND l.is_active        = TRUE
JOIN   public.cards c
       ON  c.card_slug = l.card_slug
WHERE  a.provider = 'pricecharting'
  AND  a.enabled  = TRUE
  AND  a.reason  LIKE 'pilot:%'
  AND  COALESCE(c.is_sealed, FALSE) = TRUE;

-- (8) Sparse/low-volume pilot rows by reason tag.
SELECT 'sparse_pilot_rows' AS check_name, COUNT(*) AS value
FROM   public.recent_sales_card_allow_list
WHERE  provider = 'pricecharting'
  AND  enabled  = TRUE
  AND  reason  LIKE 'pilot:sparse%';

-- (9) Modern vs vintage breakdown via reason tag.
SELECT 'modern_pilot_rows' AS check_name, COUNT(*) AS value
FROM   public.recent_sales_card_allow_list
WHERE  provider = 'pricecharting'
  AND  enabled  = TRUE
  AND  reason  LIKE 'pilot:modern_or_recent%';

SELECT 'vintage_pilot_rows' AS check_name, COUNT(*) AS value
FROM   public.recent_sales_card_allow_list
WHERE  provider = 'pricecharting'
  AND  enabled  = TRUE
  AND  reason  LIKE 'pilot:vintage_or_wotc%';

SELECT 'psa_pilot_rows' AS check_name, COUNT(*) AS value
FROM   public.recent_sales_card_allow_list
WHERE  provider = 'pricecharting'
  AND  enabled  = TRUE
  AND  reason  LIKE 'pilot:psa_or_grade_spread%';

SELECT 'general_quality_pilot_rows' AS check_name, COUNT(*) AS value
FROM   public.recent_sales_card_allow_list
WHERE  provider = 'pricecharting'
  AND  enabled  = TRUE
  AND  reason  LIKE 'pilot:general_quality%';

-- (10) Price distribution bands (latest raw_usd, cents -> $).
WITH pilot_cards AS (
  SELECT l.card_slug
  FROM   public.recent_sales_card_allow_list a
  JOIN   public.provider_card_links l
         ON  l.provider         = a.provider
         AND l.provider_card_id = a.provider_card_id
         AND l.is_active        = TRUE
  WHERE  a.provider = 'pricecharting'
    AND  a.enabled  = TRUE
    AND  a.reason  LIKE 'pilot:%'
),
latest AS (
  SELECT pc.card_slug,
         (SELECT dp.raw_usd FROM public.daily_prices dp
          WHERE dp.card_slug = 'pc-' || pc.card_slug
          ORDER BY dp.date DESC LIMIT 1) AS raw_cents
  FROM pilot_cards pc
)
SELECT
  CASE
    WHEN raw_cents IS NULL                       THEN 'a_unknown'
    WHEN raw_cents <       500                   THEN 'b_under_$5'
    WHEN raw_cents <      2000                   THEN 'c_$5_to_$20'
    WHEN raw_cents <     10000                   THEN 'd_$20_to_$100'
    WHEN raw_cents <     50000                   THEN 'e_$100_to_$500'
    WHEN raw_cents <    250000                   THEN 'f_$500_to_$2.5k'
    WHEN raw_cents <   1000000                   THEN 'g_$2.5k_to_$10k'
    ELSE                                              'h_over_$10k'
  END                       AS price_band,
  COUNT(*)                  AS value,
  'price_band_distribution' AS check_name
FROM   latest
GROUP BY 1
ORDER BY 1;

-- (11) Stage-1 invariants — must remain zero.
SELECT 'recent_sales_rows'       AS check_name, COUNT(*) AS value FROM public.recent_sales;
SELECT 'market_import_runs_rows' AS check_name, COUNT(*) AS value FROM public.market_import_runs;
