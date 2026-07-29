-- migrations/2026-07-29-japanese-foundation.sql
--
-- Block 5A-W-48B — Japanese card foundation.
--
-- This is a small, additive schema migration that lets English and
-- Japanese Pokémon printings coexist as separate catalogue rows with
-- separate price histories. Nothing about the English data changes.
-- Every new column defaults to 'en' so existing English rows are
-- correctly labelled automatically.
--
-- What this migration does:
--   1. Adds a language column to cards, set_metadata (default 'en').
--   2. Extends provider_card_links.language to allow 'jp'.
--   3. Rewrites the watchlist and portfolio_items uniqueness so a
--      user can own both English Pikachu and Japanese Pikachu.
--   4. Rewrites watchlist_alert_overrides uniqueness for the same
--      reason.
--   5. Rebuilds popular_card_trends to carry c.language.
--   6. Republishes get_card_detail_by_url_slug (which the card page
--      calls) to include language in the returned JSON.
--   7. Republishes scan_card_match (the scanner RPC — full v10 body
--      preserved verbatim) with a language column threaded through so
--      the scanner can distinguish JP from EN candidates.
--
-- What this migration does NOT do:
--   * Import any Japanese card data.
--   * Change any existing price rows.
--   * Add any translation / hreflang / multilingual infrastructure.
--   * Touch search_global or get_set_list_v2 — those RPCs are not
--     versioned into this git repo. The web client tolerates a
--     missing language field by defaulting to 'en'.
--
-- Safe to run twice: every step is IF NOT EXISTS / DROP + recreate /
-- CREATE OR REPLACE. Wrapped in a single transaction so a failure
-- rolls the whole thing back cleanly.
--
-- Prerequisite: run 2026-07-29-japanese-foundation-preflight.sql
-- first and confirm all zero-leakage queries return empty.

BEGIN;

