-- /scan-test diagnostic feature: fuzzy card matching from camera scans.
--
-- Two things here:
--   1. Enable pg_trgm for fuzzy name matching (similarity / % operator).
--   2. Add scan_card_match(p_collector_number, p_name, p_set_hint) RPC.
--
-- The RPC takes signals parsed from Google Vision text-detection output
-- and returns the top 5 candidate cards ranked by a combined confidence
-- score (number match weight 0.5 + name similarity 0.4 + set hint 0.1).
--
-- Notes on cards.card_name: it stores the "#NN" suffix embedded
-- (e.g. "Bulbasaur #95"). We strip that suffix before fuzzy matching
-- against the name we read off the card front.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Expression GIN index on the cleaned (suffix-stripped) lowercase name,
-- so the trigram % operator can use an index instead of scanning every
-- one of the ~40k card rows on every scan.
CREATE INDEX IF NOT EXISTS idx_cards_clean_name_trgm
  ON cards USING GIN (
    lower(regexp_replace(card_name, '\s*#[A-Za-z0-9/-]+\s*$', '')) gin_trgm_ops
  );

-- Number lookups: we hit card_number and card_number_display exactly,
-- so plain b-tree indexes are fine. If they already exist these are no-ops.
CREATE INDEX IF NOT EXISTS idx_cards_card_number ON cards (lower(card_number));
CREATE INDEX IF NOT EXISTS idx_cards_card_number_display ON cards (card_number_display);

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
      NULLIF(trim(p_collector_number), '') AS num,
      NULLIF(trim(p_name),             '') AS nm,
      NULLIF(trim(p_set_hint),         '') AS st
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
      c.image_url
    FROM cards c
    WHERE c.is_sealed IS NOT TRUE
  ),
  candidates AS (
    -- Path A: rows that match the collector number (cheap, narrow).
    SELECT b.*
    FROM base b, params p
    WHERE p.num IS NOT NULL
      AND (
        lower(b.card_number) = lower(p.num)
        OR b.card_number_display = p.num
        OR split_part(b.card_number_display, '/', 1) = split_part(p.num, '/', 1)
      )

    UNION

    -- Path B: rows whose cleaned name is trigram-similar to the read name.
    -- The % operator uses the GIN index above with the default threshold (0.3).
    SELECT b.*
    FROM base b, params p
    WHERE p.nm IS NOT NULL
      AND lower(b.clean_name) % lower(p.nm)
  ),
  scored AS (
    SELECT
      c.*,
      (
        p.num IS NOT NULL
        AND (
          lower(c.card_number) = lower(p.num)
          OR c.card_number_display = p.num
          OR split_part(c.card_number_display, '/', 1) = split_part(p.num, '/', 1)
        )
      ) AS number_match,
      CASE
        WHEN p.nm IS NULL THEN 0::real
        ELSE similarity(lower(c.clean_name), lower(p.nm))
      END AS name_similarity,
      (p.st IS NOT NULL AND c.set_name ILIKE '%' || p.st || '%') AS set_match
    FROM candidates c, params p
  )
  SELECT
    s.card_slug,
    s.card_name,
    s.clean_name,
    s.set_name,
    s.card_number,
    s.card_number_display,
    s.card_url_slug,
    s.image_url,
    s.number_match,
    s.name_similarity,
    s.set_match,
    (
      (CASE WHEN s.number_match THEN 0.5::real ELSE 0::real END)
      + (s.name_similarity * 0.4)
      + (CASE WHEN s.set_match    THEN 0.1::real ELSE 0::real END)
    ) AS confidence
  FROM scored s
  ORDER BY confidence DESC, s.name_similarity DESC, s.card_name ASC
  LIMIT 5;
$$;

-- Allow the anon role to call this — the page is unauthenticated.
GRANT EXECUTE ON FUNCTION scan_card_match(text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION scan_card_match(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION scan_card_match(text, text, text) TO service_role;
