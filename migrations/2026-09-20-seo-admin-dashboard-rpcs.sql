-- migrations/2026-09-20-seo-admin-dashboard-rpcs.sql
-- ============================================================================
-- SEO Mission Control — Stage 4A performance follow-up.
-- Adds five read-only helper functions used exclusively by /admin/seo:
--
--   seo_admin_canonical_url(text)            → text
--   seo_admin_daily_totals(...)              → per-date totals
--   seo_admin_page_type_28d(...)             → per-page-type aggregates
--   seo_admin_top_pages(..., limit int)      → top N canonical pages
--   seo_admin_visibility_28d(...)            → single-row visibility counts
--
-- Rationale
--   The pre-Stage-4A loader paginated four base tables and aggregated in
--   Node.js — ~329 Supabase requests and ~322k rows transferred per cold
--   render, ~57 seconds wall-clock. These functions replace that with
--   Postgres-side aggregation returning compact result sets (30 / 15 /
--   20 / 1 row respectively). All five are STABLE and read-only.
--
-- No production data model changes. No schema mutations. No PostgREST
-- aggregate feature is enabled globally; the aggregation is inside
-- named functions the dashboard invokes via `supabase.rpc()`.
--
-- Canonicalisation rules mirror scripts/seo/refresh-page-registry.mjs
-- exactly:
--   - force https://www.pokeprices.io
--   - drop query string and fragment
--   - strip trailing slash except for the root '/'
-- URLs on other hosts return NULL and fall into the 'unmatched' bucket.
-- ============================================================================

BEGIN;

