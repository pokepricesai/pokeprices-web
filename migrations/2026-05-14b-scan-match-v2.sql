-- scan_card_match v2.
--
-- Fixes a real miss: SAWK 130/086 — Vision parsed the number correctly
-- but the card didn't appear in candidates, because cards.card_number_display
-- is stored with a different leading-zero pattern than what was printed.
--
-- Three changes:
--   1. Normalize numbers on both sides (strip leading zeros + whitespace)
--      so "130/086" matches "130/86" matches "130/0086".
--   2. Reweight: number match is now firmly the dominant signal,
--      name is a tiebreaker, name-only matches cap below number-only.
--   3. LIMIT bumped to 8 so secret-rare variants across multiple sets
--      sharing the same number aren't squeezed out by the top of the list.

-- Normalize a card-number string for fuzzy comparison.
-- Lowercase, strip whitespace, strip leading zeros from each numeric run.
-- Letter prefixes (TG, GG, SV, SWSH, ...) are preserved.
--   "130/086"   -> "130/86"
--   "030/086"   -> "30/86"
--   "TG12/TG30" -> "tg12/tg30"
CREATE OR REPLACE FUNCTION _normalize_card_number(s text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN s IS NULL OR trim(s) = '' THEN NULL
    ELSE regexp_replace(
      lower(regexp_replace(s, '\s+', '', 'g')),
      '0+([0-9])', '\1', 'g'
    )
  END;
$$;

-- Expression indexes so the normalized comparisons still use indexes.
CREATE INDEX IF NOT EXISTS idx_cards_norm_card_number
  ON cards (_normalize_card_number(card_number));

CREATE INDEX IF NOT EXISTS idx_cards_norm_card_number_display
  ON cards (_normalize_card_number(card_number_display));

DROP FUNCTION IF EXISTS scan_card_match(text, text, text);

CREATE OR REPLACE FUNCTION scan_card_match(
  p_collector_number text DEFAULT NULL,
  p_name             text DEFAULT NULL,
  p_set_hint         text DEFAULT NULL
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
  confidence          real
)
LANGUAGE sql
STABLE
AS $$
  WITH params AS (
    SELECT
      _normalize_card_number(p_collector_number)                              AS num_norm,
      _normalize_card_number(split_part(p_collector_number, '/', 1))          AS num_first_norm,
      NULLIF(trim(p_name),     '')                                            AS nm,
      NULLIF(trim(p_set_hint), '')                                            AS st
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
      _normalize_card_number(c.card_number)                            AS norm_num,
      _normalize_card_number(c.card_number_display)                    AS norm_num_disp,
      _normalize_card_number(split_part(c.card_number_display, '/', 1)) AS norm_first
    FROM cards c
    WHERE c.is_sealed IS NOT TRUE
  ),
  candidates AS (
    -- Path A: number match (normalised, tolerates leading-zero mismatches)
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

    -- Path B: name fuzzy match (uses GIN trigram index)
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
      (p.st IS NOT NULL AND c.set_name ILIKE '%' || p.st || '%') AS set_match
    FROM candidates c, params p
  ),
  with_base AS (
    -- Number match is the dominant signal. Name is a tiebreaker.
    -- Name-only matches cap below the floor for number-only matches.
    SELECT
      s.*,
      CASE
        WHEN s.number_match AND s.name_similarity >= 0.45 THEN 0.85::real + 0.13::real * s.name_similarity
        WHEN s.number_match AND s.name_similarity >= 0.25 THEN 0.75::real + 0.18::real * s.name_similarity
        WHEN s.number_match                               THEN 0.70::real
        WHEN s.name_similarity >= 0.60                    THEN 0.40::real + 0.25::real * s.name_similarity
        ELSE                                                  0.10::real + 0.30::real * s.name_similarity
      END AS base_score
    FROM scored s
  )
  SELECT
    w.card_slug, w.card_name, w.clean_name, w.set_name,
    w.card_number, w.card_number_display, w.card_url_slug, w.image_url,
    w.number_match, w.name_similarity, w.set_match,
    LEAST(1.0::real, w.base_score + (CASE WHEN w.set_match THEN 0.05::real ELSE 0::real END)) AS confidence
  FROM with_base w
  ORDER BY confidence DESC, w.name_similarity DESC, w.card_name ASC
  LIMIT 8;
$$;

GRANT EXECUTE ON FUNCTION scan_card_match(text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION scan_card_match(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION scan_card_match(text, text, text) TO service_role;
