-- 2026-04-29 — Illustrators support
-- Run this whole file in the Supabase SQL editor. Idempotent (uses
-- IF NOT EXISTS / DROP FUNCTION IF EXISTS) so it's safe to re-run.
--
-- Tables created:
--   illustrators        — one row per artist (canonical directory)
--   card_illustrators   — many-to-many: cards ↔ illustrators
--
-- RPCs created:
--   get_illustrators_list(lim, offset)  — directory rows, sorted by card_count DESC
--   get_illustrator_detail(slug)        — single illustrator + their top 50 cards by current price
--   recompute_illustrator_stats()       — utility to refresh card_count and total_market_value_cents
--
-- Conventions:
--   - card_illustrators.card_slug stores the bare numeric form (matches
--     cards.card_slug, not daily_prices.card_slug which is "pc-" prefixed).
--   - All RPCs are SECURITY DEFINER and granted to authenticated + anon
--     (the illustrator directory is public-facing, like /pokemon).
--
-- Backfill order after running this migration:
--   1. INSERT into illustrators (one row per artist, with slug)
--   2. INSERT into card_illustrators (cards ↔ illustrator id, via cards.card_slug)
--   3. SELECT recompute_illustrator_stats();   -- populates card_count + total value
--   4. (Optional) UPDATE illustrators SET first_card_year = ... ;


-- ─── 1. Tables ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS illustrators (
  id                       SERIAL PRIMARY KEY,
  name                     TEXT NOT NULL UNIQUE,
  slug                     TEXT NOT NULL UNIQUE,
  bio                      TEXT,
  profile_url              TEXT,
  card_count               INT    DEFAULT 0,
  total_market_value_cents BIGINT DEFAULT 0,
  first_card_year          INT,
  created_at               TIMESTAMPTZ DEFAULT NOW(),
  updated_at               TIMESTAMPTZ DEFAULT NOW()
);

-- If the table already existed from a previous partial run, CREATE TABLE
-- IF NOT EXISTS is a no-op and any new columns above never get added. These
-- ADD COLUMN IF NOT EXISTS statements bring an older table up to spec.
ALTER TABLE illustrators ADD COLUMN IF NOT EXISTS bio                      TEXT;
ALTER TABLE illustrators ADD COLUMN IF NOT EXISTS profile_url              TEXT;
ALTER TABLE illustrators ADD COLUMN IF NOT EXISTS card_count               INT    DEFAULT 0;
ALTER TABLE illustrators ADD COLUMN IF NOT EXISTS total_market_value_cents BIGINT DEFAULT 0;
ALTER TABLE illustrators ADD COLUMN IF NOT EXISTS first_card_year          INT;
ALTER TABLE illustrators ADD COLUMN IF NOT EXISTS created_at               TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE illustrators ADD COLUMN IF NOT EXISTS updated_at               TIMESTAMPTZ DEFAULT NOW();

CREATE TABLE IF NOT EXISTS card_illustrators (
  card_slug      TEXT NOT NULL,
  illustrator_id INT  NOT NULL REFERENCES illustrators(id) ON DELETE CASCADE,
  PRIMARY KEY (card_slug, illustrator_id)
);

CREATE INDEX IF NOT EXISTS idx_card_illustrators_illustrator ON card_illustrators(illustrator_id);
CREATE INDEX IF NOT EXISTS idx_card_illustrators_card        ON card_illustrators(card_slug);
CREATE INDEX IF NOT EXISTS idx_illustrators_slug             ON illustrators(slug);
CREATE INDEX IF NOT EXISTS idx_illustrators_card_count       ON illustrators(card_count DESC);


-- ─── 2. updated_at trigger on illustrators ───────────────────────────────────

CREATE OR REPLACE FUNCTION illustrators_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_illustrators_updated_at ON illustrators;
CREATE TRIGGER trg_illustrators_updated_at
  BEFORE UPDATE ON illustrators
  FOR EACH ROW
  EXECUTE FUNCTION illustrators_set_updated_at();


-- ─── 3. RPC: get_illustrators_list ───────────────────────────────────────────
-- Directory rows. Mirrors the pokemon_species_stats reads from
-- PokemonPageClient — but exposed as an RPC so we can change the underlying
-- query later (e.g. add distinct-set count) without breaking the client.

DROP FUNCTION IF EXISTS get_illustrators_list(INT, INT);

