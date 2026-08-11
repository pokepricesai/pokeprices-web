-- migrations/2026-08-09-deep-card-search.sql
--
-- Block 5A-W-56A — Deep Card Search RPC + supporting view.
--
-- Design:
--   * cards_search_v — thin projecting view that joins cards (excluding
--     sealed products) with the latest row of daily_prices per card
--     and card_trends by (card_name, set_name). Read-only.
--   * search_cards_deep(...) — parameterised RPC that applies filters,
--     sorts by a bounded set of columns, and paginates DB-side. Returns
--     JSONB { rows: [...], total_count: N } so the client gets both in
--     one round-trip.
--
-- Safety notes:
--   * Sealed products excluded at the view level so no filter path can
--     surface them.
--   * NULL grade prices never satisfy min/max filters on that grade —
--     `dp.psa9_usd <= X` is `NULL` when psa9_usd is NULL, which is
--     FALSE for WHERE-clause purposes.
--   * Derived filters (uplift / multiple) guard against zero/NULL raw
--     so we never divide by zero and never claim uplift for a card
--     with no raw signal.
--   * Sort direction expressed as CASE branches on p_sort inside the
--     dynamic query so p_sort is validated against a closed enum. No
--     user-supplied identifiers reach the executor.
--   * Pagination is DB-side. p_limit is clamped to [1, 200] and
--     p_offset to [0, 10000] to prevent runaway scans.

-- ─── View ────────────────────────────────────────────────────────────────────

-- Block 5A-W-56A.1 — every JOIN below is defensively one-row-per-card
-- so the view can never emit duplicate rows for a single catalogue
-- entry:
--   * `daily_prices` — LATERAL … LIMIT 1 picks a single latest row.
--   * `card_trends`  — LATERAL … LIMIT 1 (defensive: card_trends is
--                       expected to be unique per (card_name, set_name)
--                       but a stray double-row would silently double
--                       every result page without this guard).
--   * `card_pokemon` — NOT joined at the view level. Species membership
--                       is applied as an EXISTS subquery inside
--                       search_cards_deep so a card with both
--                       primary AND secondary Pikachu never duplicates.
CREATE OR REPLACE VIEW public.cards_search_v AS
SELECT
  c.card_slug,
  c.card_name,
  c.set_name,
  c.card_number,
  c.card_number_display,
  c.set_printed_total,
  c.card_url_slug,
  c.image_url,
  c.primary_pokemon_slug,
  COALESCE(c.language, 'en')                                     AS language,
  c.set_release_date,
  EXTRACT(YEAR FROM c.set_release_date)::INT                     AS release_year,
  dp.raw_usd,
  dp.psa7_usd,
  dp.psa8_usd,
  dp.psa9_usd,
  dp.psa10_usd,
  ct.raw_pct_7d,
  ct.raw_pct_30d,
  ct.raw_pct_90d,
  -- Derived — NULL when raw is missing/zero or graded value is missing.
  CASE WHEN dp.raw_usd IS NOT NULL AND dp.psa9_usd  IS NOT NULL
       THEN dp.psa9_usd  - dp.raw_usd END                        AS psa9_uplift,
  CASE WHEN dp.raw_usd IS NOT NULL AND dp.psa10_usd IS NOT NULL
       THEN dp.psa10_usd - dp.raw_usd END                        AS psa10_uplift,
  CASE WHEN dp.raw_usd > 0 AND dp.psa9_usd  IS NOT NULL
       THEN dp.psa9_usd::NUMERIC  / dp.raw_usd END               AS psa9_multiple,
  CASE WHEN dp.raw_usd > 0 AND dp.psa10_usd IS NOT NULL
       THEN dp.psa10_usd::NUMERIC / dp.raw_usd END               AS psa10_multiple
