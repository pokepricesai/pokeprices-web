-- ============================================================================
-- Block 4B-W-2A — Recent-Sales Pilot Cohort Selection (read-only)
-- v3 (2026-06-22): independent candidate pools + minimum coverage
--                  + quality-ranked top-up + hard caps.
--
-- TECHNICAL PILOT TARGET (2026-06-22):
--   The accepted pilot is the 58-row cohort returned by the most recent run
--   of this script. The committed manifest at
--   data/recent-sales-pilot-100.json is sized to 58 rows. We are NOT trying
--   to force 100 rows; the LIMIT 100 below is the cap, not the floor.
--
--   The selector intentionally over-fetches and ranks generously so that
--   re-running on a future, larger production population can backfill to
--   100 if and when we expand the pilot. For now: take what the selector
--   returns (currently 58), update the manifest, regenerate the migration.
-- ============================================================================
--
-- v2 returned 90 rows with 0 modern (priority cascade swallowed modern cards
-- into difficult_variants / sparse / psa_heavy before they ever reached the
-- modern pool). v3 builds INDEPENDENT pools so each category picks its best
-- candidates without competing with earlier categories' first-match.
--
-- HOW V3 WORKS:
--   1. One enriched base CTE with quality flags + a global quality_score.
--   2. Seven independent pools (sealed / sparse / difficult / vintage / psa /
--      modern / general). A card may qualify for several pools simultaneously.
--   3. Sequential pick with anti-join: each pool re-ranks after excluding
--      cards already taken by earlier pools.
--   4. Minimum coverage targets: 10 sealed, 10 sparse, 10 difficult, 10
--      vintage, 10 psa, 15 modern (= 65 floor). Remaining 35 from general
--      ordered by quality_score DESC.
--   5. Hard caps applied via window functions across the combined cohort.
--      Cards that bust a cap are dropped; the deficit is back-filled from
--      the remaining general pool.
--   6. Final hard LIMIT 100.
--
-- IMPORTANT (Supabase Editor quirk):
--   * Supabase only displays the result of the LAST statement in the script.
--   * The MAIN SELECT (the 100 rows) is therefore the only ACTIVE statement.
--   * The debug-summary query is included BELOW it but commented out by
--     default. To inspect debug metrics, uncomment that block and run.
--
-- SAFETY:
--   * Read-only. No INSERT / UPDATE / DELETE / TRUNCATE / ALTER / DROP.
--   * No PII columns are returned. portfolio_count / watchlist_count are
--     aggregate-only.
-- ============================================================================