CREATE OR REPLACE FUNCTION get_illustrators_list(
  p_lim    INT DEFAULT 200,
  p_offset INT DEFAULT 0
)
RETURNS TABLE (
  id                       INT,
  name                     TEXT,
  slug                     TEXT,
  card_count               INT,
  total_market_value_cents BIGINT,
  first_card_year          INT
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT
    i.id,
    i.name,
    i.slug,
    i.card_count,
    i.total_market_value_cents,
    i.first_card_year
  FROM illustrators i
  ORDER BY i.card_count DESC NULLS LAST, i.name ASC
  LIMIT  p_lim
  OFFSET p_offset;
$$;

GRANT EXECUTE ON FUNCTION get_illustrators_list(INT, INT) TO authenticated, anon;


-- ─── 4. RPC: get_illustrator_detail ──────────────────────────────────────────
-- Returns a JSON object:
--   {
--     "illustrator": { id, name, slug, bio, profile_url,
--                      card_count, total_market_value_cents, first_card_year,
--                      created_at, updated_at },
--     "top_cards":   [ { card_slug, card_name, set_name, card_url_slug,
--                        image_url, card_number,
--                        current_raw, current_psa10 }, … (up to 50) ]
--   }
-- "Top" is by GREATEST(current_psa10, current_raw) DESC, then card_name ASC
-- as a stable tie-break. Returns NULL if the slug doesn't exist.

DROP FUNCTION IF EXISTS get_illustrator_detail(TEXT);

CREATE OR REPLACE FUNCTION get_illustrator_detail(p_slug TEXT)
RETURNS JSON
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  ill_row illustrators%ROWTYPE;
  result  JSON;
BEGIN
  SELECT *
    INTO ill_row
  FROM illustrators
  WHERE slug = p_slug
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT json_build_object(
    'illustrator', json_build_object(
      'id',                       ill_row.id,
      'name',                     ill_row.name,
      'slug',                     ill_row.slug,
      'bio',                      ill_row.bio,
      'profile_url',              ill_row.profile_url,
      'card_count',               ill_row.card_count,
      'total_market_value_cents', ill_row.total_market_value_cents,
      'first_card_year',          ill_row.first_card_year,
      'created_at',               ill_row.created_at,
      'updated_at',               ill_row.updated_at
    ),
    'top_cards', COALESCE((
      SELECT json_agg(t.*)
      FROM (
        SELECT
          c.card_slug,
          c.card_name,
          c.set_name,
          c.card_url_slug,
          c.image_url,
          c.card_number,
          ct.current_raw,
          ct.current_psa10
        FROM card_illustrators ci
        JOIN cards c
          ON c.card_slug = ci.card_slug
        LEFT JOIN card_trends ct
          ON ct.card_name = c.card_name
         AND ct.set_name  = c.set_name
        WHERE ci.illustrator_id = ill_row.id
        ORDER BY GREATEST(
                   COALESCE(ct.current_psa10, 0),
                   COALESCE(ct.current_raw,   0)
                 ) DESC NULLS LAST,
                 c.card_name ASC
        LIMIT 50
      ) t
    ), '[]'::json)
  )
  INTO result;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_illustrator_detail(TEXT) TO authenticated, anon;


-- ─── 5. Utility: recompute_illustrator_stats ─────────────────────────────────
-- Refreshes the aggregate columns on illustrators by re-aggregating from
-- card_illustrators ⨯ cards ⨯ card_trends. Returns the number of illustrators
-- updated.
--
-- Run after:
--   - Bulk loading new rows into card_illustrators
--   - A price refresh that should propagate to total_market_value_cents
--
-- Does NOT touch first_card_year — backfill that yourself once you've decided
-- which set-release source to use.

DROP FUNCTION IF EXISTS recompute_illustrator_stats();

CREATE OR REPLACE FUNCTION recompute_illustrator_stats()
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  affected INT;
BEGIN
  WITH agg AS (
    SELECT
      ci.illustrator_id,
      COUNT(*)::INT AS card_count,
      COALESCE(SUM(GREATEST(
                     COALESCE(ct.current_psa10, 0),
                     COALESCE(ct.current_raw,   0)
                   )), 0)::BIGINT AS total_market_value_cents
    FROM card_illustrators ci
    JOIN cards c
      ON c.card_slug = ci.card_slug
    LEFT JOIN card_trends ct
      ON ct.card_name = c.card_name
     AND ct.set_name  = c.set_name
    GROUP BY ci.illustrator_id
  )
  UPDATE illustrators i
     SET card_count               = COALESCE(a.card_count, 0),
         total_market_value_cents = COALESCE(a.total_market_value_cents, 0)
    FROM agg a
   WHERE i.id = a.illustrator_id;

  GET DIAGNOSTICS affected = ROW_COUNT;

  -- Zero out illustrators that have no card links so stale totals can't
  -- linger after rows are deleted from card_illustrators.
  UPDATE illustrators
     SET card_count = 0,
         total_market_value_cents = 0
   WHERE id NOT IN (SELECT DISTINCT illustrator_id FROM card_illustrators);

  RETURN affected;
END;
$$;

GRANT EXECUTE ON FUNCTION recompute_illustrator_stats() TO authenticated;
