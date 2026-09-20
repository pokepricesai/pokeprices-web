-- migrations/2026-09-20-seo-opportunities-rpcs.sql
-- ============================================================================
-- SEO Mission Control — Stage 4B · deterministic opportunity queues V1.
--
-- Adds four read-only helper functions used exclusively by /admin/seo's
-- Opportunities panel:
--
--   seo_admin_ctr_gold_candidates(...)      → up to N candidates
--   seo_admin_ctr_gold_summary(...)         → single-row summary
--   seo_admin_ranking_push_candidates(...)  → up to N candidates
--   seo_admin_ranking_push_summary(...)     → single-row summary
--
-- All four share the same "base filtered set" logic:
--   1. Canonicalise seo_page_rollups URLs via seo_admin_canonical_url()
--      (mirror of the loader/registry rule).
--   2. Sum clicks/impressions/sum_position across raw variants.
--   3. Inner-join with seo_pages (drops unmatched anomalies).
--   4. Require in_sitemap = TRUE and NOT is_indexable_now = FALSE
--      (NULL is_indexable_now is allowed for non-card page types).
--   5. Exclude non-public page types (dashboard/auth/quick_price/grading).
--   6. Optionally filter to a single page_type.
--
-- Then queue-specific rules layer on top:
--
--   CTR GOLD (V1 deterministic rule)
--     impressions_28d       >= p_min_impressions      -- default 100
--     avg_position_28d      <= p_max_position         -- default 10
--     ctr_28d               <  p_max_ctr              -- default 0.005 (0.50%)
--
--     Zero-click candidates are a subset of this (clicks_28d = 0). The
--     summary RPC reports them separately so the UI can highlight them.
--
--   RANKING PUSH (V1 deterministic rule)
--     impressions_28d       >= p_min_impressions      -- default 50
--     avg_position_28d      >  p_min_position         -- default > 10
--     avg_position_28d      <= p_max_position         -- default 20
--
--     Summary RPC reports position-cohort breakdowns (10-15, 15-20).
--
-- No schema mutations. No new tables. STABLE, read-only functions.
-- CTR is derived (clicks / impressions); avg_position is derived
-- ((sum_position / impressions) + 1) — same weighting as the rest of
-- Mission Control.
-- ============================================================================

BEGIN;

-- ── CTR Gold — candidates ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.seo_admin_ctr_gold_candidates(
  p_site_key         text             DEFAULT 'pokeprices',
  p_source           text             DEFAULT 'google',
  p_min_impressions  integer          DEFAULT 100,
  p_max_position     double precision DEFAULT 10.0,
  p_max_ctr          double precision DEFAULT 0.005,
  p_page_type        text             DEFAULT NULL,
  p_limit            integer          DEFAULT 50,
  p_offset           integer          DEFAULT 0
)
RETURNS TABLE (
  url                 text,
  page_type           text,
  entity_id           text,
  raw_variant_count   integer,
  impressions_28d     bigint,
  clicks_28d          bigint,
  sum_position_28d    double precision,
  ctr_28d             double precision,
  avg_position_28d    double precision,
  in_sitemap          boolean,
  is_indexable_now    boolean
)
LANGUAGE plpgsql STABLE
AS $$
BEGIN
  RETURN QUERY
  WITH canonical_rollups AS (
    SELECT
      COALESCE(public.seo_admin_canonical_url(pr.url), pr.url) AS canonical_url,
      COUNT(*)::integer                              AS variant_count,
      SUM(pr.clicks_28d)::bigint                      AS c28,
      SUM(pr.impressions_28d)::bigint                 AS i28,
      SUM(pr.sum_position_28d)::double precision      AS sp28
    FROM public.seo_page_rollups pr
    WHERE pr.site_key = p_site_key
      AND pr.source   = p_source
    GROUP BY COALESCE(public.seo_admin_canonical_url(pr.url), pr.url)
  ),
  filtered AS (
    SELECT
      cr.canonical_url,
      p.page_type,
      p.entity_id,
      cr.variant_count,
      cr.i28,
      cr.c28,
      cr.sp28,
      p.in_sitemap,
      p.is_indexable_now,
      (cr.c28::double precision  / NULLIF(cr.i28, 0)::double precision)                AS ctr,
      (cr.sp28                    / NULLIF(cr.i28, 0)::double precision) + 1           AS avg_pos
    FROM canonical_rollups cr
    INNER JOIN public.seo_pages p
      ON p.site_key = p_site_key
     AND p.url      = cr.canonical_url
    WHERE p.in_sitemap = TRUE
      AND (p.is_indexable_now IS NULL OR p.is_indexable_now = TRUE)
      AND p.page_type NOT IN ('dashboard', 'auth', 'quick_price', 'grading')
      AND (p_page_type IS NULL OR p.page_type = p_page_type)
      AND cr.i28 >= p_min_impressions
  )
  SELECT
    f.canonical_url::text  AS url,
    f.page_type::text      AS page_type,
    f.entity_id::text      AS entity_id,
    f.variant_count        AS raw_variant_count,
    f.i28                  AS impressions_28d,
    f.c28                  AS clicks_28d,
    f.sp28                 AS sum_position_28d,
    f.ctr                  AS ctr_28d,
    f.avg_pos              AS avg_position_28d,
    f.in_sitemap           AS in_sitemap,
    f.is_indexable_now     AS is_indexable_now
  FROM filtered f
  WHERE f.avg_pos <= p_max_position
    AND (f.ctr IS NULL OR f.ctr < p_max_ctr)
  ORDER BY f.i28 DESC, f.avg_pos ASC
  LIMIT p_limit
  OFFSET GREATEST(p_offset, 0);