WITH
-- ----------------------------------------------------------------------------
-- (1) Eligibility: every candidate has a valid bridge row.
-- ----------------------------------------------------------------------------
eligible_links AS (
  SELECT
    l.provider_card_id,
    l.card_slug          AS bare_card_slug,
    'pc-' || l.card_slug AS price_card_slug,
    l.confidence
  FROM public.provider_card_links l
  WHERE l.provider          = 'pricecharting'
    AND l.language          = 'en'
    AND l.is_active         = TRUE
    AND l.confidence       >= 0.900
    AND l.card_slug IS NOT NULL
    AND l.provider_card_id ~ '^[0-9]+$'   -- strict numeric PriceCharting ids
),
-- ----------------------------------------------------------------------------
-- (2) Join to cards (uses the real production column: cards.set_release_date).
-- ----------------------------------------------------------------------------
eligible_cards AS (
  SELECT
    el.provider_card_id,
    el.bare_card_slug,
    el.price_card_slug,
    el.confidence,
    c.card_name,
    c.set_name,
    c.card_number,
    COALESCE(c.is_sealed, FALSE) AS is_sealed,
    c.set_release_date
  FROM eligible_links el
  JOIN public.cards c ON c.card_slug = el.bare_card_slug
),
-- ----------------------------------------------------------------------------
-- (3) Latest price snapshot per card (cents).
-- ----------------------------------------------------------------------------
latest_prices AS (
  SELECT
    ec.provider_card_id,
    ec.bare_card_slug,
    p.raw_usd   AS raw_price_cents,
    p.psa9_usd  AS psa9_price_cents,
    p.psa10_usd AS psa10_price_cents
  FROM eligible_cards ec
  LEFT JOIN LATERAL (
    SELECT dp.raw_usd, dp.psa9_usd, dp.psa10_usd
    FROM public.daily_prices dp
    WHERE dp.card_slug = ec.price_card_slug
    ORDER BY dp.date DESC
    LIMIT 1
  ) p ON TRUE
),
-- ----------------------------------------------------------------------------
-- (4) Volume signal (sales_30d summed across grades).
-- ----------------------------------------------------------------------------
volume AS (
  SELECT
    v.card_slug                       AS price_card_slug,
    SUM(COALESCE(v.sales_30d, 0))::int AS sales_30d_total
  FROM public.card_volume v
  GROUP BY v.card_slug
),
-- ----------------------------------------------------------------------------
-- (5) Aggregate portfolio + watchlist (counts only).
-- ----------------------------------------------------------------------------
portfolio_agg AS (
  SELECT pi.card_slug AS bare_card_slug,
         COUNT(DISTINCT pi.user_id)::int AS portfolio_count
  FROM public.portfolio_items pi
  GROUP BY pi.card_slug
),
watchlist_agg AS (
  SELECT w.card_slug AS bare_card_slug,
         COUNT(DISTINCT w.user_id)::int AS watchlist_count
  FROM public.watchlist w
  GROUP BY w.card_slug
),
-- ----------------------------------------------------------------------------
-- (6) Enriched base — one row per eligible card with derived flags + score.
-- ----------------------------------------------------------------------------
enriched AS (
  SELECT
    ec.provider_card_id,
    ec.bare_card_slug,
    ec.card_name,
    ec.set_name,
    ec.card_number,
    ec.is_sealed,
    ec.set_release_date,
    ec.confidence,
    lp.raw_price_cents,
    lp.psa9_price_cents,
    lp.psa10_price_cents,
    COALESCE(v.sales_30d_total, 0)  AS sales_30d,
    COALESCE(pa.portfolio_count, 0) AS portfolio_count,
    COALESCE(wa.watchlist_count, 0) AS watchlist_count,
    -- Anti-dominance flags.
    (ec.card_name ILIKE '%charizard%')::int AS is_charizard,
    (ec.card_name ILIKE '%pikachu%')::int   AS is_pikachu,
    -- Energy / accessory / coin / token (exclude sealed: sealed has its own pool).
    (CASE WHEN ec.is_sealed THEN 0
          WHEN ec.card_name ~* '\m(energy|coin|token|damage counter|gx marker|condition marker)\M' THEN 1
          ELSE 0 END) AS is_energy_accessory,
    -- Jumbo / oversized.
    (CASE WHEN ec.card_name ~* '\m(jumbo|oversized|giant card)\M' THEN 1 ELSE 0 END) AS is_jumbo,
    -- Topps TV / Topps Movie (excluded outright from most pools, capped overall).
    (CASE WHEN ec.set_name  ILIKE '%topps%'
            OR ec.card_name ILIKE '%topps%'
          THEN 1 ELSE 0 END) AS is_topps_movie,
    -- Blister / tin / collection box (excluded outside sealed pool).
    (CASE WHEN ec.is_sealed THEN 0
          WHEN ec.card_name ~* '\m(blister|tin|collection box|premium collection|build & battle|prerelease kit)\M' THEN 1
          ELSE 0 END) AS is_blister_tin,
    -- Obviously broken / mangled name patterns.
    (CASE WHEN ec.card_name ~* ' on bundle\M'
            OR ec.card_name ~* '\s{3,}'
            OR ec.card_name ~* '\m(unknown|placeholder|test card)\M'
            OR LENGTH(TRIM(ec.card_name)) < 2
          THEN 1 ELSE 0 END) AS is_broken_name,
    -- Popular-species hint (used to bias general top-up).
    (CASE WHEN ec.card_name ~* '\m(charizard|pikachu|mewtwo|mew|eevee|umbreon|espeon|sylveon|rayquaza|lugia|gengar|gardevoir|gyarados|dragonite|lucario|garchomp|greninja|blastoise|venusaur|snorlax|jigglypuff|magikarp|articuno|zapdos|moltres|suicune|entei|raikou|giratina|dialga|palkia|arceus|zekrom|reshiram|kyurem|xerneas|yveltal|zacian|zamazenta|miraidon|koraidon)\M' THEN 1 ELSE 0 END) AS is_popular_species,
    -- All prices null (capped overall).
    (CASE WHEN lp.raw_price_cents IS NULL
            AND lp.psa9_price_cents IS NULL
            AND lp.psa10_price_cents IS NULL
          THEN 1 ELSE 0 END) AS all_prices_null,
    -- Quality score (positive = better). Tuned for the general top-up phase.
    (
        CASE WHEN COALESCE(v.sales_30d_total, 0) > 0 THEN 100 ELSE 0 END
      + CASE WHEN lp.raw_price_cents   IS NOT NULL AND lp.raw_price_cents   > 0 THEN  50 ELSE 0 END
      + CASE WHEN lp.psa9_price_cents  IS NOT NULL AND lp.psa9_price_cents  > 0 THEN  25 ELSE 0 END
      + CASE WHEN lp.psa10_price_cents IS NOT NULL AND lp.psa10_price_cents > 0 THEN  35 ELSE 0 END
      + LEAST(COALESCE(v.sales_30d_total, 0), 200)
      + (COALESCE(pa.portfolio_count, 0) + COALESCE(wa.watchlist_count, 0)) * 5
      + CASE WHEN ec.card_name ~* '\m(charizard|pikachu|mewtwo|mew|eevee|umbreon|espeon|sylveon|rayquaza|lugia|gengar|gardevoir|gyarados|dragonite|lucario|garchomp|greninja|blastoise|venusaur|snorlax|jigglypuff|magikarp|articuno|zapdos|moltres|suicune|entei|raikou|giratina|dialga|palkia|arceus|zekrom|reshiram|kyurem|xerneas|yveltal|zacian|zamazenta|miraidon|koraidon)\M' THEN 15 ELSE 0 END
      - CASE WHEN ec.set_name  ILIKE '%topps%' OR ec.card_name ILIKE '%topps%' THEN 300 ELSE 0 END
      - CASE WHEN ec.card_name ~* '\m(jumbo|oversized|giant card)\M'           THEN 300 ELSE 0 END
      - CASE WHEN NOT ec.is_sealed AND ec.card_name ~* '\m(energy|coin|token|damage counter|gx marker|condition marker)\M' THEN 200 ELSE 0 END
      - CASE WHEN NOT ec.is_sealed AND ec.card_name ~* '\m(blister|tin|collection box|premium collection|build & battle|prerelease kit)\M' THEN 100 ELSE 0 END
      - CASE WHEN ec.card_name ~* ' on bundle\M' OR ec.card_name ~* '\s{3,}' OR LENGTH(TRIM(ec.card_name)) < 2 THEN 500 ELSE 0 END
      - CASE WHEN lp.raw_price_cents IS NULL AND lp.psa9_price_cents IS NULL AND lp.psa10_price_cents IS NULL THEN 150 ELSE 0 END
    )::int AS quality_score
  FROM eligible_cards ec
  LEFT JOIN latest_prices lp ON lp.provider_card_id = ec.provider_card_id
  LEFT JOIN volume        v  ON v.price_card_slug   = ec.bare_card_slug
                                  OR v.price_card_slug = ('pc-' || ec.bare_card_slug)
  LEFT JOIN portfolio_agg pa ON pa.bare_card_slug   = ec.bare_card_slug
  LEFT JOIN watchlist_agg wa ON wa.bare_card_slug   = ec.bare_card_slug
),
-- ----------------------------------------------------------------------------
-- (7) INDEPENDENT CANDIDATE POOLS. Each ranks the FULL eligible population
--     by category-specific quality; no priority cascade.
-- ----------------------------------------------------------------------------
sealed_pool AS (
  SELECT *, ROW_NUMBER() OVER (
    ORDER BY
      -- prefer sealed items with a known raw price (real product listings)
      CASE WHEN COALESCE(raw_price_cents, 0) > 0 THEN 0 ELSE 1 END,
      raw_price_cents DESC NULLS LAST,
      sales_30d       DESC NULLS LAST,
      provider_card_id
  ) AS pool_rn
  FROM enriched
  WHERE is_sealed       = TRUE
    AND is_broken_name  = 0
),
sparse_pool AS (
  SELECT *, ROW_NUMBER() OVER (
    ORDER BY
      -- prefer real cards with a known raw price even when volume is low
      CASE WHEN COALESCE(raw_price_cents, 0) > 0 THEN 0 ELSE 1 END,
      quality_score DESC,
      raw_price_cents ASC NULLS LAST,
      provider_card_id
  ) AS pool_rn
  FROM enriched
  WHERE is_sealed           = FALSE
    AND COALESCE(sales_30d, 0) <= 1
    AND is_broken_name      = 0
    AND is_topps_movie      = 0
    AND is_energy_accessory = 0
    AND is_jumbo            = 0
    AND is_blister_tin      = 0
    AND all_prices_null     = 0   -- sparse must still be a real card with a price
),
difficult_pool AS (
  SELECT *, ROW_NUMBER() OVER (
    ORDER BY
      quality_score DESC,
      sales_30d     DESC NULLS LAST,
      raw_price_cents DESC NULLS LAST,
      provider_card_id
  ) AS pool_rn
  FROM enriched
  WHERE is_sealed      = FALSE
    AND is_broken_name = 0
    AND is_topps_movie = 0
    AND (
         card_name ILIKE '%1st edition%'
      OR card_name ILIKE '%first edition%'
      OR card_name ILIKE '%shadowless%'
      OR card_name ILIKE '%reverse holo%'
      OR card_name ILIKE '%alt art%'
      OR card_name ILIKE '%alternate art%'
      OR card_name ILIKE '%stamped%'
      OR card_name ILIKE '%staff%'
      OR card_name ILIKE '%prerelease%'
      OR card_name ILIKE '%pre-release%'
      OR card_name ILIKE '%league%'
      OR card_name ILIKE '%winner%'
      OR card_name ILIKE '%special delivery%'
      OR card_name ILIKE '%promo%'
    )
),
vintage_pool AS (
  SELECT *, ROW_NUMBER() OVER (
    ORDER BY
      quality_score DESC,
      sales_30d     DESC NULLS LAST,
      raw_price_cents DESC NULLS LAST,
      provider_card_id
  ) AS pool_rn
  FROM enriched
  WHERE is_sealed      = FALSE
    AND is_broken_name = 0
    AND is_topps_movie = 0
    AND set_name ILIKE ANY (ARRAY[
      '%base set%','%jungle%','%fossil%','%team rocket%',
      '%gym heroes%','%gym challenge%',
      '%neo genesis%','%neo discovery%','%neo revelation%','%neo destiny%',
      '%legendary collection%','%expedition%','%aquapolis%','%skyridge%'
    ])
),
psa_pool AS (
  SELECT *, ROW_NUMBER() OVER (
    ORDER BY
      quality_score DESC,
      GREATEST(COALESCE(psa10_price_cents,0), COALESCE(psa9_price_cents,0)) DESC,
      sales_30d DESC NULLS LAST,
      provider_card_id
  ) AS pool_rn
  FROM enriched
  WHERE is_sealed      = FALSE
    AND is_broken_name = 0
    AND is_topps_movie = 0
    AND is_jumbo       = 0
    AND COALESCE(raw_price_cents, 0) > 0
    AND (COALESCE(psa9_price_cents, 0) > 0 OR COALESCE(psa10_price_cents, 0) > 0)
),
modern_pool AS (
  SELECT *, ROW_NUMBER() OVER (
    ORDER BY
      quality_score DESC,
      sales_30d     DESC NULLS LAST,
      psa10_price_cents DESC NULLS LAST,
      raw_price_cents   DESC NULLS LAST,
      provider_card_id
  ) AS pool_rn
  FROM enriched
  WHERE is_sealed           = FALSE
    AND is_broken_name      = 0
    AND is_topps_movie      = 0
    AND is_jumbo            = 0
    AND is_energy_accessory = 0
    AND is_blister_tin      = 0
    AND set_release_date >= DATE '2019-01-01'
    AND (
         COALESCE(sales_30d, 0)         > 0
      OR COALESCE(raw_price_cents, 0)   > 0
      OR COALESCE(psa10_price_cents, 0) > 0
    )
),
general_quality_pool AS (
  SELECT *, ROW_NUMBER() OVER (
    ORDER BY
      quality_score DESC,
      sales_30d     DESC NULLS LAST,
      raw_price_cents DESC NULLS LAST,
      provider_card_id
  ) AS pool_rn
  FROM enriched
  WHERE is_broken_name = 0
),
-- ----------------------------------------------------------------------------
-- (8) SEQUENTIAL PICK WITH ANTI-JOIN. Each pool re-ranks after excluding
--     cards already taken by earlier pools.
-- ----------------------------------------------------------------------------
chosen_sealed AS (
  SELECT
    sp.*, 'sealed'::text AS primary_category, 1 AS pool_order
  FROM sealed_pool sp
  WHERE sp.pool_rn <= 10
),

