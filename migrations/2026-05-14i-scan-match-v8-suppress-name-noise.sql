-- scan_card_match v8: suppress name_only matches whenever ANY number match
-- exists.
--
-- Scenario: scanned 016/165, right card returned, but 106/165 also appeared
-- in lower matches because Vision's read of the name fuzzy-matched a
-- different card in the same set with a different numerator. That is pure
-- noise — if we have any candidate whose number matched, the name path is
-- supplementary at best and misleading at worst.
--
-- New rule on top of v7:
--   if any candidate has number_match = true, exclude all match_quality =
--   'name_only' rows. The name path stays alive only as a true fallback
--   for scans where Vision could not read the number at all.

DROP FUNCTION IF EXISTS scan_card_match(text, text, text, integer, boolean);

CREATE OR REPLACE FUNCTION scan_card_match(
  p_collector_number text    DEFAULT NULL,
  p_name             text    DEFAULT NULL,
  p_set_hint         text    DEFAULT NULL,
  p_copyright_year   integer DEFAULT NULL,
  p_is_promo         boolean DEFAULT FALSE
)
RETURNS TABLE (
  card_slug           text,
  card_name           text,
  clean_name          text,
  set_name            text,
  card_number         text,
  card_number_display text,
  set_printed_total   text,
  card_url_slug       text,
  image_url           text,
  match_quality       text,
  number_match        boolean,
  denom_match         boolean,
  promo_match         boolean,
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
      _normalize_card_number(p_collector_number)                              AS num_full,
      _normalize_card_number(split_part(p_collector_number, '/', 1))          AS num_numerator,
      NULLIF(_normalize_card_number(split_part(p_collector_number, '/', 2)), '') AS num_denom,
      NULLIF(trim(p_name),     '')                                            AS nm,
      NULLIF(trim(p_set_hint), '')                                            AS st,
      p_copyright_year                                                        AS yr,
      COALESCE(p_is_promo, FALSE)                                             AS is_promo
  ),
  base AS (
    SELECT
      c.card_slug,
      c.card_name,
      regexp_replace(c.card_name, '\s*#[A-Za-z0-9/-]+\s*$', '') AS clean_name,
      c.set_name,
      c.card_number,
      c.card_number_display,
      c.set_printed_total,
      c.card_url_slug,
      c.image_url,
      c.set_release_date,
      _normalize_card_number(c.card_number)                             AS norm_num,
      _normalize_card_number(c.card_number_display)                     AS norm_num_disp,
      _normalize_card_number(split_part(c.card_number_display, '/', 1)) AS norm_disp_first,
      _normalize_card_number(c.set_printed_total)                       AS norm_total,
      (c.set_name ILIKE '%promo%')                                      AS is_promo_set
    FROM cards c
    WHERE c.is_sealed IS NOT TRUE
  ),
  candidates AS (
    SELECT b.*
    FROM base b, params p
    WHERE p.num_full IS NOT NULL
      AND (
        b.norm_num         = p.num_numerator
        OR b.norm_disp_first = p.num_numerator
        OR b.norm_num_disp   = p.num_full
      )
      AND (
        p.num_denom IS NULL
        OR b.norm_total = p.num_denom
        OR b.norm_total IS NULL
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
        p.num_full IS NOT NULL
        AND (
          c.norm_num         = p.num_numerator
          OR c.norm_disp_first = p.num_numerator
          OR c.norm_num_disp   = p.num_full
        )
      ) AS number_match,
      (
        p.num_denom IS NOT NULL
        AND c.norm_total = p.num_denom
      ) AS denom_match,
      (p.is_promo AND c.is_promo_set) AS promo_match,
      CASE
        WHEN p.num_full IS NOT NULL AND c.norm_num_disp = p.num_full
          THEN 'full'
        WHEN p.num_denom IS NOT NULL
          AND (c.norm_num = p.num_numerator OR c.norm_disp_first = p.num_numerator)
          AND c.norm_total = p.num_denom
          THEN 'with_denom'
        WHEN p.num_denom IS NOT NULL
          AND (c.norm_num = p.num_numerator OR c.norm_disp_first = p.num_numerator)
          AND c.norm_total IS NULL
          THEN 'unknown_denom'
        WHEN p.num_denom IS NULL
          AND p.num_full IS NOT NULL
          AND (c.norm_num = p.num_numerator OR c.norm_disp_first = p.num_numerator)
          THEN 'numerator'
        ELSE 'name_only'
      END AS match_quality,
      CASE WHEN p.nm IS NULL THEN 0::real
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
  scored_strong AS (
    SELECT s.*,
      (
        s.match_quality IN ('full', 'with_denom')
        OR (p.is_promo AND s.promo_match)
      ) AS is_strong
    FROM scored s, params p
  ),
  has_strong AS (
    SELECT bool_or(is_strong) AS yes FROM scored_strong
  ),
  has_promo_match AS (
    SELECT bool_or(promo_match) AS yes FROM scored
  ),
  has_any_number_match AS (
    SELECT bool_or(number_match) AS yes FROM scored
  ),
  filtered AS (
    SELECT s.* FROM scored_strong s, has_strong hs, has_promo_match hp, has_any_number_match hn, params p
    WHERE
      -- Strict-strong from v7: only strong rows when any strong exists.
      (NOT hs.yes OR s.is_strong)
      -- New v8 rule: drop name_only rows entirely if any number match exists.
      -- Number is the source of truth; name path is a fallback for scans
      -- where Vision failed to read the number at all.
      AND (s.match_quality != 'name_only' OR NOT hn.yes)
      -- Promo filter from v6.
      AND (NOT p.is_promo OR s.promo_match OR NOT hp.yes)
  ),
  pooled AS (
    SELECT
      f.*,
      COUNT(*) OVER (PARTITION BY CASE
        WHEN f.match_quality IN ('full', 'with_denom') THEN 'strong'
        WHEN f.match_quality = 'unknown_denom'         THEN 'unknown'
        WHEN f.match_quality = 'numerator'             THEN 'weak'
        ELSE                                                'name'
      END) AS pool_size_raw,
      DENSE_RANK() OVER (
        PARTITION BY CASE
          WHEN f.match_quality IN ('full', 'with_denom') THEN 'strong'
          WHEN f.match_quality = 'unknown_denom'         THEN 'unknown'
          WHEN f.match_quality = 'numerator'             THEN 'weak'
          ELSE                                                'name'
        END
        ORDER BY f.name_similarity DESC, f.card_name ASC
      ) AS rank_in_pool_raw
    FROM filtered f
  ),
  with_base AS (
    SELECT
      pl.*,
      CASE
        WHEN pl.match_quality = 'full'          AND pl.pool_size_raw = 1 THEN 0.98::real
        WHEN pl.match_quality = 'full'                                   THEN 0.93::real + 0.05::real * pl.name_similarity
        WHEN pl.match_quality = 'with_denom'    AND pl.pool_size_raw = 1 THEN 0.96::real
        WHEN pl.match_quality = 'with_denom'                             THEN 0.88::real + 0.08::real * pl.name_similarity
        WHEN pl.match_quality = 'unknown_denom' AND pl.name_similarity >= 0.45 THEN 0.65::real + 0.15::real * pl.name_similarity
        WHEN pl.match_quality = 'unknown_denom'                          THEN 0.55::real
        WHEN pl.match_quality = 'numerator' AND pl.is_strong AND pl.pool_size_raw = 1 THEN 0.94::real
        WHEN pl.match_quality = 'numerator' AND pl.is_strong              THEN 0.86::real + 0.08::real * pl.name_similarity
        WHEN pl.match_quality = 'numerator' AND pl.name_similarity >= 0.55 THEN 0.55::real + 0.20::real * pl.name_similarity
        WHEN pl.match_quality = 'numerator' AND pl.name_similarity >= 0.30 THEN 0.40::real + 0.18::real * pl.name_similarity
        WHEN pl.match_quality = 'numerator'                              THEN 0.32::real
        WHEN pl.name_similarity >= 0.60                                  THEN 0.40::real + 0.25::real * pl.name_similarity
        ELSE                                                                 0.10::real + 0.30::real * pl.name_similarity
      END AS base_score
    FROM pooled pl
  )
  SELECT
    w.card_slug, w.card_name, w.clean_name, w.set_name,
    w.card_number, w.card_number_display, w.set_printed_total,
    w.card_url_slug, w.image_url,
    w.match_quality, w.number_match, w.denom_match, w.promo_match,
    w.name_similarity, w.set_match, w.year_match,
    w.pool_size_raw::int    AS pool_size,
    w.rank_in_pool_raw::int AS rank_in_pool,
    LEAST(1.0::real, w.base_score
      + (CASE WHEN w.set_match   THEN 0.03::real ELSE 0::real END)
      + (CASE WHEN w.year_match  THEN 0.03::real ELSE 0::real END)
      + (CASE WHEN w.promo_match THEN 0.04::real ELSE 0::real END)
    ) AS confidence
  FROM with_base w
  ORDER BY
    CASE w.match_quality
      WHEN 'full'          THEN 0
      WHEN 'with_denom'    THEN 1
      WHEN 'unknown_denom' THEN 2
      WHEN 'numerator'     THEN 3
      ELSE                      4
    END,
    confidence DESC,
    w.name_similarity DESC,
    w.card_name ASC
  LIMIT 10;
$$;

GRANT EXECUTE ON FUNCTION scan_card_match(text, text, text, integer, boolean) TO anon;
GRANT EXECUTE ON FUNCTION scan_card_match(text, text, text, integer, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION scan_card_match(text, text, text, integer, boolean) TO service_role;
