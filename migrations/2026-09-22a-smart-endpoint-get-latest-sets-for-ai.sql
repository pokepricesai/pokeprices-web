-- migrations/2026-09-22a-smart-endpoint-get-latest-sets-for-ai.sql
--
-- Stage 1 of the smart-endpoint audit (2026-09-22).
-- Revised twice:
--   * v2 (2026-09-22 audit): fix the 194 vs 227 issue by returning
--     set_metadata.total_cards instead of COUNT(*) FILTER is_sealed.
--   * v3 (2026-09-22 audit follow-up): total_cards conflates the
--     PokePrices catalogue (227 for 30th Celebration) with the
--     official printed set size (128, the denominator on every card).
--     Collectors asking "how many cards in the set" want the OFFICIAL
--     size, not the catalogue total. Split the concepts into three
--     unambiguously-named fields so the assistant cannot casually
--     conflate them.
--
-- Semantic contract for callers:
--   * official_set_size — the printed denominator (e.g. "89/128" -> 128).
--     Derived from the modal cards.set_printed_total across the set.
--     Nullable when the source column is missing/garbage. THIS is what
--     a collector means by "cards in the set". May be less than
--     catalog_rows because secret rares live above the denominator.
--   * catalog_total     — set_metadata.total_cards. All catalogue
--     entries including sealed products, promos, printed variants,
--     etc. Internal / catalogue-facing figure.
--   * catalog_rows      — COUNT(*) of cards rows. Sanity signal that
--     catalog_total is up-to-date. Should equal catalog_total when
--     the metadata is refreshed.
--
-- Adds a `name_filter` param so the assistant can look up a named
-- set directly (matching against cards.set_name), removing the need
-- for the model to guess language from a set name like "Perfect
-- Order" — JP sets in cards use the "Japanese X" prefix so a filter
-- without language works cleanly.
--
-- Return-shape change (card_count -> official_set_size + catalog_total
-- + catalog_rows + new signature) => DROP FUNCTION first.
--
-- Reversible: pure additive, no data mutation. Safe to re-run.
--
-- Verify after apply:
--   SELECT * FROM public.get_latest_sets_for_ai('en', 6, NULL);
--   -- expect: 30th Celebration => official=128 catalog_total=227
--   SELECT * FROM public.get_latest_sets_for_ai(NULL, 5, 'Perfect Order');
--   -- expect: Perfect Order    => official=88  catalog_total=219

DROP FUNCTION IF EXISTS public.get_latest_sets_for_ai(text, integer);
DROP FUNCTION IF EXISTS public.get_latest_sets_for_ai(text, integer, text);

CREATE OR REPLACE FUNCTION public.get_latest_sets_for_ai(
  lang        text    DEFAULT NULL,
  limit_count integer DEFAULT 12,
  name_filter text    DEFAULT NULL
)
RETURNS TABLE (
  set_name          text,
  language          text,
  set_release_date  date,
  release_year      integer,
  official_set_size integer,   -- printed denominator (cards.set_printed_total, modal)
  catalog_total     integer,   -- set_metadata.total_cards
  catalog_rows      integer,   -- COUNT(*) from cards
  print_run_era     text,
  has_first_edition boolean
)
LANGUAGE sql STABLE
AS $$
  WITH agg AS (
    SELECT
      c.set_name,
      c.language,
      MIN(c.set_release_date)::date  AS release_date,
      COUNT(*)::integer               AS catalog_rows
    FROM cards c
    WHERE c.set_release_date IS NOT NULL
      AND (lang        IS NULL OR c.language = lang)
      AND (name_filter IS NULL OR c.set_name ILIKE '%' || name_filter || '%')
    GROUP BY c.set_name, c.language
  ),
  printed AS (
    -- Take the mode of the numeric set_printed_total values. This
    -- absorbs the handful of rows with null / non-numeric junk so a
    -- few bad rows can't skew the answer.
    SELECT
      c.set_name,
      c.language,
      mode() WITHIN GROUP (ORDER BY c.set_printed_total::integer) AS official_set_size
    FROM cards c
    WHERE c.set_printed_total ~ '^\d+$'
      AND c.set_release_date IS NOT NULL
      AND (lang        IS NULL OR c.language = lang)
      AND (name_filter IS NULL OR c.set_name ILIKE '%' || name_filter || '%')
    GROUP BY c.set_name, c.language
  )
  SELECT
    a.set_name,
    a.language,
    a.release_date                                     AS set_release_date,
    sm.release_year,
    p.official_set_size,
    COALESCE(sm.total_cards, a.catalog_rows)::integer  AS catalog_total,
    a.catalog_rows,
    sm.print_run_era,
    sm.has_first_edition
  FROM agg a
  LEFT JOIN set_metadata sm
    ON sm.set_name = a.set_name
   AND sm.language = a.language
  LEFT JOIN printed p
    ON p.set_name = a.set_name
   AND p.language = a.language
  ORDER BY a.release_date DESC, a.set_name ASC
  LIMIT GREATEST(1, LEAST(COALESCE(limit_count, 12), 40));
$$;

GRANT EXECUTE ON FUNCTION public.get_latest_sets_for_ai(text, integer, text)
  TO authenticated, anon, service_role;

COMMENT ON FUNCTION public.get_latest_sets_for_ai(text, integer, text) IS
  'AI assistant helper. Returns the latest N sets by set_release_date, optionally filtered by language and/or set_name substring. Splits set size into three unambiguously-named fields: official_set_size (printed denominator, collector-facing), catalog_total (set_metadata.total_cards, catalogue-facing) and catalog_rows (COUNT(*) from cards). name_filter is case-insensitive ILIKE %filter% so "Perfect Order" matches without needing to guess language. Additive to get_set_list_v2 (used by /browse); no existing caller is affected.';