sparse_rerank AS (
  SELECT *, ROW_NUMBER() OVER (
    ORDER BY pool_rn
  ) AS rrn
  FROM sparse_pool
  WHERE provider_card_id NOT IN (SELECT provider_card_id FROM chosen_sealed)
    AND bare_card_slug   NOT IN (SELECT bare_card_slug   FROM chosen_sealed)
),
chosen_sparse AS (
  SELECT s.*, 'sparse'::text AS primary_category, 2 AS pool_order
  FROM sparse_rerank s WHERE s.rrn <= 10
),

difficult_rerank AS (
  SELECT *, ROW_NUMBER() OVER (ORDER BY pool_rn) AS rrn
  FROM difficult_pool
  WHERE provider_card_id NOT IN (SELECT provider_card_id FROM chosen_sealed)
    AND bare_card_slug   NOT IN (SELECT bare_card_slug   FROM chosen_sealed)
    AND provider_card_id NOT IN (SELECT provider_card_id FROM chosen_sparse)
    AND bare_card_slug   NOT IN (SELECT bare_card_slug   FROM chosen_sparse)
),
chosen_difficult AS (
  SELECT d.*, 'difficult_variants'::text AS primary_category, 3 AS pool_order
  FROM difficult_rerank d WHERE d.rrn <= 10
),

