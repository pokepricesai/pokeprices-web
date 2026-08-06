-- migrations/2026-08-06-pokemon-species-distinct-set-count.sql
--
-- Block 5A-W-53A.1 — fix the "across 12 sets" bug in the
-- Pokémon page subtitle.
--
-- Root cause: the page's subtitle prose derives the distinct-set
-- count from `cards_by_set.length`, but the get_pokemon_species_detail
-- RPC caps `cards_by_set` at 12 rows (the "Explore by Set" tile
-- grid intentionally shows only the twelve most-populated sets to
-- keep the visual layout tight). For Pikachu that meant the
-- subtitle read "across 12 sets" even though Pikachu actually
-- appears in 134 distinct sets (84 English + 50 Japanese, no
-- overlap — probed live against the DB).
--
-- Fix: return `distinct_set_count` alongside `cards_by_set` so
-- the tile grid keeps its LIMIT 12 but the subtitle uses the
-- true count. Purely additive — pre-53A.1 clients see the new
-- field as an extra JSON key they can ignore.
--
-- Also adds `en_distinct_set_count` + `jp_distinct_set_count`
-- for future use (per-language set counts if a block ever wants
-- to say "48 English sets, 27 Japanese sets").

BEGIN;

DROP FUNCTION IF EXISTS get_pokemon_species_detail(TEXT);

CREATE OR REPLACE FUNCTION get_pokemon_species_detail(p_slug TEXT)
RETURNS JSON
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  sp_row pokemon_species%ROWTYPE;
  result JSON;
  en_total INT;
  jp_total INT;
  distinct_sets INT;
  en_sets INT;
  jp_sets INT;
