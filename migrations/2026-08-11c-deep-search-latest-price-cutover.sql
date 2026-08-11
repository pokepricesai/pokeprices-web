-- migrations/2026-08-11c-deep-search-latest-price-cutover.sql
--
-- Block 5A-W-56A.7a — Deep Search cutover.  Run ONLY after Migration A
-- has been applied AND Migration B's backfill has been driven to
-- completion (more_remaining = false, coverage query shows the
-- expected row counts).
--
-- If you run this before the snapshot is populated, Deep Search will
-- return NULL prices for every card that has not yet been backfilled
-- but has data in daily_prices.  Do not do that.
--
-- What this installs:
--   * cards_search_v — cards LEFT JOIN card_latest_prices LEFT JOIN
--     card_trends.  All grade prices come from card_latest_prices.
--     Trend pcts come from card_trends.  No LATERAL.
--   * search_cards_deep — restored simple shape.  PSA 7 / PSA 8
--     supported natively.  No unsupported flag, no PSA7/8 branch.
--     SECURITY DEFINER preserved from 56A.3.
--     Cheap catalogue-count fast path preserved.

BEGIN;

-- ─── 1. Deep Search view — full-coverage snapshot join ────────────────────

DROP VIEW IF EXISTS public.cards_search_v;

CREATE VIEW public.cards_search_v AS
SELECT
  c.card_slug,
  c.card_name,
  c.set_name,
  c.card_number,
  c.card_number_display,
  c.set_printed_total,
  c.card_url_slug,
  c.image_url,
  c.primary_pokemon_slug,
  COALESCE(c.language, 'en')                     AS language,
  c.set_release_date,
  EXTRACT(YEAR FROM c.set_release_date)::INT     AS release_year,
  lp.raw_usd,
  lp.psa7_usd,
  lp.psa8_usd,
  lp.psa9_usd,
  lp.psa10_usd,
  ct.raw_pct_7d,
  ct.raw_pct_30d,
  ct.raw_pct_90d,
  CASE WHEN lp.raw_usd IS NOT NULL AND lp.psa9_usd  IS NOT NULL
       THEN lp.psa9_usd  - lp.raw_usd END          AS psa9_uplift,
  CASE WHEN lp.raw_usd IS NOT NULL AND lp.psa10_usd IS NOT NULL
       THEN lp.psa10_usd - lp.raw_usd END          AS psa10_uplift,
  CASE WHEN lp.raw_usd > 0 AND lp.psa9_usd  IS NOT NULL
       THEN lp.psa9_usd::NUMERIC  / lp.raw_usd END AS psa9_multiple,
  CASE WHEN lp.raw_usd > 0 AND lp.psa10_usd IS NOT NULL
       THEN lp.psa10_usd::NUMERIC / lp.raw_usd END AS psa10_multiple
FROM public.cards c
LEFT JOIN public.card_latest_prices lp ON lp.card_slug = 'pc-' || c.card_slug
LEFT JOIN public.card_trends        ct ON ct.card_slug = c.card_slug
WHERE COALESCE(c.is_sealed, FALSE) = FALSE;

GRANT SELECT ON public.cards_search_v TO anon, authenticated, service_role;

-- ─── 2. Deep Search RPC — simple, no PSA7/8 branch ────────────────────────

DROP FUNCTION IF EXISTS public.search_cards_deep(
  TEXT, TEXT, TEXT, TEXT,
  INT, INT,
  INT, INT, INT, INT, INT, INT, INT, INT, INT, INT,
  NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC,
  INT, INT, NUMERIC, NUMERIC,
  TEXT, INT, INT
);

