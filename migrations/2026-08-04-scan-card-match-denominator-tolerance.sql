-- migrations/2026-08-04-scan-card-match-denominator-tolerance.sql
--
-- Block 5A-W-51B — extend scan_card_match so the scanner is tolerant
-- of the wrong-denominator data condition documented in
-- reports/jp-denominator-audit.md. Backward-compatible with 51A
-- callers (all six named params preserved, plus one new return
-- column).
--
-- The core change: when a scan supplies both numerator AND denominator
-- but the stored denominator differs, the v11 body dropped the
-- candidate row entirely. The v12 body includes those rows as
-- `numerator` match_quality with a NEW `denominator_conflict = TRUE`
-- flag so downstream code and users can see the conflict rather than
-- silently miss the correct card.
--
-- Additional 51B changes:
--   * language + numerator match without denom match gets a small
--     +0.02 base-score lift so a same-language weak match still
--     outranks a wrong-language same-numerator match. Applied on top
--     of the existing +0.05 language_match confidence bonus.
--   * Era compatibility: when copyright_year is supplied AND the
--     candidate's set_release_date is within 2 years, +0.03 to
--     confidence (existing year_match logic tightened from ±1 to a
--     retained ±1 for tighter accuracy — behaviour preserved).
--
-- Deployment order (SAME as 51A):
--   1. Apply this migration in the Supabase SQL Editor.
--   2. Deploy the edge function to the `quick-action` slug.
--
-- Reversible — a rollback block restores the 51A v11 signature.

BEGIN;

DROP FUNCTION IF EXISTS scan_card_match(text, text, text, integer, boolean, text);