vintage_rerank AS (
  SELECT *, ROW_NUMBER() OVER (ORDER BY pool_rn) AS rrn
  FROM vintage_pool
  WHERE provider_card_id NOT IN (SELECT provider_card_id FROM chosen_sealed)
    AND provider_card_id NOT IN (SELECT provider_card_id FROM chosen_sparse)
    AND provider_card_id NOT IN (SELECT provider_card_id FROM chosen_difficult)
    AND bare_card_slug   NOT IN (SELECT bare_card_slug   FROM chosen_sealed)
    AND bare_card_slug   NOT IN (SELECT bare_card_slug   FROM chosen_sparse)
    AND bare_card_slug   NOT IN (SELECT bare_card_slug   FROM chosen_difficult)
),
chosen_vintage AS (
  SELECT v.*, 'vintage_or_wotc'::text AS primary_category, 4 AS pool_order
  FROM vintage_rerank v WHERE v.rrn <= 10
),

psa_rerank AS (
  SELECT *, ROW_NUMBER() OVER (ORDER BY pool_rn) AS rrn
  FROM psa_pool
  WHERE provider_card_id NOT IN (SELECT provider_card_id FROM chosen_sealed)
    AND provider_card_id NOT IN (SELECT provider_card_id FROM chosen_sparse)
    AND provider_card_id NOT IN (SELECT provider_card_id FROM chosen_difficult)
    AND provider_card_id NOT IN (SELECT provider_card_id FROM chosen_vintage)
    AND bare_card_slug   NOT IN (SELECT bare_card_slug   FROM chosen_sealed)
    AND bare_card_slug   NOT IN (SELECT bare_card_slug   FROM chosen_sparse)
    AND bare_card_slug   NOT IN (SELECT bare_card_slug   FROM chosen_difficult)
    AND bare_card_slug   NOT IN (SELECT bare_card_slug   FROM chosen_vintage)
),
chosen_psa AS (
  SELECT p.*, 'psa_or_grade_spread'::text AS primary_category, 5 AS pool_order
  FROM psa_rerank p WHERE p.rrn <= 10
),