-- ── 1. Language columns on cards + set_metadata ─────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'cards' AND column_name = 'language'
  ) THEN
    ALTER TABLE public.cards
      ADD COLUMN language TEXT NOT NULL DEFAULT 'en'
        CHECK (language IN ('en', 'jp'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'set_metadata' AND column_name = 'language'
  ) THEN
    ALTER TABLE public.set_metadata
      ADD COLUMN language TEXT NOT NULL DEFAULT 'en'
        CHECK (language IN ('en', 'jp'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_cards_language_jp
  ON public.cards (language)
  WHERE language = 'jp';

CREATE INDEX IF NOT EXISTS idx_set_metadata_language_jp
  ON public.set_metadata (language)
  WHERE language = 'jp';

-- ── 2. Extend provider_card_links.language CHECK ────────────────

DO $$
DECLARE
  cname TEXT;
BEGIN
  SELECT conname INTO cname
    FROM pg_constraint
   WHERE conrelid = 'public.provider_card_links'::regclass
     AND contype  = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%language%';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.provider_card_links DROP CONSTRAINT %I', cname);
  END IF;
  ALTER TABLE public.provider_card_links
    ADD CONSTRAINT provider_card_links_language_check
      CHECK (language IN ('en', 'jp'));
END $$;

-- ── 3. Watchlist uniqueness — allow (user, card_slug, set_name) ─
--
-- Old: UNIQUE (user_id, card_slug).
-- New: UNIQUE (user_id, card_slug, set_name).
-- A user can now watch both the English and the Japanese printing of
-- the same card even when card_url_slug (stored in the card_slug
-- column) collides.

DO $$
DECLARE
  cname TEXT;
BEGIN
  SELECT conname INTO cname
    FROM pg_constraint
   WHERE conrelid = 'public.watchlist'::regclass
     AND contype  = 'u'
     AND pg_get_constraintdef(oid) LIKE '%(user_id, card_slug)%';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.watchlist DROP CONSTRAINT %I', cname);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.watchlist'::regclass
       AND contype  = 'u'
       AND pg_get_constraintdef(oid) LIKE '%(user_id, card_slug, set_name)%'
  ) THEN
    ALTER TABLE public.watchlist
      ADD CONSTRAINT watchlist_user_card_set_uniq
        UNIQUE (user_id, card_slug, set_name);
  END IF;
END $$;

-- ── 4. Portfolio_items uniqueness ────────────────────────────────
--
-- The current uniqueness is a partial UNIQUE INDEX named
-- idx_portfolio_items_unique_holding on (portfolio_id, card_slug,
-- holding_type). The portfolio_items table stores the set name in a
-- column called set_name_snapshot (NOT set_name — that column lives on
-- watchlist, cards, etc.). Adding set_name_snapshot to the uniqueness
-- key lets a portfolio own both English and Japanese Pikachu at the
-- same holding_type.

DROP INDEX IF EXISTS public.idx_portfolio_items_unique_holding;

CREATE UNIQUE INDEX IF NOT EXISTS idx_portfolio_items_unique_holding
  ON public.portfolio_items (portfolio_id, card_slug, set_name_snapshot, holding_type);

-- ── 5. watchlist_alert_overrides uniqueness ─────────────────────
--
-- Deferred to W48C. Live schema introspection (2026-07-29) confirms
-- watchlist_alert_overrides has columns:
--   id, user_id, card_slug, enabled, use_global_defaults,
--   rise_pct, drop_pct, recent_sales_enabled, market_activity_enabled,
--   created_at, updated_at
-- — but NO set_name column. Extending its UNIQUE by set_name requires
-- an ADD COLUMN + backfill from watchlist first, which is a bigger
-- surface than the pilot needs. The consequence for the pilot is that
-- a user with both an English Pikachu and a Japanese Pikachu on their
-- watchlist would share alert override rules across the two printings.
-- Acceptable for pilot; revisit in W48C after the pilot proves out.
--
-- No statements are issued for this section — the existing
-- (user_id, card_slug) UNIQUE remains in place.

-- ── 6. Rebuild popular_card_trends view with language ───────────

DROP VIEW IF EXISTS public.popular_card_trends;

CREATE VIEW public.popular_card_trends AS
SELECT
  ct.card_name,
  ct.set_name,
  c.card_slug,
  c.image_url,
  c.card_url_slug,
  c.card_number,
  c.card_number_display,
  c.set_printed_total,
  c.is_sealed,
  c.language,
  ct.current_raw,
  ct.current_psa10,
  ct.raw_pct_7d,
  ct.raw_pct_30d,
  ct.raw_pct_90d,
  ct.raw_pct_365d,
  ct.raw_pct_2y,
  ct.raw_pct_5y,
  cv.sales_30d
FROM public.card_trends ct
JOIN public.cards c
  ON c.card_name = ct.card_name AND c.set_name = ct.set_name
JOIN public.card_volume cv
  ON cv.card_slug = c.card_slug AND cv.grade = 'Ungraded'
WHERE cv.sales_30d >= 5
  AND cv.confidence IN ('high', 'medium')
  AND c.set_name NOT ILIKE '%topps%';

GRANT SELECT ON public.popular_card_trends TO anon, authenticated, service_role;

-- ── 7. get_card_detail_by_url_slug — add language passthrough ──

CREATE OR REPLACE FUNCTION public.get_card_detail_by_url_slug(p_set_name TEXT, p_card_url_slug TEXT)
RETURNS json
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    'card_slug',             c.card_slug,
    'card_name',             c.card_name,
    'set_name',              c.set_name,
    'card_number',           c.card_number,
    'card_number_display',   c.card_number_display,
    'set_printed_total',     c.set_printed_total,
    'pc_url',                c.pc_url,
    'image_url',             c.image_url,
    'card_url_slug',         c.card_url_slug,
    'primary_pokemon_slug',  c.primary_pokemon_slug,
    'raw_usd',               dp.raw_usd,
    'psa7_usd',              dp.psa7_usd,
    'psa8_usd',              dp.psa8_usd,
    'psa9_usd',              dp.psa9_usd,
    'psa10_usd',             dp.psa10_usd,
    'cgc95_usd',             dp.cgc95_usd,
    'grade1_usd',            dp.grade1_usd,
    'grade2_usd',            dp.grade2_usd,
    'grade3_usd',            dp.grade3_usd,
    'grade4_usd',            dp.grade4_usd,
    'grade5_usd',            dp.grade5_usd,
    'grade6_usd',            dp.grade6_usd,
    'tag10_usd',             dp.tag10_usd,
    'ace10_usd',             dp.ace10_usd,
    'sgc10_usd',             dp.sgc10_usd,
    'cgc10_usd',             dp.cgc10_usd,
    'bgs10_usd',             dp.bgs10_usd,
    'bgs10black_usd',        dp.bgs10black_usd,
    'cgc10pristine_usd',     dp.cgc10pristine_usd,
    'bgs95_usd',             dp.bgs95_usd,
    'language',              c.language
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

-- ── 8. scan_card_match v10 + language column ─────────────────────
--
-- Full v10 body preserved verbatim from
-- 2026-05-15c-scan-match-v10-name-gate-tighten.sql, with the single
-- extension of `language` threaded through: added to the RETURNS
-- TABLE, selected from cards in `base`, and re-emitted in the final
-- SELECT. All other logic (name gate 0.30, promo handling, ranking,
-- scoring) unchanged.

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
  confidence          real,
  language            text
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
      + (CASE WHEN w.set_match   THEN 0.03::real ELSE 0::real END)
      + (CASE WHEN w.year_match  THEN 0.03::real ELSE 0::real END)
      + (CASE WHEN w.promo_match THEN 0.04::real ELSE 0::real END)
    ) AS confidence,
    w.language
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