END;
$$;
COMMENT ON FUNCTION public.seo_admin_ctr_gold_candidates(text, text, integer, double precision, double precision, text, integer, integer) IS
  'V1 CTR Gold queue: canonical pages with ≥ min impressions, avg_position ≤ max_position, and CTR < max_ctr. Sorted by impressions DESC, avg_position ASC. Excludes non-public page types, non-sitemap pages, and pages explicitly flagged non-indexable.';

-- ── CTR Gold — summary ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.seo_admin_ctr_gold_summary(
  p_site_key         text             DEFAULT 'pokeprices',
  p_source           text             DEFAULT 'google',
  p_min_impressions  integer          DEFAULT 100,
  p_max_position     double precision DEFAULT 10.0,
  p_max_ctr          double precision DEFAULT 0.005,
  p_page_type        text             DEFAULT NULL
)
RETURNS TABLE (
  candidate_count         integer,
  total_impressions_28d   bigint,
  total_clicks_28d        bigint,
  zero_click_count        integer,
  zero_click_impressions  bigint,
  by_page_type            jsonb
)
LANGUAGE plpgsql STABLE
AS $$
BEGIN
  RETURN QUERY
  WITH canonical_rollups AS (
    SELECT
      COALESCE(public.seo_admin_canonical_url(pr.url), pr.url) AS canonical_url,
      SUM(pr.clicks_28d)::bigint                      AS c28,
      SUM(pr.impressions_28d)::bigint                 AS i28,
      SUM(pr.sum_position_28d)::double precision      AS sp28
    FROM public.seo_page_rollups pr
    WHERE pr.site_key = p_site_key
      AND pr.source   = p_source
    GROUP BY COALESCE(public.seo_admin_canonical_url(pr.url), pr.url)
  ),
  filtered AS (
    SELECT
      cr.i28, cr.c28,
      p.page_type,
      (cr.c28::double precision / NULLIF(cr.i28, 0)::double precision) AS ctr,
      (cr.sp28                   / NULLIF(cr.i28, 0)::double precision) + 1 AS avg_pos
    FROM canonical_rollups cr
    INNER JOIN public.seo_pages p
      ON p.site_key = p_site_key
     AND p.url      = cr.canonical_url
    WHERE p.in_sitemap = TRUE
      AND (p.is_indexable_now IS NULL OR p.is_indexable_now = TRUE)
      AND p.page_type NOT IN ('dashboard', 'auth', 'quick_price', 'grading')
      AND (p_page_type IS NULL OR p.page_type = p_page_type)
      AND cr.i28 >= p_min_impressions
  ),
  gated AS (
    SELECT *
    FROM filtered
    WHERE avg_pos <= p_max_position
      AND (ctr IS NULL OR ctr < p_max_ctr)
  ),
  breakdown AS (
    SELECT page_type::text AS pt, COUNT(*)::integer AS n
    FROM gated
    GROUP BY page_type
    ORDER BY COUNT(*) DESC
  )
  SELECT
    (SELECT COUNT(*)::integer                                       FROM gated) AS candidate_count,
    COALESCE((SELECT SUM(i28)::bigint                                FROM gated), 0) AS total_impressions_28d,
    COALESCE((SELECT SUM(c28)::bigint                                FROM gated), 0) AS total_clicks_28d,
    (SELECT COUNT(*)::integer          FROM gated WHERE c28 = 0)                     AS zero_click_count,
    COALESCE((SELECT SUM(i28)::bigint  FROM gated WHERE c28 = 0), 0)                 AS zero_click_impressions,
    (SELECT COALESCE(jsonb_object_agg(pt, n), '{}'::jsonb) FROM breakdown)           AS by_page_type;