BEGIN
  SELECT * INTO sp_row FROM pokemon_species WHERE name = p_slug LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT
    COUNT(DISTINCT c.card_slug) FILTER (WHERE c.language = 'en')::INT,
    COUNT(DISTINCT c.card_slug) FILTER (WHERE c.language = 'jp')::INT,
    COUNT(DISTINCT c.set_name)::INT,
    COUNT(DISTINCT c.set_name) FILTER (WHERE c.language = 'en')::INT,
    COUNT(DISTINCT c.set_name) FILTER (WHERE c.language = 'jp')::INT
    INTO en_total, jp_total, distinct_sets, en_sets, jp_sets
  FROM card_pokemon cp
  JOIN cards c ON c.card_slug = cp.card_slug
  WHERE cp.species_slug = sp_row.name
    AND c.is_sealed = FALSE;

  SELECT json_build_object(
    'species', json_build_object(
      'id',                       sp_row.id,
      'name',                     sp_row.name,
      'type_primary',             sp_row.type_primary,
      'type_secondary',           sp_row.type_secondary,
      'generation',               sp_row.generation,
      'is_legendary',             sp_row.is_legendary,
      'is_mythical',              sp_row.is_mythical,
      'total_cards',              sp_row.total_cards,
      'total_market_value_cents', sp_row.total_market_value_cents,
      'highest_card_price_cents', sp_row.highest_card_price_cents,
      'highest_card_slug',        sp_row.highest_card_slug,
      'first_appeared_set',       sp_row.first_appeared_set,
      'first_appeared_year',      sp_row.first_appeared_year,
      'most_recent_set',          sp_row.most_recent_set,
      'description',              sp_row.description,
      'updated_at',               sp_row.updated_at,
      'en_total_cards',           COALESCE(en_total, 0),
      'jp_total_cards',           COALESCE(jp_total, 0),
      -- 53A.1 — true distinct-set counts (never capped).
      'distinct_set_count',       COALESCE(distinct_sets, 0),
      'en_distinct_set_count',    COALESCE(en_sets, 0),
      'jp_distinct_set_count',    COALESCE(jp_sets, 0)
    ),

    'top_cards', COALESCE((
      SELECT json_agg(t.*)
      FROM (
        SELECT
          c.card_slug, c.card_name, c.set_name, c.card_url_slug,
          c.image_url, c.card_number, c.card_number_display,
          c.language,
          ct.current_raw, ct.current_psa9, ct.current_psa10,
          ct.raw_pct_30d
        FROM card_pokemon cp
        JOIN cards c          ON c.card_slug = cp.card_slug
        LEFT JOIN card_trends ct
                              ON ct.card_name = c.card_name
                             AND ct.set_name  = c.set_name
        WHERE cp.species_slug = sp_row.name
          AND c.is_sealed     = FALSE
        ORDER BY GREATEST(
                   COALESCE(ct.current_psa10, 0),
                   COALESCE(ct.current_raw,   0)
                 ) DESC NULLS LAST,
                 c.card_name ASC
        LIMIT 10
      ) t
    ), '[]'::json),

    'risers_30d', COALESCE((
      SELECT json_agg(t.*)
      FROM (
        SELECT
          c.card_slug, c.card_name, c.set_name, c.card_url_slug,
          c.image_url, c.card_number,
          c.language,
          ct.current_raw, ct.current_psa10,
          ct.raw_pct_30d
        FROM card_pokemon cp
        JOIN cards c          ON c.card_slug = cp.card_slug
        JOIN card_trends ct
                              ON ct.card_name = c.card_name
                             AND ct.set_name  = c.set_name
        WHERE cp.species_slug = sp_row.name
          AND c.is_sealed     = FALSE
          AND ct.raw_pct_30d  > 0
          AND ct.current_raw  > 100
        ORDER BY ct.raw_pct_30d DESC
        LIMIT 5
      ) t
    ), '[]'::json),

    'fallers_30d', COALESCE((
      SELECT json_agg(t.*)
      FROM (
        SELECT
          c.card_slug, c.card_name, c.set_name, c.card_url_slug,
          c.image_url, c.card_number,
          c.language,
          ct.current_raw, ct.current_psa10,
          ct.raw_pct_30d
        FROM card_pokemon cp
        JOIN cards c          ON c.card_slug = cp.card_slug
        JOIN card_trends ct
                              ON ct.card_name = c.card_name
                             AND ct.set_name  = c.set_name
        WHERE cp.species_slug = sp_row.name
          AND c.is_sealed     = FALSE
          AND ct.raw_pct_30d  < 0
          AND ct.current_raw  > 100
        ORDER BY ct.raw_pct_30d ASC
        LIMIT 5
      ) t
    ), '[]'::json),

    'all_cards', COALESCE((
      SELECT json_agg(t.*)
      FROM (
        SELECT
          c.card_slug, c.card_name, c.set_name, c.card_url_slug,
          c.image_url, c.card_number, c.card_number_display,
          c.set_release_date,
          c.language,
          ct.current_raw, ct.current_psa10,
          ct.raw_pct_30d
        FROM card_pokemon cp
        JOIN cards c          ON c.card_slug = cp.card_slug
        LEFT JOIN card_trends ct
                              ON ct.card_name = c.card_name
                             AND ct.set_name  = c.set_name
        WHERE cp.species_slug = sp_row.name
          AND c.is_sealed     = FALSE
        ORDER BY GREATEST(
                   COALESCE(ct.current_psa10, 0),
                   COALESCE(ct.current_raw,   0)
                 ) DESC NULLS LAST,
                 c.card_name ASC
        LIMIT 800
      ) t
    ), '[]'::json),

    'cards_by_set', COALESCE((
      SELECT json_agg(t.*)
      FROM (
        SELECT
          c.set_name,
          COUNT(*)::INT AS count,
          (array_agg(c.image_url ORDER BY
            GREATEST(COALESCE(ct.current_psa10, 0), COALESCE(ct.current_raw, 0)) DESC NULLS LAST
          ))[1] AS top_image,
          (array_agg(c.card_url_slug ORDER BY
            GREATEST(COALESCE(ct.current_psa10, 0), COALESCE(ct.current_raw, 0)) DESC NULLS LAST
          ))[1] AS top_card_url_slug,
          (array_agg(c.card_name ORDER BY
            GREATEST(COALESCE(ct.current_psa10, 0), COALESCE(ct.current_raw, 0)) DESC NULLS LAST
          ))[1] AS top_card_name
        FROM card_pokemon cp
        JOIN cards c          ON c.card_slug = cp.card_slug
        LEFT JOIN card_trends ct
                              ON ct.card_name = c.card_name
                             AND ct.set_name  = c.set_name
        WHERE cp.species_slug = sp_row.name
          AND c.is_sealed     = FALSE
        GROUP BY c.set_name
        ORDER BY count DESC
        LIMIT 12
      ) t
    ), '[]'::json)
  )
  INTO result;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_pokemon_species_detail(TEXT) TO authenticated, anon;

COMMIT;

-- ─── Verification ──────────────────────────────────
--
-- 1. Pikachu now reports 134 distinct sets (should be en_distinct
--    + jp_distinct, since no set overlaps EN and JP names):
--
--    SELECT
--      get_pokemon_species_detail('pikachu')::jsonb->'species'->>'distinct_set_count'    AS all_sets,
--      get_pokemon_species_detail('pikachu')::jsonb->'species'->>'en_distinct_set_count' AS en_sets,
--      get_pokemon_species_detail('pikachu')::jsonb->'species'->>'jp_distinct_set_count' AS jp_sets;
--    -- expect ~134, 84, 50 (as of block-time DB probe).
--
-- 2. cards_by_set still capped at 12 (visual layout unchanged):
--
--    SELECT jsonb_array_length((get_pokemon_species_detail('pikachu')::jsonb)->'cards_by_set');
--    -- expect: 12.