modern_rerank AS (
  SELECT *, ROW_NUMBER() OVER (ORDER BY pool_rn) AS rrn
  FROM modern_pool
  WHERE provider_card_id NOT IN (SELECT provider_card_id FROM chosen_sealed)
    AND provider_card_id NOT IN (SELECT provider_card_id FROM chosen_sparse)
    AND provider_card_id NOT IN (SELECT provider_card_id FROM chosen_difficult)
    AND provider_card_id NOT IN (SELECT provider_card_id FROM chosen_vintage)
    AND provider_card_id NOT IN (SELECT provider_card_id FROM chosen_psa)
    AND bare_card_slug   NOT IN (SELECT bare_card_slug   FROM chosen_sealed)
    AND bare_card_slug   NOT IN (SELECT bare_card_slug   FROM chosen_sparse)
    AND bare_card_slug   NOT IN (SELECT bare_card_slug   FROM chosen_difficult)
    AND bare_card_slug   NOT IN (SELECT bare_card_slug   FROM chosen_vintage)
    AND bare_card_slug   NOT IN (SELECT bare_card_slug   FROM chosen_psa)
),
chosen_modern AS (
  SELECT m.*, 'modern_or_recent'::text AS primary_category, 6 AS pool_order
  FROM modern_rerank m WHERE m.rrn <= 15
),