END;
$$;
COMMENT ON FUNCTION public.seo_admin_ctr_gold_summary(text, text, integer, double precision, double precision, text) IS
  'Single-row summary of the CTR Gold queue under the supplied thresholds. Includes zero-click subset counts and per-page-type breakdown.';

-- ── Ranking Push — candidates ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.seo_admin_ranking_push_candidates(
  p_site_key         text             DEFAULT 'pokeprices',
  p_source           text             DEFAULT 'google',
  p_min_impressions  integer          DEFAULT 50,
  p_min_position     double precision DEFAULT 10.0,
  p_max_position     double precision DEFAULT 20.0,
  p_page_type        text             DEFAULT NULL,
  p_limit            integer          DEFAULT 50,
  p_offset           integer          DEFAULT 0
)
RETURNS TABLE (
  url                 text,
  page_type           text,
  entity_id           text,
  raw_variant_count   integer,
  impressions_28d     bigint,
  clicks_28d          bigint,
  sum_position_28d    double precision,
  ctr_28d             double precision,
  avg_position_28d    double precision,
  in_sitemap          boolean,
  is_indexable_now    boolean
)
LANGUAGE plpgsql STABLE
AS $$
BEGIN
  RETURN QUERY
  WITH canonical_rollups AS (
    SELECT
      COALESCE(public.seo_admin_canonical_url(pr.url), pr.url) AS canonical_url,
      COUNT(*)::integer                              AS variant_count,
      SUM(pr.clicks_28d)::bigint                      AS c28,
      SUM(pr.impressions_28d)::bigint                 AS i28,
      SUM(pr.sum_position_28d)::double precision      AS sp28
    FROM public.seo_page_rollups pr
    WHERE pr.site_key = p_site_key
      AND pr.source   = p_source
    GROUP BY COALESCE(public.seo_admin_canonical_url(pr.url), pr.url)
  ),
  filtered AS (
    SELECT
      cr.canonical_url,
      p.page_type,
      p.entity_id,
      cr.variant_count,
      cr.i28,
      cr.c28,
      cr.sp28,
      p.in_sitemap,
      p.is_indexable_now,
      (cr.c28::double precision / NULLIF(cr.i28, 0)::double precision)     AS ctr,
      (cr.sp28                   / NULLIF(cr.i28, 0)::double precision) + 1 AS avg_pos
    FROM canonical_rollups cr
    INNER JOIN public.seo_pages p
      ON p.site_key = p_site_key
     AND p.url      = cr.canonical_url
    WHERE p.in_sitemap = TRUE
      AND (p.is_indexable_now IS NULL OR p.is_indexable_now = TRUE)
      AND p.page_type NOT IN ('dashboard', 'auth', 'quick_price', 'grading')
      AND (p_page_type IS NULL OR p.page_type = p_page_type)
      AND cr.i28 >= p_min_impressions
  )
  SELECT
    f.canonical_url::text,
    f.page_type::text,
    f.entity_id::text,
    f.variant_count,
    f.i28,
    f.c28,
    f.sp28,
    f.ctr,
    f.avg_pos,
    f.in_sitemap,
    f.is_indexable_now
  FROM filtered f
  WHERE f.avg_pos >  p_min_position
    AND f.avg_pos <= p_max_position
  ORDER BY f.i28 DESC, f.avg_pos ASC
  LIMIT p_limit
  OFFSET GREATEST(p_offset, 0);