-- ── Canonical URL helper ────────────────────────────────────────────────────
-- Immutable, deterministic, safe to inline. Returns NULL on unparseable /
-- foreign-host input so callers can drop those rows or bucket them.
CREATE OR REPLACE FUNCTION public.seo_admin_canonical_url(u text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  s text := u;
BEGIN
  IF s IS NULL OR s = '' THEN
    RETURN NULL;
  END IF;
  -- Only fold URLs on our two known hosts. Anything else is not ours.
  IF s !~ '^https?://(www\.)?pokeprices\.io(/|$|\?|#)' THEN
    RETURN NULL;
  END IF;
  -- Force https + www.
  s := regexp_replace(s, '^https?://(www\.)?pokeprices\.io', 'https://www.pokeprices.io');
  -- Strip query and fragment.
  s := regexp_replace(s, '[#?].*$', '');
  -- Strip trailing slash except on the root.
  IF s <> 'https://www.pokeprices.io/' AND right(s, 1) = '/' THEN
    s := left(s, length(s) - 1);
  END IF;
  RETURN s;
END;
$$;
COMMENT ON FUNCTION public.seo_admin_canonical_url(text) IS
  'Mirror of the canonicaliseUrl helper used in scripts/seo/refresh-page-registry.mjs. IMMUTABLE. Returns NULL for foreign hosts / unparseable input.';

-- ── A · Daily totals RPC ────────────────────────────────────────────────────
-- One row per date across the requested window. Returns ~30 rows for the
-- current 29-day history — down from ~161k rows the previous paged read
-- transferred to compute the same thing.
CREATE OR REPLACE FUNCTION public.seo_admin_daily_totals(
  p_site_key text DEFAULT 'pokeprices',
  p_source   text DEFAULT 'google',
  p_start    date DEFAULT NULL,   -- NULL = all available history
  p_end      date DEFAULT NULL
)
RETURNS TABLE (
  d            date,
  impressions  bigint,
  clicks       bigint,
  sum_position double precision
)
LANGUAGE sql STABLE
AS $$
  SELECT
    date AS d,
    SUM(impressions)::bigint            AS impressions,
    SUM(clicks)::bigint                 AS clicks,
    SUM(sum_position)::double precision AS sum_position
  FROM public.seo_gsc_page_daily
  WHERE site_key = p_site_key
    AND source   = p_source
    AND (p_start IS NULL OR date >= p_start)
    AND (p_end   IS NULL OR date <= p_end)
  GROUP BY date
  ORDER BY date ASC;
$$;
COMMENT ON FUNCTION public.seo_admin_daily_totals(text, text, date, date) IS
  'Per-date site totals from seo_gsc_page_daily. Returns one row per date; empty when no data in window.';

-- ── B · Page-type performance RPC ───────────────────────────────────────────
-- Canonicalises rollup URLs, dedups variants, joins with seo_pages.page_type,
-- and aggregates. Returns one row per page_type (plus an 'unmatched' bucket
-- for canonical URLs the registry does not know about). Registry page_types
-- with no rollup activity are included with zero visibility metrics so the
-- "known URLs" column remains honest.
CREATE OR REPLACE FUNCTION public.seo_admin_page_type_28d(
  p_site_key text DEFAULT 'pokeprices',
  p_source   text DEFAULT 'google'
)
RETURNS TABLE (
  page_type          text,
  urls_known         integer,
  urls_visible_28d   integer,
  clicks_28d         bigint,
  impressions_28d    bigint,
  sum_position_28d   double precision,
  productive_28d     integer
)
LANGUAGE plpgsql STABLE
AS $$
BEGIN
  RETURN QUERY
  WITH
  canonical_rollups AS (
    SELECT
      COALESCE(public.seo_admin_canonical_url(pr.url), pr.url) AS canonical_url,
      SUM(pr.clicks_28d)::bigint                               AS c28,
      SUM(pr.impressions_28d)::bigint                          AS i28,
      SUM(pr.sum_position_28d)::double precision               AS sp28
    FROM public.seo_page_rollups pr
    WHERE pr.site_key = p_site_key
      AND pr.source   = p_source
    GROUP BY COALESCE(public.seo_admin_canonical_url(pr.url), pr.url)
  ),
  joined AS (
    SELECT
      COALESCE(p.page_type, 'unmatched') AS pt,
      cr.c28,
      cr.i28,
      cr.sp28
    FROM canonical_rollups cr
    LEFT JOIN public.seo_pages p
      ON p.site_key = p_site_key
     AND p.url      = cr.canonical_url
  ),
  known_by_type AS (
    SELECT p.page_type::text AS pt, COUNT(*)::integer AS known
    FROM public.seo_pages p
    WHERE p.site_key = p_site_key
    GROUP BY p.page_type
  ),
  agg AS (
    SELECT
      pt,
      COUNT(*)   FILTER (WHERE i28 > 0)::integer AS visible,
      SUM(c28)::bigint                            AS clicks,
      SUM(i28)::bigint                            AS impressions,
      SUM(sp28)::double precision                 AS sum_pos,
      COUNT(*)   FILTER (WHERE c28 >= 28)::integer AS productive
    FROM joined
    GROUP BY pt
  ),
  all_types AS (
    SELECT pt FROM agg
    UNION
    SELECT pt FROM known_by_type
  )
  SELECT
    at.pt::text                                AS page_type,
    COALESCE(k.known, 0)::integer              AS urls_known,
    COALESCE(a.visible, 0)::integer            AS urls_visible_28d,
    COALESCE(a.clicks, 0)::bigint              AS clicks_28d,
    COALESCE(a.impressions, 0)::bigint         AS impressions_28d,
    COALESCE(a.sum_pos, 0)::double precision   AS sum_position_28d,
    COALESCE(a.productive, 0)::integer         AS productive_28d
  FROM all_types at
  LEFT JOIN known_by_type k ON k.pt = at.pt
  LEFT JOIN agg           a ON a.pt = at.pt
  ORDER BY COALESCE(a.clicks, 0) DESC, COALESCE(a.impressions, 0) DESC;
END;
$$;
COMMENT ON FUNCTION public.seo_admin_page_type_28d(text, text) IS
  'Per-page-type 28d aggregates using canonicalised + deduped rollup URLs. Unmatched canonical URLs go into an ''unmatched'' bucket. Registry page_types with no rollup activity appear with zero metrics.';

-- ── C · Top pages RPC ───────────────────────────────────────────────────────
-- Canonicalises + dedups rollups, ranks by 28d clicks (then impressions),
-- returns the top N canonical pages enriched with page_type / entity_id.
-- Also returns `raw_variant_count` so the UI can flag pages whose canonical
-- form absorbed multiple GSC raw URL variants.
CREATE OR REPLACE FUNCTION public.seo_admin_top_pages(
  p_site_key text DEFAULT 'pokeprices',
  p_source   text DEFAULT 'google',
  p_limit    int  DEFAULT 20
)
RETURNS TABLE (
  url                 text,
  page_type           text,
  entity_id           text,
  raw_variant_count   integer,
  clicks_28d          bigint,
  impressions_28d     bigint,
  sum_position_28d    double precision,
  productive_28d      boolean
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
  )
  SELECT
    cr.canonical_url::text                    AS url,
    COALESCE(p.page_type, 'unmatched')::text  AS page_type,
    p.entity_id::text                         AS entity_id,
    cr.variant_count                          AS raw_variant_count,
    cr.c28                                     AS clicks_28d,
    cr.i28                                     AS impressions_28d,
    cr.sp28                                    AS sum_position_28d,
    (cr.c28 >= 28)                             AS productive_28d
  FROM canonical_rollups cr
  LEFT JOIN public.seo_pages p
    ON p.site_key = p_site_key
   AND p.url      = cr.canonical_url
  ORDER BY cr.c28 DESC, cr.i28 DESC
  LIMIT p_limit;
END;
$$;
COMMENT ON FUNCTION public.seo_admin_top_pages(text, text, int) IS
  'Top-N canonical pages by 28d clicks. Enriches with page_type/entity_id from seo_pages; unmatched canonical URLs get page_type=''unmatched''.';

-- ── D · Visibility + reconciliation RPC ────────────────────────────────────
-- Single-row response — every count the /admin/seo dashboard needs for its
-- visibility gap section AND for the reconciliation panel. Computed as a
-- single query in Postgres so the dashboard does not have to page tens of
-- thousands of rows.
CREATE OR REPLACE FUNCTION public.seo_admin_visibility_28d(
  p_site_key text DEFAULT 'pokeprices',
  p_source   text DEFAULT 'google'
)
RETURNS TABLE (
  -- Canonical page counts (registry-side)
  known_urls                       integer,
  sitemap_urls                     integer,
  canonical_zero_visibility        integer,
  sitemap_zero_visibility          integer,
  canonical_visible_pages          integer,
  canonical_visible_no_clicks      integer,
  canonical_ge1_click              integer,
  canonical_ge10_click             integer,
  canonical_productive             integer,
  -- Rollup / canonicalisation stats (for reconciliation panel)
  rollup_row_count                 integer,
  canonical_url_count              integer,
  canonicalisation_failures        integer,
  rollup_clicks_28d                bigint,
  rollup_impressions_28d           bigint,
  rollup_visible_28d               integer,
  rollup_productive_28d            integer,
  page_lookup_fails                integer,
  unmatched_visible_28d            integer,
  unmatched_clicks_28d             bigint,
  unmatched_impressions_28d        bigint
)
LANGUAGE plpgsql STABLE
AS $$
BEGIN
  RETURN QUERY
  WITH
  canonical_rollups AS (
    SELECT
      COALESCE(public.seo_admin_canonical_url(pr.url), pr.url) AS canonical_url,
      -- Track whether canonicalisation failed for this canonical bucket
      -- (i.e. every raw URL in the group failed to parse to a canonical).
      BOOL_AND(public.seo_admin_canonical_url(pr.url) IS NULL) AS canon_failed,
      SUM(pr.clicks_28d)::bigint                               AS c28,
      SUM(pr.impressions_28d)::bigint                          AS i28
    FROM public.seo_page_rollups pr
    WHERE pr.site_key = p_site_key
      AND pr.source   = p_source
    GROUP BY COALESCE(public.seo_admin_canonical_url(pr.url), pr.url)
  ),
  joined AS (
    SELECT
      cr.canonical_url,
      cr.c28,
      cr.i28,
      cr.canon_failed,
      p.url AS page_url
    FROM canonical_rollups cr
    LEFT JOIN public.seo_pages p
      ON p.site_key = p_site_key
     AND p.url      = cr.canonical_url
  ),
  rollup_row_stats AS (
    SELECT COUNT(*)::integer AS n_rows
    FROM public.seo_page_rollups
    WHERE site_key = p_site_key AND source = p_source
  ),
  canon_agg AS (
    SELECT
      COUNT(*)::integer                             AS canon_count,
      COUNT(*) FILTER (WHERE canon_failed)::integer AS canon_failed_count,
      SUM(c28)::bigint                              AS clicks_28d,
      SUM(i28)::bigint                              AS impressions_28d,
      COUNT(*) FILTER (WHERE i28 > 0)::integer      AS visible_28d,
      COUNT(*) FILTER (WHERE c28 >= 28)::integer    AS productive_28d
    FROM canonical_rollups
  ),
  join_agg AS (
    SELECT
      COUNT(*) FILTER (WHERE page_url IS NULL)::integer            AS lookup_fails,
      COUNT(*) FILTER (WHERE page_url IS NULL AND i28 > 0)::integer AS unmatched_visible,
      COALESCE(SUM(c28) FILTER (WHERE page_url IS NULL), 0)::bigint AS unmatched_clicks,
      COALESCE(SUM(i28) FILTER (WHERE page_url IS NULL), 0)::bigint AS unmatched_imp,
      COUNT(*) FILTER (WHERE i28 > 0)::integer                       AS visible,
      COUNT(*) FILTER (WHERE i28 > 0 AND c28 = 0)::integer           AS visible_no_clicks,
      COUNT(*) FILTER (WHERE c28 >= 1)::integer                      AS ge1,
      COUNT(*) FILTER (WHERE c28 >= 10)::integer                     AS ge10,
      COUNT(*) FILTER (WHERE c28 >= 28)::integer                     AS productive
    FROM joined
  ),
  pages_agg AS (
    SELECT
      COUNT(*)::integer                                    AS known_urls,
      COUNT(*) FILTER (WHERE in_sitemap)::integer          AS sitemap_urls
    FROM public.seo_pages
    WHERE site_key = p_site_key
  ),
  pages_zero_vis AS (
    SELECT
      COUNT(*)::integer                              AS zero_vis,
      COUNT(*) FILTER (WHERE p.in_sitemap)::integer  AS sitemap_zero_vis
    FROM public.seo_pages p
    WHERE p.site_key = p_site_key
      AND NOT EXISTS (
        SELECT 1 FROM canonical_rollups cr
        WHERE cr.canonical_url = p.url AND cr.i28 > 0
      )
  )
  SELECT
    pa.known_urls,
    pa.sitemap_urls,
    pzv.zero_vis           AS canonical_zero_visibility,
    pzv.sitemap_zero_vis   AS sitemap_zero_visibility,
    ja.visible             AS canonical_visible_pages,
    ja.visible_no_clicks   AS canonical_visible_no_clicks,
    ja.ge1                 AS canonical_ge1_click,
    ja.ge10                AS canonical_ge10_click,
    ja.productive          AS canonical_productive,
    rr.n_rows              AS rollup_row_count,
    ca.canon_count         AS canonical_url_count,
    ca.canon_failed_count  AS canonicalisation_failures,
    ca.clicks_28d          AS rollup_clicks_28d,
    ca.impressions_28d     AS rollup_impressions_28d,
    ca.visible_28d         AS rollup_visible_28d,
    ca.productive_28d      AS rollup_productive_28d,
    ja.lookup_fails        AS page_lookup_fails,
    ja.unmatched_visible   AS unmatched_visible_28d,
    ja.unmatched_clicks    AS unmatched_clicks_28d,
    ja.unmatched_imp       AS unmatched_impressions_28d
  FROM pages_agg pa, pages_zero_vis pzv, join_agg ja, canon_agg ca, rollup_row_stats rr;
END;
$$;
COMMENT ON FUNCTION public.seo_admin_visibility_28d(text, text) IS
  'Single-row visibility + reconciliation snapshot for /admin/seo. Every count computed in-database from the canonical-deduped rollup + seo_pages join.';

COMMIT;