-- ----------------------------------------------------------------------------
-- (9) Combined minimum-coverage cohort (65 rows when all pools hit their floor).
-- ----------------------------------------------------------------------------
minimum_cohort AS (
  SELECT provider_card_id, bare_card_slug, card_name, set_name, card_number,
         is_sealed, confidence, raw_price_cents, psa9_price_cents, psa10_price_cents,
         sales_30d, portfolio_count, watchlist_count,
         is_charizard, is_pikachu, is_energy_accessory, is_jumbo, is_topps_movie,
         is_blister_tin, is_popular_species, all_prices_null, quality_score,
         primary_category, pool_order
  FROM chosen_sealed
  UNION ALL
  SELECT provider_card_id, bare_card_slug, card_name, set_name, card_number,
         is_sealed, confidence, raw_price_cents, psa9_price_cents, psa10_price_cents,
         sales_30d, portfolio_count, watchlist_count,
         is_charizard, is_pikachu, is_energy_accessory, is_jumbo, is_topps_movie,
         is_blister_tin, is_popular_species, all_prices_null, quality_score,
         primary_category, pool_order
  FROM chosen_sparse
  UNION ALL
  SELECT provider_card_id, bare_card_slug, card_name, set_name, card_number,
         is_sealed, confidence, raw_price_cents, psa9_price_cents, psa10_price_cents,
         sales_30d, portfolio_count, watchlist_count,
         is_charizard, is_pikachu, is_energy_accessory, is_jumbo, is_topps_movie,
         is_blister_tin, is_popular_species, all_prices_null, quality_score,
         primary_category, pool_order
  FROM chosen_difficult
  UNION ALL
  SELECT provider_card_id, bare_card_slug, card_name, set_name, card_number,
         is_sealed, confidence, raw_price_cents, psa9_price_cents, psa10_price_cents,
         sales_30d, portfolio_count, watchlist_count,
         is_charizard, is_pikachu, is_energy_accessory, is_jumbo, is_topps_movie,
         is_blister_tin, is_popular_species, all_prices_null, quality_score,
         primary_category, pool_order
  FROM chosen_vintage
  UNION ALL
  SELECT provider_card_id, bare_card_slug, card_name, set_name, card_number,
         is_sealed, confidence, raw_price_cents, psa9_price_cents, psa10_price_cents,
         sales_30d, portfolio_count, watchlist_count,
         is_charizard, is_pikachu, is_energy_accessory, is_jumbo, is_topps_movie,
         is_blister_tin, is_popular_species, all_prices_null, quality_score,
         primary_category, pool_order
  FROM chosen_psa
  UNION ALL
  SELECT provider_card_id, bare_card_slug, card_name, set_name, card_number,
         is_sealed, confidence, raw_price_cents, psa9_price_cents, psa10_price_cents,
         sales_30d, portfolio_count, watchlist_count,
         is_charizard, is_pikachu, is_energy_accessory, is_jumbo, is_topps_movie,
         is_blister_tin, is_popular_species, all_prices_null, quality_score,
         primary_category, pool_order
  FROM chosen_modern
),

-- ----------------------------------------------------------------------------
-- (10) HARD CAPS on the minimum cohort. Any row that violates a cap is
--      dropped here; the deficit will be picked up by the general top-up.
--      Caps:
--        Charizard          <= 10
--        Pikachu            <=  8
--        energy_accessory   <=  6
--        jumbo              <=  6
--        topps              <=  8
--        sealed             <= 15 (auto-satisfied: sealed pool capped at 10)
--        all_prices_null    <= 20
--        per set_name       <=  8
-- ----------------------------------------------------------------------------
minimum_with_caps AS (
  SELECT *,
    ROW_NUMBER() OVER (PARTITION BY is_charizard         ORDER BY pool_order, quality_score DESC, provider_card_id) AS chari_rn,
    ROW_NUMBER() OVER (PARTITION BY is_pikachu           ORDER BY pool_order, quality_score DESC, provider_card_id) AS pika_rn,
    ROW_NUMBER() OVER (PARTITION BY is_energy_accessory  ORDER BY pool_order, quality_score DESC, provider_card_id) AS energy_rn,
    ROW_NUMBER() OVER (PARTITION BY is_jumbo             ORDER BY pool_order, quality_score DESC, provider_card_id) AS jumbo_rn,
    ROW_NUMBER() OVER (PARTITION BY is_topps_movie       ORDER BY pool_order, quality_score DESC, provider_card_id) AS topps_rn,
    ROW_NUMBER() OVER (PARTITION BY all_prices_null      ORDER BY pool_order, quality_score DESC, provider_card_id) AS null_rn,
    ROW_NUMBER() OVER (PARTITION BY set_name             ORDER BY pool_order, quality_score DESC, provider_card_id) AS set_rn
  FROM minimum_cohort
),
minimum_passing AS (
  SELECT * FROM minimum_with_caps
  WHERE (is_charizard         = 0 OR chari_rn  <= 10)
    AND (is_pikachu           = 0 OR pika_rn   <=  8)
    AND (is_energy_accessory  = 0 OR energy_rn <=  6)
    AND (is_jumbo             = 0 OR jumbo_rn  <=  6)
    AND (is_topps_movie       = 0 OR topps_rn  <=  8)
    AND (all_prices_null      = 0 OR null_rn   <= 20)
    AND set_rn <= 8
),

-- ----------------------------------------------------------------------------
-- (11) Compute deficit + running cap usage from the passing minimum.
-- ----------------------------------------------------------------------------
used_caps AS (
  SELECT
    SUM(is_charizard)::int        AS used_chari,
    SUM(is_pikachu)::int          AS used_pika,
    SUM(is_energy_accessory)::int AS used_energy,
    SUM(is_jumbo)::int            AS used_jumbo,
    SUM(is_topps_movie)::int      AS used_topps,
    SUM(all_prices_null)::int     AS used_null,
    SUM((is_sealed)::int)::int    AS used_sealed,
    COUNT(*)::int                 AS used_total
  FROM minimum_passing
),