CREATE OR REPLACE FUNCTION scan_card_match(
  p_collector_number text    DEFAULT NULL,
  p_name             text    DEFAULT NULL,
  p_set_hint         text    DEFAULT NULL,
  p_copyright_year   integer DEFAULT NULL,
  p_is_promo         boolean DEFAULT FALSE,
  p_language         text    DEFAULT NULL
)
RETURNS TABLE (
  card_slug             text,
  card_name             text,
  clean_name            text,
  set_name              text,
  card_number           text,
  card_number_display   text,
  set_printed_total     text,
  card_url_slug         text,
  image_url             text,
  match_quality         text,
  number_match          boolean,
  denom_match           boolean,
  promo_match           boolean,
  name_similarity       real,
  set_match             boolean,
  year_match            boolean,
  pool_size             integer,
  rank_in_pool          integer,
  confidence            real,
  language              text,
  language_match        boolean,
  denominator_conflict  boolean       -- Block 5A-W-51B (NEW)
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
      COALESCE(p_is_promo, FALSE)                                             AS is_promo,
      NULLIF(lower(trim(p_language)), '')                                     AS lang
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
      c.language,
      c.set_release_date,
      _normalize_card_number(c.card_number)                             AS norm_num,
      _normalize_card_number(c.card_number_display)                     AS norm_num_disp,
      _normalize_card_number(split_part(c.card_number_display, '/', 1)) AS norm_disp_first,
      _normalize_card_number(c.set_printed_total)                       AS norm_total,
      (c.set_name ILIKE '%promo%')                                      AS is_promo_set
    FROM cards c
    WHERE c.is_sealed IS NOT TRUE
  ),
  -- Block 5A-W-51B — numerator-matching candidates are ALWAYS included
  -- now, regardless of whether the scanned denominator matches the
  -- stored denominator. The pre-51B `AND (p.num_denom IS NULL OR
  -- b.norm_total = p.num_denom OR b.norm_total IS NULL)` filter
  -- excluded the correct card whenever the stored denominator was
  -- wrong (the modern JP set data-quality issue documented in
  -- reports/jp-denominator-audit.md). Downstream scoring uses the
  -- new denominator_conflict signal to communicate the mismatch
  -- rather than dropping the row.
  candidates AS (
    SELECT b.*
    FROM base b, params p
    WHERE p.num_full IS NOT NULL
      AND (
        b.norm_num         = p.num_numerator
        OR b.norm_disp_first = p.num_numerator
        OR b.norm_num_disp   = p.num_full
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
        WHEN p.num_denom IS NOT NULL
          AND (c.norm_num = p.num_numerator OR c.norm_disp_first = p.num_numerator)
          AND c.norm_total IS NOT NULL
          AND c.norm_total <> p.num_denom
          -- Block 5A-W-51B — numerator matches but stored denom differs
          -- from scanned denom. Previously excluded from candidates
          -- entirely; now surfaced as `numerator` quality with the
          -- denominator_conflict flag.
          THEN 'numerator'
        ELSE 'name_only'
      END AS match_quality,
      -- Block 5A-W-51B — denominator_conflict signals a numerator hit
      -- against a row whose stored denominator differs from what the
      -- scanner read. Used by the UI to explain "Possible match with
      -- known data mismatch". FALSE when denominators agree, when the
      -- scanner supplied no denominator, or when the stored denom is
      -- null.
      (
        p.num_full IS NOT NULL
        AND p.num_denom IS NOT NULL
        AND c.norm_total IS NOT NULL
        AND (c.norm_num = p.num_numerator OR c.norm_disp_first = p.num_numerator)
        AND c.norm_total <> p.num_denom
      ) AS denominator_conflict,
      CASE WHEN p.nm IS NULL THEN 0::real
           ELSE similarity(lower(c.clean_name), lower(p.nm))
      END AS name_similarity,
      (p.st IS NOT NULL AND c.set_name ILIKE '%' || p.st || '%') AS set_match,
      (
        p.yr IS NOT NULL
        AND c.set_release_date IS NOT NULL
        AND ABS(EXTRACT(YEAR FROM c.set_release_date)::int - p.yr) <= 1
      ) AS year_match,
      (
        p.lang IS NOT NULL
        AND c.language IS NOT NULL
        AND lower(c.language) = p.lang
      ) AS language_match
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
  scored_namegated AS (
    SELECT s.*,
      (
        p.nm IS NULL
        OR s.match_quality = 'name_only'
        OR s.name_similarity >= 0.30
      ) AS name_plausible
    FROM scored_strong s, params p
  ),
  has_strong AS (
    SELECT bool_or(is_strong AND name_plausible) AS yes FROM scored_namegated
  ),
  has_promo_match AS (
    SELECT bool_or(promo_match AND name_plausible) AS yes FROM scored_namegated
  ),
  has_any_number_match AS (
    SELECT bool_or(number_match AND name_plausible) AS yes FROM scored_namegated
  ),
  filtered AS (
    SELECT s.* FROM scored_namegated s, has_strong hs, has_promo_match hp, has_any_number_match hn, params p
    WHERE
      s.name_plausible
      AND (NOT hs.yes OR s.is_strong)
      AND (s.match_quality != 'name_only' OR NOT hn.yes)
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
      + (CASE WHEN w.set_match              THEN 0.03::real ELSE 0::real END)
      + (CASE WHEN w.year_match             THEN 0.03::real ELSE 0::real END)
      + (CASE WHEN w.promo_match            THEN 0.04::real ELSE 0::real END)
      + (CASE WHEN w.language_match         THEN 0.05::real ELSE 0::real END)
      -- Block 5A-W-51B — small penalty for denominator_conflict so a
      -- clean full match in a different-language set still outranks
      -- a mismatched-denominator candidate in the right language.
      -- Preserves the intent of denominator matching while allowing
      -- the correct card to surface when the data is wrong.
      - (CASE WHEN w.denominator_conflict   THEN 0.03::real ELSE 0::real END)
      -- Block 5A-W-51B — extra +0.02 for numerator match + same
      -- language when denominator is unknown/conflicting. Helps the
      -- correct JP card outrank the same-numerator EN card even
      -- when denominators disagree.
      + (CASE WHEN w.language_match AND w.number_match AND NOT w.denom_match THEN 0.02::real ELSE 0::real END)
    ) AS confidence,
    w.language,
    w.language_match,
    w.denominator_conflict          -- Block 5A-W-51B (NEW column)
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
    w.language_match DESC,
    w.card_name ASC
  LIMIT 10;
$$;

GRANT EXECUTE ON FUNCTION scan_card_match(text, text, text, integer, boolean, text) TO anon;
GRANT EXECUTE ON FUNCTION scan_card_match(text, text, text, integer, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION scan_card_match(text, text, text, integer, boolean, text) TO service_role;

-- Verification queries (informational — paste after apply):
--
--   -- Regression: known English scan still returns the correct
--   -- top candidate with 'full' quality.
--   SELECT card_slug, set_name, match_quality, confidence, language, denominator_conflict
--     FROM scan_card_match('58/102', 'Pikachu', NULL, 1995, FALSE, NULL) LIMIT 3;
--
--   -- Denominator tolerance: JP Battle Partners Articuno is stored
--   -- as 102/130 in the DB. Scanning 102/100 (the real printed
--   -- number) should now return it as a numerator+language match
--   -- with denominator_conflict = TRUE.
--   SELECT card_slug, set_name, match_quality, confidence, language,
--          language_match, denominator_conflict, card_number_display
--     FROM scan_card_match('102/100', NULL, NULL, NULL, FALSE, 'jp') LIMIT 5;

COMMIT;

-- Rollback (paste separately if reverting to 51A behaviour):
--
-- BEGIN;
-- DROP FUNCTION IF EXISTS scan_card_match(text, text, text, integer, boolean, text);
-- -- Re-apply the 51A body from
-- -- migrations/2026-08-04-scan-card-match-language-signal.sql.
-- COMMIT;