CREATE OR REPLACE FUNCTION public.search_cards_deep(
  p_pokemon_slug        TEXT    DEFAULT NULL,
  p_card_name           TEXT    DEFAULT NULL,
  p_set_name            TEXT    DEFAULT NULL,
  p_language            TEXT    DEFAULT NULL,
  p_year_min            INT     DEFAULT NULL,
  p_year_max            INT     DEFAULT NULL,
  p_raw_min             INT     DEFAULT NULL,
  p_raw_max             INT     DEFAULT NULL,
  p_psa7_min            INT     DEFAULT NULL,
  p_psa7_max            INT     DEFAULT NULL,
  p_psa8_min            INT     DEFAULT NULL,
  p_psa8_max            INT     DEFAULT NULL,
  p_psa9_min            INT     DEFAULT NULL,
  p_psa9_max            INT     DEFAULT NULL,
  p_psa10_min           INT     DEFAULT NULL,
  p_psa10_max           INT     DEFAULT NULL,
  p_change_7d_min       NUMERIC DEFAULT NULL,
  p_change_7d_max       NUMERIC DEFAULT NULL,
  p_change_30d_min      NUMERIC DEFAULT NULL,
  p_change_30d_max      NUMERIC DEFAULT NULL,
  p_change_90d_min      NUMERIC DEFAULT NULL,
  p_change_90d_max      NUMERIC DEFAULT NULL,
  p_psa9_uplift_min     INT     DEFAULT NULL,
  p_psa10_uplift_min    INT     DEFAULT NULL,
  p_psa9_multiple_min   NUMERIC DEFAULT NULL,
  p_psa10_multiple_min  NUMERIC DEFAULT NULL,
  p_sort                TEXT    DEFAULT 'name_asc',
  p_limit               INT     DEFAULT 50,
  p_offset              INT     DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lim   INT := GREATEST(1, LEAST(COALESCE(p_limit,  50), 200));
  v_off   INT := GREATEST(0, LEAST(COALESCE(p_offset, 0), 10000));
  v_total INT;
  v_rows  JSONB;
  v_filters_empty BOOLEAN := (
    p_pokemon_slug IS NULL AND p_card_name IS NULL AND p_set_name IS NULL
    AND p_language IS NULL
    AND p_year_min IS NULL AND p_year_max IS NULL
    AND p_raw_min  IS NULL AND p_raw_max  IS NULL
    AND p_psa7_min  IS NULL AND p_psa7_max  IS NULL
    AND p_psa8_min  IS NULL AND p_psa8_max  IS NULL
    AND p_psa9_min  IS NULL AND p_psa9_max  IS NULL
    AND p_psa10_min IS NULL AND p_psa10_max IS NULL
    AND p_change_7d_min  IS NULL AND p_change_7d_max  IS NULL
    AND p_change_30d_min IS NULL AND p_change_30d_max IS NULL
    AND p_change_90d_min IS NULL AND p_change_90d_max IS NULL
    AND p_psa9_uplift_min    IS NULL AND p_psa10_uplift_min   IS NULL
    AND p_psa9_multiple_min  IS NULL AND p_psa10_multiple_min IS NULL
  );
BEGIN
  IF v_filters_empty THEN
    v_total := public.count_deep_search_catalogue();
  ELSE
    v_total := (
      SELECT COUNT(*)
      FROM public.cards_search_v v
      WHERE (p_pokemon_slug IS NULL OR EXISTS (
               SELECT 1 FROM public.card_pokemon cp
               WHERE cp.card_slug = v.card_slug
                 AND cp.species_slug = p_pokemon_slug))
        AND (p_card_name IS NULL OR v.card_name ILIKE '%' || p_card_name || '%')
        AND (p_set_name  IS NULL OR v.set_name  ILIKE '%' || p_set_name  || '%')
        AND (p_language  IS NULL OR v.language  = p_language)
        AND (p_year_min  IS NULL OR v.release_year >= p_year_min)
        AND (p_year_max  IS NULL OR v.release_year <= p_year_max)
        AND (p_raw_min   IS NULL OR v.raw_usd   >= p_raw_min)
        AND (p_raw_max   IS NULL OR v.raw_usd   <= p_raw_max)
        AND (p_psa7_min  IS NULL OR v.psa7_usd  >= p_psa7_min)
        AND (p_psa7_max  IS NULL OR v.psa7_usd  <= p_psa7_max)
        AND (p_psa8_min  IS NULL OR v.psa8_usd  >= p_psa8_min)
        AND (p_psa8_max  IS NULL OR v.psa8_usd  <= p_psa8_max)
        AND (p_psa9_min  IS NULL OR v.psa9_usd  >= p_psa9_min)
        AND (p_psa9_max  IS NULL OR v.psa9_usd  <= p_psa9_max)
        AND (p_psa10_min IS NULL OR v.psa10_usd >= p_psa10_min)
        AND (p_psa10_max IS NULL OR v.psa10_usd <= p_psa10_max)
        AND (p_change_7d_min  IS NULL OR v.raw_pct_7d  >= p_change_7d_min)
        AND (p_change_7d_max  IS NULL OR v.raw_pct_7d  <= p_change_7d_max)
        AND (p_change_30d_min IS NULL OR v.raw_pct_30d >= p_change_30d_min)
        AND (p_change_30d_max IS NULL OR v.raw_pct_30d <= p_change_30d_max)
        AND (p_change_90d_min IS NULL OR v.raw_pct_90d >= p_change_90d_min)
        AND (p_change_90d_max IS NULL OR v.raw_pct_90d <= p_change_90d_max)
        AND (p_psa9_uplift_min    IS NULL OR v.psa9_uplift    >= p_psa9_uplift_min)
        AND (p_psa10_uplift_min   IS NULL OR v.psa10_uplift   >= p_psa10_uplift_min)
        AND (p_psa9_multiple_min  IS NULL OR v.psa9_multiple  >= p_psa9_multiple_min)
        AND (p_psa10_multiple_min IS NULL OR v.psa10_multiple >= p_psa10_multiple_min)
    );
  END IF;

  WITH filtered AS (
    SELECT v.*
    FROM public.cards_search_v v
    WHERE
      (p_pokemon_slug IS NULL OR EXISTS (
         SELECT 1 FROM public.card_pokemon cp
         WHERE cp.card_slug = v.card_slug
           AND cp.species_slug = p_pokemon_slug
      ))
      AND (p_card_name IS NULL OR v.card_name ILIKE '%' || p_card_name || '%')
      AND (p_set_name  IS NULL OR v.set_name  ILIKE '%' || p_set_name  || '%')
      AND (p_language  IS NULL OR v.language  = p_language)
      AND (p_year_min  IS NULL OR v.release_year >= p_year_min)
      AND (p_year_max  IS NULL OR v.release_year <= p_year_max)
      AND (p_raw_min   IS NULL OR v.raw_usd   >= p_raw_min)
      AND (p_raw_max   IS NULL OR v.raw_usd   <= p_raw_max)
      AND (p_psa7_min  IS NULL OR v.psa7_usd  >= p_psa7_min)
      AND (p_psa7_max  IS NULL OR v.psa7_usd  <= p_psa7_max)
      AND (p_psa8_min  IS NULL OR v.psa8_usd  >= p_psa8_min)
      AND (p_psa8_max  IS NULL OR v.psa8_usd  <= p_psa8_max)
      AND (p_psa9_min  IS NULL OR v.psa9_usd  >= p_psa9_min)
      AND (p_psa9_max  IS NULL OR v.psa9_usd  <= p_psa9_max)
      AND (p_psa10_min IS NULL OR v.psa10_usd >= p_psa10_min)
      AND (p_psa10_max IS NULL OR v.psa10_usd <= p_psa10_max)
      AND (p_change_7d_min  IS NULL OR v.raw_pct_7d  >= p_change_7d_min)
      AND (p_change_7d_max  IS NULL OR v.raw_pct_7d  <= p_change_7d_max)
      AND (p_change_30d_min IS NULL OR v.raw_pct_30d >= p_change_30d_min)
      AND (p_change_30d_max IS NULL OR v.raw_pct_30d <= p_change_30d_max)
      AND (p_change_90d_min IS NULL OR v.raw_pct_90d >= p_change_90d_min)
      AND (p_change_90d_max IS NULL OR v.raw_pct_90d <= p_change_90d_max)
      AND (p_psa9_uplift_min    IS NULL OR v.psa9_uplift    >= p_psa9_uplift_min)
      AND (p_psa10_uplift_min   IS NULL OR v.psa10_uplift   >= p_psa10_uplift_min)
      AND (p_psa9_multiple_min  IS NULL OR v.psa9_multiple  >= p_psa9_multiple_min)
      AND (p_psa10_multiple_min IS NULL OR v.psa10_multiple >= p_psa10_multiple_min)
  ),
  paged AS (
    SELECT *
    FROM filtered
    ORDER BY
      CASE WHEN p_sort = 'name_asc'         THEN card_name        END ASC  NULLS LAST,
      CASE WHEN p_sort = 'name_desc'        THEN card_name        END DESC NULLS LAST,
      CASE WHEN p_sort = 'pokemon_asc'      THEN primary_pokemon_slug END ASC NULLS LAST,
      CASE WHEN p_sort = 'set_asc'          THEN set_name         END ASC  NULLS LAST,
      CASE WHEN p_sort = 'release_desc'     THEN set_release_date END DESC NULLS LAST,
      CASE WHEN p_sort = 'release_asc'      THEN set_release_date END ASC  NULLS LAST,
      CASE WHEN p_sort = 'raw_asc'          THEN raw_usd          END ASC  NULLS LAST,
      CASE WHEN p_sort = 'raw_desc'         THEN raw_usd          END DESC NULLS LAST,
      CASE WHEN p_sort = 'psa7_asc'         THEN psa7_usd         END ASC  NULLS LAST,
      CASE WHEN p_sort = 'psa7_desc'        THEN psa7_usd         END DESC NULLS LAST,
      CASE WHEN p_sort = 'psa8_asc'         THEN psa8_usd         END ASC  NULLS LAST,
      CASE WHEN p_sort = 'psa8_desc'        THEN psa8_usd         END DESC NULLS LAST,
      CASE WHEN p_sort = 'psa9_asc'         THEN psa9_usd         END ASC  NULLS LAST,
      CASE WHEN p_sort = 'psa9_desc'        THEN psa9_usd         END DESC NULLS LAST,
      CASE WHEN p_sort = 'psa10_asc'        THEN psa10_usd        END ASC  NULLS LAST,
      CASE WHEN p_sort = 'psa10_desc'       THEN psa10_usd        END DESC NULLS LAST,
      CASE WHEN p_sort = 'change_7d_desc'   THEN raw_pct_7d       END DESC NULLS LAST,
      CASE WHEN p_sort = 'change_7d_asc'    THEN raw_pct_7d       END ASC  NULLS LAST,
      CASE WHEN p_sort = 'change_30d_desc'  THEN raw_pct_30d      END DESC NULLS LAST,
      CASE WHEN p_sort = 'change_30d_asc'   THEN raw_pct_30d      END ASC  NULLS LAST,
      CASE WHEN p_sort = 'change_90d_desc'  THEN raw_pct_90d      END DESC NULLS LAST,
      CASE WHEN p_sort = 'change_90d_asc'   THEN raw_pct_90d      END ASC  NULLS LAST,
      CASE WHEN p_sort = 'psa9_uplift_desc'    THEN psa9_uplift    END DESC NULLS LAST,
      CASE WHEN p_sort = 'psa10_uplift_desc'   THEN psa10_uplift   END DESC NULLS LAST,
      CASE WHEN p_sort = 'psa9_multiple_desc'  THEN psa9_multiple  END DESC NULLS LAST,
      CASE WHEN p_sort = 'psa10_multiple_desc' THEN psa10_multiple END DESC NULLS LAST,
      card_slug ASC
    LIMIT v_lim OFFSET v_off
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY 1), '[]'::jsonb)
  INTO v_rows
  FROM paged p;

  RETURN jsonb_build_object(
    'rows',        COALESCE(v_rows, '[]'::jsonb),
    'total_count', COALESCE(v_total, 0),
    'limit',       v_lim,
    'offset',      v_off,
    'sort',        p_sort
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_cards_deep TO anon, authenticated, service_role;

COMMIT;