-- ----------------------------------------------------------------------------
-- (12) GENERAL TOP-UP — exclude already-chosen and apply cap-aware ranking.
-- ----------------------------------------------------------------------------
remaining AS (
  SELECT g.*
  FROM general_quality_pool g
  WHERE g.provider_card_id NOT IN (SELECT provider_card_id FROM minimum_passing)
    AND g.bare_card_slug   NOT IN (SELECT bare_card_slug   FROM minimum_passing)
),
remaining_ranked AS (
  SELECT r.*,
    ROW_NUMBER() OVER (PARTITION BY r.is_charizard        ORDER BY r.quality_score DESC, r.provider_card_id) AS chari_rn,
    ROW_NUMBER() OVER (PARTITION BY r.is_pikachu          ORDER BY r.quality_score DESC, r.provider_card_id) AS pika_rn,
    ROW_NUMBER() OVER (PARTITION BY r.is_energy_accessory ORDER BY r.quality_score DESC, r.provider_card_id) AS energy_rn,
    ROW_NUMBER() OVER (PARTITION BY r.is_jumbo            ORDER BY r.quality_score DESC, r.provider_card_id) AS jumbo_rn,
    ROW_NUMBER() OVER (PARTITION BY r.is_topps_movie      ORDER BY r.quality_score DESC, r.provider_card_id) AS topps_rn,
    ROW_NUMBER() OVER (PARTITION BY r.all_prices_null     ORDER BY r.quality_score DESC, r.provider_card_id) AS null_rn,
    ROW_NUMBER() OVER (PARTITION BY r.is_sealed           ORDER BY r.quality_score DESC, r.provider_card_id) AS sealed_rn
  FROM remaining r
),
remaining_capped AS (
  SELECT rr.*
  FROM remaining_ranked rr, used_caps uc
  WHERE (rr.is_charizard         = 0 OR uc.used_chari  + rr.chari_rn  <= 10)
    AND (rr.is_pikachu           = 0 OR uc.used_pika   + rr.pika_rn   <=  8)
    AND (rr.is_energy_accessory  = 0 OR uc.used_energy + rr.energy_rn <=  6)
    AND (rr.is_jumbo             = 0 OR uc.used_jumbo  + rr.jumbo_rn  <=  6)
    AND (rr.is_topps_movie       = 0 OR uc.used_topps  + rr.topps_rn  <=  8)
    AND (rr.all_prices_null      = 0 OR uc.used_null   + rr.null_rn   <= 20)
    AND (rr.is_sealed = FALSE       OR uc.used_sealed + rr.sealed_rn  <= 15)
),
remaining_final AS (
  SELECT rc.*,
    ROW_NUMBER() OVER (ORDER BY rc.quality_score DESC, rc.provider_card_id) AS topup_rn
  FROM remaining_capped rc
),
topup AS (
  SELECT rf.*
  FROM remaining_final rf, used_caps uc
  WHERE rf.topup_rn <= GREATEST(0, 100 - uc.used_total)
),

-- ----------------------------------------------------------------------------
-- (13) FINAL COHORT — minimum cohort + general top-up, with per-set cap
--      re-applied across the combined result to enforce ≤ 8 per set_name.
-- ----------------------------------------------------------------------------
combined AS (
  SELECT provider_card_id, bare_card_slug, card_name, set_name, card_number,
         is_sealed, confidence, raw_price_cents, psa9_price_cents, psa10_price_cents,
         sales_30d, portfolio_count, watchlist_count,
         is_charizard, is_pikachu, is_energy_accessory, is_jumbo, is_topps_movie,
         is_blister_tin, is_popular_species, all_prices_null, quality_score,
         primary_category, pool_order
  FROM minimum_passing
  UNION ALL
  SELECT provider_card_id, bare_card_slug, card_name, set_name, card_number,
         is_sealed, confidence, raw_price_cents, psa9_price_cents, psa10_price_cents,
         sales_30d, portfolio_count, watchlist_count,
         is_charizard, is_pikachu, is_energy_accessory, is_jumbo, is_topps_movie,
         is_blister_tin, is_popular_species, all_prices_null, quality_score,
         'general_quality'::text AS primary_category, 7 AS pool_order
  FROM topup
),
final_with_set_caps AS (
  SELECT *,
    ROW_NUMBER() OVER (PARTITION BY set_name ORDER BY pool_order, quality_score DESC, provider_card_id) AS set_rn_final
  FROM combined
),
final_passing AS (
  SELECT * FROM final_with_set_caps WHERE set_rn_final <= 8
)
-- ----------------------------------------------------------------------------
-- (14) MAIN SELECT (single statement — only this result is shown by Supabase).
-- ----------------------------------------------------------------------------
SELECT
  'pricecharting'                              AS provider,
  provider_card_id,
  bare_card_slug                               AS card_slug,
  regexp_replace(card_name, '\s+#\d+\s*$', '') AS card_name,
  set_name,
  primary_category,
  CASE primary_category
    WHEN 'sealed'              THEN 'is_sealed=true; sealed-product layout coverage'
    WHEN 'sparse'              THEN 'few/no recent sales expected; validates no-section behaviour'
    WHEN 'difficult_variants'  THEN '1st edition / shadowless / reverse holo / promo / stamped / alt art'
    WHEN 'vintage_or_wotc'     THEN 'WOTC / e-Card era English set; condition-heavy raw + graded'
    WHEN 'psa_or_grade_spread' THEN 'raw + PSA9 and/or PSA10 active; grade-spread analysis'
    WHEN 'modern_or_recent'    THEN 'SwSh / Scarlet & Violet era; active price or sales signal'
    WHEN 'general_quality'     THEN 'quality top-up — best available eligible by score'
  END AS selection_reason,
  confidence,
  is_sealed,
  raw_price_cents,
  psa9_price_cents,
  psa10_price_cents,
  sales_30d,
  portfolio_count,
  watchlist_count
