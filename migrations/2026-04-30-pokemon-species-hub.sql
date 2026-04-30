-- 2026-04-30 — Pokemon species hub
-- ================================
-- Builds out per-Pokémon-species pages by:
--   1. Extending pokemon_species with type / generation / aggregated totals
--      (currently just id + name).
--   2. Adding a card_pokemon join table for which species each card depicts,
--      plus a cached primary_pokemon_slug column on cards for fast filters
--      and the card-page "More [Pokémon] cards →" link.
--   3. Two new RPCs: get_pokemon_species_list (directory) and
--      get_pokemon_species_detail (per-species page payload).
--   4. recompute_pokemon_species_stats() — nightly aggregate refresh.
--   5. Extending get_card_detail_by_url_slug to expose primary_pokemon_slug
--      so the card page can render the species link without a 2nd round trip.
--
-- IMPORTANT: This migration deliberately does NOT drop the legacy
-- pokemon_species_stats table. The live PokemonPageClient still reads from
-- it; dropping it before the frontend migrates would zero out the directory.
-- Drop it in a follow-up after the frontend PR ships.
--
-- Apply in the Supabase SQL editor. Sections are independent — if one step
-- already exists (IF NOT EXISTS guards), it is skipped.

-- ─── 1. Extend pokemon_species ───────────────────────────────────────────────

ALTER TABLE pokemon_species
  ADD COLUMN IF NOT EXISTS type_primary              TEXT,
  ADD COLUMN IF NOT EXISTS type_secondary            TEXT,
  ADD COLUMN IF NOT EXISTS generation                INT,
  ADD COLUMN IF NOT EXISTS is_legendary              BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_mythical               BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS total_cards               INT     DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_market_value_cents  BIGINT  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS highest_card_price_cents  BIGINT,
  ADD COLUMN IF NOT EXISTS highest_card_slug         TEXT,
  ADD COLUMN IF NOT EXISTS first_appeared_set        TEXT,
  ADD COLUMN IF NOT EXISTS first_appeared_year       INT,
  ADD COLUMN IF NOT EXISTS most_recent_set           TEXT,
  ADD COLUMN IF NOT EXISTS description               TEXT,
  ADD COLUMN IF NOT EXISTS updated_at                TIMESTAMPTZ DEFAULT NOW();

-- name is already lowercase-hyphenated (e.g. "mr-mime") and one row per species,
-- so it functions as the species slug. Make that uniqueness explicit so we can
-- treat it as a stable join key from card_pokemon.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pokemon_species_name_unique
  ON pokemon_species(name);

CREATE INDEX IF NOT EXISTS idx_pokemon_species_total_value
  ON pokemon_species(total_market_value_cents DESC);
CREATE INDEX IF NOT EXISTS idx_pokemon_species_total_cards
  ON pokemon_species(total_cards DESC);


-- ─── 2. card_pokemon join table ─────────────────────────────────────────────
-- One row per (card, species). is_primary picks out the "main" species on
-- multi-Pokémon cards (e.g. Pikachu & Zekrom GX → Pikachu primary). Backfill
-- writes both rows; it_primary uses first-mentioned-in-card_name as the rule.

CREATE TABLE IF NOT EXISTS card_pokemon (
  card_slug      TEXT NOT NULL,
  species_slug   TEXT NOT NULL,
  is_primary     BOOLEAN DEFAULT FALSE,
  PRIMARY KEY (card_slug, species_slug)
);

CREATE INDEX IF NOT EXISTS idx_card_pokemon_species
  ON card_pokemon(species_slug);
CREATE INDEX IF NOT EXISTS idx_card_pokemon_primary
  ON card_pokemon(species_slug)
  WHERE is_primary = TRUE;


-- ─── 3. Cached primary species on cards ─────────────────────────────────────
-- So the card-page query (get_card_detail_by_url_slug) and any "filter by
-- species" lookups can avoid the join.

ALTER TABLE cards
  ADD COLUMN IF NOT EXISTS primary_pokemon_slug TEXT;

CREATE INDEX IF NOT EXISTS idx_cards_primary_pokemon_slug
  ON cards(primary_pokemon_slug);


-- ─── 4. RPC: get_pokemon_species_list ──────────────────────────────────────
-- Directory rows. Sorted by total cards desc.

DROP FUNCTION IF EXISTS get_pokemon_species_list(INT, INT);