COMMIT;

-- ── Rollback plan ────────────────────────────────────────────────
--
-- If W48B needs to be reverted before any Japanese data lands:
--
--   BEGIN;
--   ALTER TABLE public.watchlist            DROP CONSTRAINT IF EXISTS watchlist_user_card_set_uniq;
--   ALTER TABLE public.watchlist            ADD CONSTRAINT watchlist_user_id_card_slug_key UNIQUE (user_id, card_slug);
--   DROP INDEX IF EXISTS public.idx_portfolio_items_unique_holding;
--   CREATE UNIQUE INDEX idx_portfolio_items_unique_holding
--     ON public.portfolio_items (portfolio_id, card_slug, holding_type);
--   -- Note: rollback assumes English-only data. If Japanese pilot rows
--   -- exist, the new uniqueness may not be dropable without dedupe.
--   -- watchlist_alert_overrides untouched by this migration — nothing to roll back there.
--   ALTER TABLE public.cards        DROP COLUMN IF EXISTS language;
--   ALTER TABLE public.set_metadata DROP COLUMN IF EXISTS language;
--   ALTER TABLE public.provider_card_links DROP CONSTRAINT IF EXISTS provider_card_links_language_check;
--   ALTER TABLE public.provider_card_links ADD  CONSTRAINT provider_card_links_language_check CHECK (language IN ('en'));
--   -- Rebuild popular_card_trends without the language column (2026-05-11d body):
--   DROP VIEW IF EXISTS public.popular_card_trends;
--   CREATE VIEW public.popular_card_trends AS
--     SELECT ct.card_name, ct.set_name, c.card_slug, c.image_url, c.card_url_slug,
--            c.card_number, c.card_number_display, c.set_printed_total, c.is_sealed,
--            ct.current_raw, ct.current_psa10, ct.raw_pct_7d, ct.raw_pct_30d,
--            ct.raw_pct_90d, ct.raw_pct_365d, ct.raw_pct_2y, ct.raw_pct_5y, cv.sales_30d
--       FROM public.card_trends ct
--       JOIN public.cards c ON c.card_name = ct.card_name AND c.set_name = ct.set_name
--       JOIN public.card_volume cv ON cv.card_slug = c.card_slug AND cv.grade = 'Ungraded'
--      WHERE cv.sales_30d >= 5 AND cv.confidence IN ('high','medium')
--        AND c.set_name NOT ILIKE '%topps%';
--   GRANT SELECT ON public.popular_card_trends TO anon, authenticated, service_role;
--   -- Re-run migrations/2026-05-09-grade-ladder-columns.sql and
--   -- 2026-05-15c-scan-match-v10-name-gate-tighten.sql to restore the
--   -- pre-W48B RPC bodies.
--   COMMIT;