FROM public.cards c
LEFT JOIN LATERAL (
  SELECT dp.raw_usd, dp.psa7_usd, dp.psa8_usd, dp.psa9_usd, dp.psa10_usd
  FROM public.daily_prices dp
  WHERE dp.card_slug = 'pc-' || c.card_slug
  ORDER BY dp.date DESC
  LIMIT 1
) dp ON TRUE
LEFT JOIN LATERAL (
  SELECT ct.raw_pct_7d, ct.raw_pct_30d, ct.raw_pct_90d
  FROM public.card_trends ct
  WHERE ct.card_name = c.card_name AND ct.set_name = c.set_name
  LIMIT 1
) ct ON TRUE
WHERE COALESCE(c.is_sealed, FALSE) = FALSE;

GRANT SELECT ON public.cards_search_v TO anon, authenticated, service_role;

-- ─── Indexes ─────────────────────────────────────────────────────────────────
-- Only the additions that don't already exist. `set_name`, `card_name`,
-- `primary_pokemon_slug` are already indexed by prior migrations.

CREATE INDEX IF NOT EXISTS idx_cards_language              ON public.cards (COALESCE(language, 'en'));
CREATE INDEX IF NOT EXISTS idx_cards_set_release_date      ON public.cards (set_release_date);
CREATE INDEX IF NOT EXISTS idx_cards_is_sealed             ON public.cards (is_sealed);
-- daily_prices already carries (card_slug, date) as the natural read
-- pattern; no new index needed there.

-- ─── RPC ─────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.search_cards_deep(
  TEXT, TEXT, TEXT, TEXT,
  INT, INT,
  INT, INT, INT, INT, INT, INT, INT, INT, INT, INT,
  NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC,
  INT, INT, NUMERIC, NUMERIC,
  TEXT, INT, INT
);

