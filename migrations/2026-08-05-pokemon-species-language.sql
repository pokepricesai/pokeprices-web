-- migrations/2026-08-05-pokemon-species-language.sql
--
-- Block 5A-W-53A — extend the Pokémon-species page so it can
-- distinguish English and Japanese cards.
--
-- Additive migration:
--   1. Include `language` on every card projection in
--      get_pokemon_species_detail (top_cards, risers_30d,
--      fallers_30d, all_cards). The client uses this to power an
--      All / English / Japanese filter above the card grid and
--      to split completion progress into two bars.
--   2. Return per-language totals (en_total_cards, jp_total_cards)
--      at the species level so the filter tab counts and the
--      completion denominators are correct without a second query.
--   3. Raise the all_cards LIMIT from 500 to 800 — Pikachu with
--      the Japanese cards backfilled now exceeds 500 total, and
--      the block explicitly requires both languages to appear.
--
-- No schema changes. Only the RPC body changes. Safe to apply
-- without downtime — CREATE OR REPLACE swaps in the new definition
-- and existing callers see the new fields as extra keys they can
-- ignore. All previously-returned fields are preserved unchanged.

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
BEGIN
  SELECT * INTO sp_row FROM pokemon_species WHERE name = p_slug LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Block 5A-W-53A — per-language totals used for the filter
  -- tab counts ("All (N) / English (E) / Japanese (J)") and the
  -- completion-progress denominators. Duplicated by cp × c to
  -- reuse the same eligibility filter (non-sealed) as the rest of
  -- the payload.
  SELECT
    COUNT(DISTINCT c.card_slug) FILTER (WHERE c.language = 'en')::INT,
    COUNT(DISTINCT c.card_slug) FILTER (WHERE c.language = 'jp')::INT
    INTO en_total, jp_total
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
      -- 53A per-language totals.
      'en_total_cards',           COALESCE(en_total, 0),
      'jp_total_cards',           COALESCE(jp_total, 0)
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
-- 1. Confirm the new language field appears on every card list:
--
--    SELECT (get_pokemon_species_detail('pikachu')::jsonb->'all_cards')->0
--      AS first_card;
--    -- expect a "language" key on the JSON object.
--
-- 2. Confirm per-language totals for a well-populated species:
--
--    SELECT
--      get_pokemon_species_detail('pikachu')::jsonb->'species'->>'en_total_cards' AS en,
--      get_pokemon_species_detail('pikachu')::jsonb->'species'->>'jp_total_cards' AS jp;
--    -- expect both to be positive integers after the 53A backfill.
--
-- 3. Confirm English-only species still work (English total > 0,
--    Japanese total = 0):
--
--    SELECT
--      get_pokemon_species_detail('gastly')::jsonb->'species'->>'en_total_cards' AS en,
--      get_pokemon_species_detail('gastly')::jsonb->'species'->>'jp_total_cards' AS jp;
