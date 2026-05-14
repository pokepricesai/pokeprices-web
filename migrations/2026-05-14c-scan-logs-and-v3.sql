-- scan-test v3 bundle:
--   1. scan_logs table — every scan is logged so we accumulate labelled
--      data for tuning regexes / weights against real misses.
--   2. scan_card_match v3 — accepts copyright year as an additional signal,
--      adds within-pool ranking so an unambiguous number match gets the
--      "very confident" treatment automatically, and uses year as a soft
--      booster against cards.set_release_date.

-- ── scan_logs ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scan_logs (
  id                    BIGSERIAL PRIMARY KEY,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  feature_used          TEXT,
  vision_full_text      TEXT,
  parsed_signals        JSONB,
  candidates            JSONB,
  top_card_slug         TEXT,
  top_confidence        REAL,
  confirmed_card_slug   TEXT,         -- set when user taps a candidate to confirm
  confirmed_at          TIMESTAMPTZ,
  timing_ms             JSONB
);

CREATE INDEX IF NOT EXISTS idx_scan_logs_created_at ON scan_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scan_logs_confirmed   ON scan_logs (confirmed_card_slug) WHERE confirmed_card_slug IS NOT NULL;

ALTER TABLE scan_logs ENABLE ROW LEVEL SECURITY;
-- Service role inserts/updates; we never read from the client. No anon policies.
DROP POLICY IF EXISTS scan_logs_service_all ON scan_logs;
CREATE POLICY scan_logs_service_all ON scan_logs
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- ── RPC v3 ─────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS scan_card_match(text, text, text);
DROP FUNCTION IF EXISTS scan_card_match(text, text, text, integer);

CREATE OR REPLACE FUNCTION scan_card_match(
  p_collector_number text    DEFAULT NULL,
  p_name             text    DEFAULT NULL,
  p_set_hint         text    DEFAULT NULL,
  p_copyright_year   integer DEFAULT NULL
)
RETURNS TABLE (
  card_slug           text,
  card_name           text,
  clean_name          text,
  set_name            text,
  card_number         text,
  card_number_display text,
  card_url_slug       text,
  image_url           text,
  number_match        boolean,
  name_similarity     real,
  set_match           boolean,
  year_match          boolean,
  pool_size           integer,
  rank_in_pool        integer,
  confidence          real
)
LANGUAGE sql
STABLE
AS $$
  WITH params AS (
    SELECT
      _normalize_card_number(p_collector_number)                      AS num_norm,
      _normalize_card_number(split_part(p_collector_number, '/', 1))  AS num_first_norm,
      NULLIF(trim(p_name),     '')                                    AS nm,
      NULLIF(trim(p_set_hint), '')                                    AS st,
      p_copyright_year                                                AS yr
  ),
  base AS (
    SELECT
      c.card_slug,
      c.card_name,
      regexp_replace(c.card_name, '\s*#[A-Za-z0-9/-]+\s*$', '') AS clean_name,
      c.set_name,
      c.card_number,
      c.card_number_display,
      c.card_url_slug,
      c.image_url,
      c.set_release_date,
      _normalize_card_number(c.card_number)                             AS norm_num,
      _normalize_card_number(c.card_number_display)                     AS norm_num_disp,
      _normalize_card_number(split_part(c.card_number_display, '/', 1)) AS norm_first
    FROM cards c
    WHERE c.is_sealed IS NOT TRUE
  ),
  candidates AS (
    SELECT b.*
    FROM base b, params p
    WHERE p.num_norm IS NOT NULL
      AND (
        b.norm_num      = p.num_norm
        OR b.norm_num_disp = p.num_norm
        OR b.norm_num      = p.num_first_norm
        OR b.norm_first    = p.num_first_norm
      )
    UNION
    SELECT b.*
    FROM base b, params p
    WHERE p.nm IS NOT NULL
      AND lower(b.clean_name) % lower(p.nm)
  ),
  scored AS (
    SELECT
      c.*,
      (
        p.num_norm IS NOT NULL
        AND (
          c.norm_num      = p.num_norm
          OR c.norm_num_disp = p.num_norm
          OR c.norm_num      = p.num_first_norm
          OR c.norm_first    = p.num_first_norm
        )
      ) AS number_match,
      CASE
        WHEN p.nm IS NULL THEN 0::real
        ELSE similarity(lower(c.clean_name), lower(p.nm))
      END AS name_similarity,
      (p.st IS NOT NULL AND c.set_name ILIKE '%' || p.st || '%') AS set_match,
      (
        p.yr IS NOT NULL
        AND c.set_release_date IS NOT NULL
        AND ABS(EXTRACT(YEAR FROM c.set_release_date)::int - p.yr) <= 1
      ) AS year_match
    FROM candidates c, params p
  ),
  -- Pool ranking: within the set of candidates that share number_match=true,
  -- count how many there are and rank them by name similarity. If only one
  -- card matches the number, that's an unambiguous hit; bigger pools need
  -- name to disambiguate.
  pooled AS (
    SELECT
      s.*,
      COUNT(*)        FILTER (WHERE s.number_match) OVER (PARTITION BY s.number_match) AS pool_size_raw,
      DENSE_RANK() OVER (PARTITION BY s.number_match ORDER BY s.name_similarity DESC)  AS rank_in_pool_raw
    FROM scored s
  ),
  with_base AS (
    SELECT
      pl.*,
      CASE
        -- Unambiguous number match: only one card in the DB has this number.
        WHEN pl.number_match AND pl.pool_size_raw = 1 THEN 0.94::real
        -- Number match + clear name: very confident.
        WHEN pl.number_match AND pl.name_similarity >= 0.45 THEN 0.86::real + 0.12::real * pl.name_similarity
        -- Number match, smallish variant pool, this is the best-named in it.
        WHEN pl.number_match AND pl.rank_in_pool_raw = 1 AND pl.pool_size_raw <= 4 THEN 0.82::real
        -- Number match, weak name.
        WHEN pl.number_match AND pl.name_similarity >= 0.25 THEN 0.74::real + 0.16::real * pl.name_similarity
        -- Number match, no name signal.
        WHEN pl.number_match THEN 0.70::real
        -- Name-only fallback (capped below the number floor).
        WHEN pl.name_similarity >= 0.60 THEN 0.40::real + 0.25::real * pl.name_similarity
        ELSE                                 0.10::real + 0.30::real * pl.name_similarity
      END AS base_score
    FROM pooled pl
  )
  SELECT
    w.card_slug, w.card_name, w.clean_name, w.set_name,
    w.card_number, w.card_number_display, w.card_url_slug, w.image_url,
    w.number_match, w.name_similarity, w.set_match,
    w.year_match,
    w.pool_size_raw::int     AS pool_size,
    w.rank_in_pool_raw::int  AS rank_in_pool,
    LEAST(
      1.0::real,
      w.base_score
        + (CASE WHEN w.set_match  THEN 0.04::real ELSE 0::real END)
        + (CASE WHEN w.year_match THEN 0.04::real ELSE 0::real END)
    ) AS confidence
  FROM with_base w
  ORDER BY confidence DESC, w.name_similarity DESC, w.card_name ASC
  LIMIT 8;
$$;

GRANT EXECUTE ON FUNCTION scan_card_match(text, text, text, integer) TO anon;
GRANT EXECUTE ON FUNCTION scan_card_match(text, text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION scan_card_match(text, text, text, integer) TO service_role;