-- Block 5A-W-56A.3 — SECURITY DEFINER because Pokémon membership
-- requires reading card_pokemon, which is RLS-hidden from anon. The
-- production species RPC (get_pokemon_species_detail) uses the same
-- pattern for the same reason. Safe here because the RPC:
--   * has no write path;
--   * only projects public catalogue data (cards + daily_prices +
--     card_trends + card_pokemon membership);
--   * clamps p_limit / p_offset;
--   * validates sort against a bounded enum (no dynamic identifiers).
CREATE OR REPLACE FUNCTION public.search_cards_deep(
  -- Identity
  p_pokemon_slug        TEXT    DEFAULT NULL,
  p_card_name           TEXT    DEFAULT NULL,
  p_set_name            TEXT    DEFAULT NULL,
  p_language            TEXT    DEFAULT NULL,     -- 'en' | 'jp' | NULL (both)
  -- Date
  p_year_min            INT     DEFAULT NULL,
  p_year_max            INT     DEFAULT NULL,
  -- Prices (USD cents)
  p_raw_min             INT     DEFAULT NULL,
  p_raw_max             INT     DEFAULT NULL,
  p_psa7_min            INT     DEFAULT NULL,
  p_psa7_max            INT     DEFAULT NULL,
  p_psa8_min            INT     DEFAULT NULL,
  p_psa8_max            INT     DEFAULT NULL,
  p_psa9_min            INT     DEFAULT NULL,
  p_psa9_max            INT     DEFAULT NULL,
  p_psa10_min           INT     DEFAULT NULL,
  p_psa10_max           INT     DEFAULT NULL,
  -- Trends (%)
  p_change_7d_min       NUMERIC DEFAULT NULL,
  p_change_7d_max       NUMERIC DEFAULT NULL,
  p_change_30d_min      NUMERIC DEFAULT NULL,
  p_change_30d_max      NUMERIC DEFAULT NULL,
  p_change_90d_min      NUMERIC DEFAULT NULL,
  p_change_90d_max      NUMERIC DEFAULT NULL,
  -- Derived
  p_psa9_uplift_min     INT     DEFAULT NULL,
  p_psa10_uplift_min    INT     DEFAULT NULL,
  p_psa9_multiple_min   NUMERIC DEFAULT NULL,
  p_psa10_multiple_min  NUMERIC DEFAULT NULL,
  -- Sort + pagination
  p_sort                TEXT    DEFAULT 'name_asc',
  p_limit               INT     DEFAULT 50,
  p_offset              INT     DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lim   INT := GREATEST(1, LEAST(COALESCE(p_limit,  50), 200));
  v_off   INT := GREATEST(0, LEAST(COALESCE(p_offset, 0), 10000));
  v_total INT;
  v_rows  JSONB;
BEGIN
  -- Filtered CTE reused for both count + rows.
  WITH filtered AS (
    SELECT *
    FROM public.cards_search_v v
    WHERE
      -- Block 5A-W-56A.3 — Pokémon membership = exact species-page
      -- semantics via card_pokemon.species_slug. The 56A.2 smoke
      -- test proved card_pokemon IS populated in production (547
      -- Pikachu cards including 14 secondary associations like
      -- "Ditto (Pikachu)" and "Squirtle Vs Pikachu") — anon just
      -- can't read the table directly because of RLS. The RPC's
      -- SECURITY DEFINER declaration above lifts that gate.
      -- Rejected the OR primary_pokemon_slug pattern because it
      -- would create a second, subtly-different definition of
      -- "Pikachu card" than /pokemon/pikachu uses.
      (p_pokemon_slug IS NULL OR EXISTS (
         SELECT 1 FROM public.card_pokemon cp
         WHERE cp.card_slug = v.card_slug
           AND cp.species_slug = p_pokemon_slug
      ))
      AND (p_card_name IS NULL OR v.card_name ILIKE '%' || p_card_name || '%')
      AND (p_set_name  IS NULL OR v.set_name  ILIKE '%' || p_set_name  || '%')
      AND (p_language  IS NULL OR v.language  = p_language)
      AND (p_year_min  IS NULL OR v.release_year >= p_year_min)
      AND (p_year_max  IS NULL OR v.release_year <= p_year_max)
      AND (p_raw_min   IS NULL OR v.raw_usd   >= p_raw_min)
      AND (p_raw_max   IS NULL OR v.raw_usd   <= p_raw_max)
      AND (p_psa7_min  IS NULL OR v.psa7_usd  >= p_psa7_min)
      AND (p_psa7_max  IS NULL OR v.psa7_usd  <= p_psa7_max)
      AND (p_psa8_min  IS NULL OR v.psa8_usd  >= p_psa8_min)
      AND (p_psa8_max  IS NULL OR v.psa8_usd  <= p_psa8_max)
      AND (p_psa9_min  IS NULL OR v.psa9_usd  >= p_psa9_min)
      AND (p_psa9_max  IS NULL OR v.psa9_usd  <= p_psa9_max)
      AND (p_psa10_min IS NULL OR v.psa10_usd >= p_psa10_min)
      AND (p_psa10_max IS NULL OR v.psa10_usd <= p_psa10_max)
      AND (p_change_7d_min  IS NULL OR v.raw_pct_7d  >= p_change_7d_min)
      AND (p_change_7d_max  IS NULL OR v.raw_pct_7d  <= p_change_7d_max)
      AND (p_change_30d_min IS NULL OR v.raw_pct_30d >= p_change_30d_min)
      AND (p_change_30d_max IS NULL OR v.raw_pct_30d <= p_change_30d_max)
      AND (p_change_90d_min IS NULL OR v.raw_pct_90d >= p_change_90d_min)
      AND (p_change_90d_max IS NULL OR v.raw_pct_90d <= p_change_90d_max)
      AND (p_psa9_uplift_min    IS NULL OR v.psa9_uplift    >= p_psa9_uplift_min)
      AND (p_psa10_uplift_min   IS NULL OR v.psa10_uplift   >= p_psa10_uplift_min)
      AND (p_psa9_multiple_min  IS NULL OR v.psa9_multiple  >= p_psa9_multiple_min)
      AND (p_psa10_multiple_min IS NULL OR v.psa10_multiple >= p_psa10_multiple_min)
  ),
  paged AS (
    SELECT *
    FROM filtered
    ORDER BY
      -- Bounded enum. Every branch names a real, indexed-or-derivable column.
      -- NULLS LAST on every metric-based sort so cards without the metric
      -- sink to the bottom rather than crowding the top.
      CASE WHEN p_sort = 'name_asc'         THEN card_name        END ASC  NULLS LAST,
      CASE WHEN p_sort = 'name_desc'        THEN card_name        END DESC NULLS LAST,
      CASE WHEN p_sort = 'pokemon_asc'      THEN primary_pokemon_slug END ASC NULLS LAST,
      CASE WHEN p_sort = 'set_asc'          THEN set_name         END ASC  NULLS LAST,
      CASE WHEN p_sort = 'release_desc'     THEN set_release_date END DESC NULLS LAST,
      CASE WHEN p_sort = 'release_asc'      THEN set_release_date END ASC  NULLS LAST,
      CASE WHEN p_sort = 'raw_asc'          THEN raw_usd          END ASC  NULLS LAST,
      CASE WHEN p_sort = 'raw_desc'         THEN raw_usd          END DESC NULLS LAST,
      CASE WHEN p_sort = 'psa7_asc'         THEN psa7_usd         END ASC  NULLS LAST,
      CASE WHEN p_sort = 'psa7_desc'        THEN psa7_usd         END DESC NULLS LAST,
      CASE WHEN p_sort = 'psa8_asc'         THEN psa8_usd         END ASC  NULLS LAST,
      CASE WHEN p_sort = 'psa8_desc'        THEN psa8_usd         END DESC NULLS LAST,
      CASE WHEN p_sort = 'psa9_asc'         THEN psa9_usd         END ASC  NULLS LAST,
      CASE WHEN p_sort = 'psa9_desc'        THEN psa9_usd         END DESC NULLS LAST,
      CASE WHEN p_sort = 'psa10_asc'        THEN psa10_usd        END ASC  NULLS LAST,
      CASE WHEN p_sort = 'psa10_desc'       THEN psa10_usd        END DESC NULLS LAST,
      CASE WHEN p_sort = 'change_7d_desc'   THEN raw_pct_7d       END DESC NULLS LAST,
      CASE WHEN p_sort = 'change_7d_asc'    THEN raw_pct_7d       END ASC  NULLS LAST,
      CASE WHEN p_sort = 'change_30d_desc'  THEN raw_pct_30d      END DESC NULLS LAST,
      CASE WHEN p_sort = 'change_30d_asc'   THEN raw_pct_30d      END ASC  NULLS LAST,
      CASE WHEN p_sort = 'change_90d_desc'  THEN raw_pct_90d      END DESC NULLS LAST,
      CASE WHEN p_sort = 'change_90d_asc'   THEN raw_pct_90d      END ASC  NULLS LAST,
      CASE WHEN p_sort = 'psa9_uplift_desc'    THEN psa9_uplift    END DESC NULLS LAST,
      CASE WHEN p_sort = 'psa10_uplift_desc'   THEN psa10_uplift   END DESC NULLS LAST,
      CASE WHEN p_sort = 'psa9_multiple_desc'  THEN psa9_multiple  END DESC NULLS LAST,
      CASE WHEN p_sort = 'psa10_multiple_desc' THEN psa10_multiple END DESC NULLS LAST,
      -- Tie-break so pagination is deterministic across identical
      -- metric values (e.g. two cards with the same raw price).
      card_slug ASC
    LIMIT v_lim OFFSET v_off
  )
  SELECT
    COALESCE(jsonb_agg(to_jsonb(p) ORDER BY 1), '[]'::jsonb),
    (SELECT COUNT(*) FROM filtered)
  INTO v_rows, v_total
  FROM paged p;

  RETURN jsonb_build_object(
    'rows',        COALESCE(v_rows, '[]'::jsonb),
    'total_count', COALESCE(v_total, 0),
    'limit',       v_lim,
    'offset',      v_off,
    'sort',        p_sort
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_cards_deep TO anon, authenticated, service_role;

-- ─── Catalogue-count helper (public) ────────────────────────────────────────
-- Cheap read used by the search-page hero ("Search across N Pokémon cards").
-- Excludes sealed products so the number matches the search's own universe.

CREATE OR REPLACE FUNCTION public.count_deep_search_catalogue()
RETURNS INT
LANGUAGE sql STABLE
AS $$
  SELECT COUNT(*)::INT FROM public.cards WHERE COALESCE(is_sealed, FALSE) = FALSE
$$;

GRANT EXECUTE ON FUNCTION public.count_deep_search_catalogue TO anon, authenticated, service_role;