CREATE OR REPLACE FUNCTION get_pokemon_species_list(
  p_lim    INT DEFAULT 200,
  p_offset INT DEFAULT 0
)
RETURNS TABLE (
  id                       INT,
  name                     TEXT,
  type_primary             TEXT,
  type_secondary           TEXT,
  generation               INT,
  is_legendary             BOOLEAN,
  is_mythical              BOOLEAN,
  total_cards              INT,
  total_market_value_cents BIGINT,
  highest_card_price_cents BIGINT,
  highest_card_slug        TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT
    s.id, s.name,
    s.type_primary, s.type_secondary, s.generation,
    s.is_legendary, s.is_mythical,
    s.total_cards, s.total_market_value_cents,
    s.highest_card_price_cents, s.highest_card_slug
  FROM pokemon_species s
  ORDER BY s.total_cards DESC NULLS LAST, s.id ASC
  LIMIT  p_lim
  OFFSET p_offset;
$$;

GRANT EXECUTE ON FUNCTION get_pokemon_species_list(INT, INT) TO authenticated, anon;


-- ─── 5. RPC: get_pokemon_species_detail ────────────────────────────────────
-- Returns JSON with: species, top_cards, risers_30d, fallers_30d, all_cards,
-- cards_by_set. One round trip — replaces the multi-query client logic in
-- PokemonSpeciesPageClient. Returns NULL if the slug doesn't exist.

DROP FUNCTION IF EXISTS get_pokemon_species_detail(TEXT);

CREATE OR REPLACE FUNCTION get_pokemon_species_detail(p_slug TEXT)
RETURNS JSON
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  sp_row pokemon_species%ROWTYPE;
  result JSON;
BEGIN
  SELECT * INTO sp_row FROM pokemon_species WHERE name = p_slug LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

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
      'updated_at',               sp_row.updated_at
    ),

    -- Top 10 cards by GREATEST(psa10, raw) — feeds "Most Valuable [Name] Cards"
    'top_cards', COALESCE((
      SELECT json_agg(t.*)
      FROM (
        SELECT
          c.card_slug, c.card_name, c.set_name, c.card_url_slug,
          c.image_url, c.card_number, c.card_number_display,
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

    -- Top 5 risers over 30d — feeds "Recent Price Movement"
    -- Floor at $1+ raw to filter penny-card noise.
    'risers_30d', COALESCE((
      SELECT json_agg(t.*)
      FROM (
        SELECT
          c.card_slug, c.card_name, c.set_name, c.card_url_slug,
          c.image_url, c.card_number,
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

    -- Top 5 fallers over 30d
    'fallers_30d', COALESCE((
      SELECT json_agg(t.*)
      FROM (
        SELECT
          c.card_slug, c.card_name, c.set_name, c.card_url_slug,
          c.image_url, c.card_number,
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

    -- All cards for this species — feeds the full filterable grid. Capped
    -- at 500 to keep the JSON payload reasonable; only species like
    -- Pikachu would push past that, and the UI can show "showing 500 of N".
    'all_cards', COALESCE((
      SELECT json_agg(t.*)
      FROM (
        SELECT
          c.card_slug, c.card_name, c.set_name, c.card_url_slug,
          c.image_url, c.card_number, c.card_number_display,
          c.set_release_date,
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
        LIMIT 500
      ) t
    ), '[]'::json),

    -- Cards grouped by set with the most-valuable card image as a tile thumb.
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


-- ─── 6. Update get_card_detail_by_url_slug to expose primary_pokemon_slug ───
-- Adds primary_pokemon_slug to the JSON so the individual card page can
-- render the "More [Pokémon] cards →" link in the header without a second
-- round trip. ALL existing fields preserved exactly — only adding one key.

CREATE OR REPLACE FUNCTION public.get_card_detail_by_url_slug(p_set_name TEXT, p_card_url_slug TEXT)
RETURNS json
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    'card_slug',            c.card_slug,
    'card_name',            c.card_name,
    'set_name',             c.set_name,
    'card_number',          c.card_number,
    'card_number_display',  c.card_number_display,
    'set_printed_total',    c.set_printed_total,
    'pc_url',               c.pc_url,
    'image_url',            c.image_url,
    'card_url_slug',        c.card_url_slug,
    'primary_pokemon_slug', c.primary_pokemon_slug,
    'raw_usd',              dp.raw_usd,
    'psa7_usd',             dp.psa7_usd,
    'psa8_usd',             dp.psa8_usd,
    'psa9_usd',             dp.psa9_usd,
    'psa10_usd',            dp.psa10_usd,
    'cgc95_usd',            dp.cgc95_usd
  ) INTO result
  FROM cards c
  LEFT JOIN daily_prices dp ON dp.card_slug = 'pc-' || c.card_slug
  WHERE c.set_name = p_set_name
    AND c.card_url_slug = p_card_url_slug
  ORDER BY dp.date DESC
  LIMIT 1;
  RETURN result;
END;
$$;


-- ─── 7. recompute_pokemon_species_stats utility ─────────────────────────────
-- Refreshes the aggregate columns on pokemon_species from
-- card_pokemon ⨯ cards ⨯ card_trends. Idempotent — safe to re-run nightly.
-- Returns the number of species with at least one card.

CREATE OR REPLACE FUNCTION recompute_pokemon_species_stats()
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  refreshed_count INT;
BEGIN
  -- Per-species totals
  WITH agg AS (
    SELECT
      cp.species_slug,
      COUNT(DISTINCT c.card_slug)::INT                             AS total_cards,
      COALESCE(SUM(GREATEST(
        COALESCE(ct.current_psa10, 0), COALESCE(ct.current_raw, 0)
      )), 0)::BIGINT                                               AS total_value
    FROM card_pokemon cp
    JOIN cards c ON c.card_slug = cp.card_slug
    LEFT JOIN card_trends ct
      ON ct.card_name = c.card_name
     AND ct.set_name  = c.set_name
    WHERE c.is_sealed = FALSE
    GROUP BY cp.species_slug
  ),
  -- Most valuable card per species
  highest AS (
    SELECT DISTINCT ON (cp.species_slug)
      cp.species_slug,
      c.card_slug AS highest_slug,
      GREATEST(COALESCE(ct.current_psa10, 0), COALESCE(ct.current_raw, 0))::BIGINT
        AS highest_price
    FROM card_pokemon cp
    JOIN cards c ON c.card_slug = cp.card_slug
    LEFT JOIN card_trends ct
      ON ct.card_name = c.card_name
     AND ct.set_name  = c.set_name
    WHERE c.is_sealed = FALSE
    ORDER BY cp.species_slug,
             GREATEST(COALESCE(ct.current_psa10, 0), COALESCE(ct.current_raw, 0)) DESC NULLS LAST
  ),
  -- First set the species appeared in
  earliest AS (
    SELECT DISTINCT ON (cp.species_slug)
      cp.species_slug,
      c.set_name                                  AS first_set,
      EXTRACT(YEAR FROM c.set_release_date)::INT  AS first_year
    FROM card_pokemon cp
    JOIN cards c ON c.card_slug = cp.card_slug
    WHERE c.is_sealed = FALSE
      AND c.set_release_date IS NOT NULL
    ORDER BY cp.species_slug, c.set_release_date ASC
  ),
  -- Most recent set
  recent AS (
    SELECT DISTINCT ON (cp.species_slug)
      cp.species_slug,
      c.set_name AS recent_set
    FROM card_pokemon cp
    JOIN cards c ON c.card_slug = cp.card_slug
    WHERE c.is_sealed = FALSE
      AND c.set_release_date IS NOT NULL
    ORDER BY cp.species_slug, c.set_release_date DESC
  )
  UPDATE pokemon_species s
     SET total_cards              = COALESCE(a.total_cards, 0),
         total_market_value_cents = COALESCE(a.total_value, 0),
         highest_card_price_cents = h.highest_price,
         highest_card_slug        = h.highest_slug,
         first_appeared_set       = e.first_set,
         first_appeared_year      = e.first_year,
         most_recent_set          = r.recent_set,
         updated_at               = NOW()
    FROM agg a
    LEFT JOIN highest  h ON h.species_slug = a.species_slug
    LEFT JOIN earliest e ON e.species_slug = a.species_slug
    LEFT JOIN recent   r ON r.species_slug = a.species_slug
   WHERE s.name = a.species_slug;

  GET DIAGNOSTICS refreshed_count = ROW_COUNT;

  -- Zero-out species with no cards (so stale aggregates don't linger when
  -- a species gets all its card_pokemon rows deleted).
  UPDATE pokemon_species s
     SET total_cards              = 0,
         total_market_value_cents = 0,
         highest_card_price_cents = NULL,
         highest_card_slug        = NULL,
         first_appeared_set       = NULL,
         first_appeared_year      = NULL,
         most_recent_set          = NULL,
         updated_at               = NOW()
   WHERE NOT EXISTS (
     SELECT 1 FROM card_pokemon cp WHERE cp.species_slug = s.name
   )
     AND (s.total_cards <> 0 OR s.total_market_value_cents <> 0);

  RETURN refreshed_count;
END;
$$;

GRANT EXECUTE ON FUNCTION recompute_pokemon_species_stats() TO authenticated, anon;


-- ─── DONE ───────────────────────────────────────────────────────────────────
-- After running this:
--   1. The new pokemon_species columns are empty (NULL / 0). Backfill them
--      via the Python scripts:
--        - populate_pokemon_species_meta.py    (PokeAPI → type/gen/legendary)
--        - backfill_card_pokemon.py            (regex match → card_pokemon)
--        - SELECT recompute_pokemon_species_stats();   -- rolls up totals
--   2. The frontend PR migrates PokemonPageClient + PokemonSpeciesPageClient
--      to read from the new RPCs.
--   3. Once the frontend is live, a small follow-up SQL drops the legacy
--      pokemon_species_stats table.