FROM final_passing
ORDER BY pool_order, quality_score DESC, provider_card_id
LIMIT 100;

-- ============================================================================
-- DEBUG SUMMARY (OPTIONAL — commented out by default).
--
-- Supabase only displays the last statement's result. If you want to inspect
-- the cohort's distribution, copy the MAIN SELECT above out, then UNCOMMENT
-- the block below and re-run.
--
-- The summary reports:
--   total_rows, count by primary_category, charizard_count, pikachu_count,
--   energy_accessory_count, jumbo_count, topps_count, sealed_count,
--   all_null_price_count, max_per_set_count, duplicate_provider_ids,
--   duplicate_card_slugs, low_confidence_rows, unmapped_rows.
-- ============================================================================
/*
WITH cohort AS (
  -- Paste the entire WITH block from above here, ending at "final_passing AS (...)",
  -- then run this summary against final_passing.
  SELECT * FROM final_passing
)
SELECT 'total_rows'                  AS metric, COUNT(*)::int AS value FROM cohort
UNION ALL
SELECT 'cat_sealed',                          COUNT(*) FILTER (WHERE primary_category='sealed')              FROM cohort
UNION ALL
SELECT 'cat_sparse',                          COUNT(*) FILTER (WHERE primary_category='sparse')              FROM cohort
UNION ALL
SELECT 'cat_difficult_variants',              COUNT(*) FILTER (WHERE primary_category='difficult_variants')  FROM cohort
UNION ALL
SELECT 'cat_vintage_or_wotc',                 COUNT(*) FILTER (WHERE primary_category='vintage_or_wotc')     FROM cohort
UNION ALL
SELECT 'cat_psa_or_grade_spread',             COUNT(*) FILTER (WHERE primary_category='psa_or_grade_spread') FROM cohort
UNION ALL
SELECT 'cat_modern_or_recent',                COUNT(*) FILTER (WHERE primary_category='modern_or_recent')    FROM cohort
UNION ALL
SELECT 'cat_general_quality',                 COUNT(*) FILTER (WHERE primary_category='general_quality')    FROM cohort
UNION ALL
SELECT 'charizard_count',                     SUM(is_charizard)::int                                        FROM cohort
UNION ALL
SELECT 'pikachu_count',                       SUM(is_pikachu)::int                                          FROM cohort
UNION ALL
SELECT 'energy_accessory_count',              SUM(is_energy_accessory)::int                                 FROM cohort
UNION ALL
SELECT 'jumbo_count',                         SUM(is_jumbo)::int                                            FROM cohort
UNION ALL
SELECT 'topps_count',                         SUM(is_topps_movie)::int                                      FROM cohort
UNION ALL
SELECT 'sealed_count',                        SUM((is_sealed)::int)::int                                    FROM cohort
UNION ALL
SELECT 'all_null_price_count',                SUM(all_prices_null)::int                                     FROM cohort
UNION ALL
SELECT 'max_per_set_count',                   (SELECT MAX(c)::int FROM (SELECT COUNT(*) AS c FROM cohort GROUP BY set_name) s) FROM cohort
UNION ALL
SELECT 'duplicate_provider_ids',              (COUNT(*) - COUNT(DISTINCT provider_card_id))::int            FROM cohort
UNION ALL
SELECT 'duplicate_card_slugs',                (COUNT(*) - COUNT(DISTINCT bare_card_slug))::int              FROM cohort
UNION ALL
SELECT 'low_confidence_rows',                 COUNT(*) FILTER (WHERE confidence < 0.900)                    FROM cohort
ORDER BY metric;
*/