END;
$$;
COMMENT ON FUNCTION public.seo_admin_ranking_push_candidates(text, text, integer, double precision, double precision, text, integer, integer) IS
  'V1 Ranking Push queue: canonical pages with ≥ min impressions and avg_position in (min_position, max_position]. Sorted by impressions DESC, avg_position ASC.';

-- ── Ranking Push — summary ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.seo_admin_ranking_push_summary(
  p_site_key         text             DEFAULT 'pokeprices',
  p_source           text             DEFAULT 'google',
  p_min_impressions  integer          DEFAULT 50,
  p_min_position     double precision DEFAULT 10.0,
  p_max_position     double precision DEFAULT 20.0,
  p_page_type        text             DEFAULT NULL
)
RETURNS TABLE (
  candidate_count          integer,
  total_impressions_28d    bigint,
  total_clicks_28d         bigint,
  position_10_to_15_count  integer,
  position_15_to_20_count  integer,
  by_page_type             jsonb
)
LANGUAGE plpgsql STABLE
AS $$
BEGIN
  RETURN QUERY
  WITH canonical_rollups AS (
    SELECT
      COALESCE(public.seo_admin_canonical_url(pr.url), pr.url) AS canonical_url,
      SUM(pr.clicks_28d)::bigint                      AS c28,
      SUM(pr.impressions_28d)::bigint                 AS i28,
      SUM(pr.sum_position_28d)::double precision      AS sp28
    FROM public.seo_page_rollups pr
    WHERE pr.site_key = p_site_key
      AND pr.source   = p_source
    GROUP BY COALESCE(public.seo_admin_canonical_url(pr.url), pr.url)
  ),
  filtered AS (
    SELECT
      cr.i28, cr.c28,
      p.page_type,
      (cr.sp28 / NULLIF(cr.i28, 0)::double precision) + 1 AS avg_pos
    FROM canonical_rollups cr
    INNER JOIN public.seo_pages p
      ON p.site_key = p_site_key
     AND p.url      = cr.canonical_url
    WHERE p.in_sitemap = TRUE
      AND (p.is_indexable_now IS NULL OR p.is_indexable_now = TRUE)
      AND p.page_type NOT IN ('dashboard', 'auth', 'quick_price', 'grading')
      AND (p_page_type IS NULL OR p.page_type = p_page_type)
      AND cr.i28 >= p_min_impressions
  ),
  gated AS (
    SELECT *
    FROM filtered
    WHERE avg_pos >  p_min_position
      AND avg_pos <= p_max_position
  ),
  breakdown AS (
    SELECT page_type::text AS pt, COUNT(*)::integer AS n
    FROM gated
    GROUP BY page_type
    ORDER BY COUNT(*) DESC
  )
  SELECT
    (SELECT COUNT(*)::integer                                       FROM gated)                                       AS candidate_count,
    COALESCE((SELECT SUM(i28)::bigint                                FROM gated), 0)                                   AS total_impressions_28d,
    COALESCE((SELECT SUM(c28)::bigint                                FROM gated), 0)                                   AS total_clicks_28d,
    (SELECT COUNT(*)::integer          FROM gated WHERE avg_pos >  10 AND avg_pos <= 15)                               AS position_10_to_15_count,
    (SELECT COUNT(*)::integer          FROM gated WHERE avg_pos >  15 AND avg_pos <= 20)                               AS position_15_to_20_count,
    (SELECT COALESCE(jsonb_object_agg(pt, n), '{}'::jsonb) FROM breakdown)                                             AS by_page_type;
END;
$$;
COMMENT ON FUNCTION public.seo_admin_ranking_push_summary(text, text, integer, double precision, double precision, text) IS
  'Single-row summary of the Ranking Push queue under the supplied thresholds. Includes position cohorts (10–15, 15–20) and per-page-type breakdown.';

COMMIT;
