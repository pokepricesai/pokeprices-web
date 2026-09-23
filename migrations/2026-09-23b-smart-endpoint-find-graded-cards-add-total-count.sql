-- migrations/2026-09-23b-smart-endpoint-find-graded-cards-add-total-count.sql
--
-- v167 follow-up (2026-09-23). Fixes a semantic bug where the AI was
-- treating the RPC's LIMIT window as the complete match universe:
--   * "I've got eight matches for you" — but the RPC returned only 8
--     of ~20 real matches.
--   * "$88 is the cheapest" — but $88 was the cheapest OF THE 8
--     RETURNED, not the cheapest overall.
--
-- Two schema changes vs the initial 2026-09-23 migration:
--   1. Adds `total_match_count` (integer) to the return table. Filled
--      via a subquery over the pre-LIMIT filtered set so every row
--      carries the true match total. Cheap: the underlying WHERE
--      clause is already computed.
--   2. Changes ORDER BY: when max_price_cents is set (user has a
--      budget), sort price ASC so the returned window represents the
--      CHEAPEST N matches — the semantically-correct answer to
--      "under $X". When no budget is set, keep the previous DESC
--      order so "show me options" returns the highest-value cards.
--
-- Signature change (added a return column) => DROP FUNCTION first.
-- Reversible: pure additive on the return shape, no data mutation.
--
-- Verify after apply:
--   SELECT card_name, price_usd_cents, total_match_count
--   FROM public.find_graded_cards_for_ai(
--     name_filter=>'Charizard', grader=>'PSA', grade=>'9',
--     max_price_cents=>10000, set_filter=>NULL, language=>'en',
--     limit_count=>8
--   );
--   -- expect: 8 rows, all with total_match_count showing the true
--   -- number of Charizard PSA 9 <= $100 EN matches (should be ~15-20).
--   -- Cards ordered by price ASCENDING (cheapest first) because a
--   -- budget was supplied.

DROP FUNCTION IF EXISTS public.find_graded_cards_for_ai(text, text, text, integer, text, text, integer);

CREATE OR REPLACE FUNCTION public.find_graded_cards_for_ai(
  name_filter      text     DEFAULT NULL,
  grader           text     DEFAULT 'PSA',
  grade            text     DEFAULT NULL,
  max_price_cents  integer  DEFAULT NULL,
  set_filter       text     DEFAULT NULL,
  language         text     DEFAULT NULL,
  limit_count      integer  DEFAULT 8
)
RETURNS TABLE (
  card_slug            text,
  card_name            text,
  set_name             text,
  card_url_slug        text,
  language             text,
  card_number          text,
  card_number_display  text,
  set_release_date     date,
  price_usd_cents      integer,
  raw_usd_cents        integer,
  psa10_usd_cents      integer,
  price_date           date,
  total_match_count    integer
)
LANGUAGE sql STABLE
AS $$
  WITH resolved AS (
    SELECT
      c.card_slug,
      c.card_name,
      c.set_name,
      c.card_url_slug,
      c.language,
      c.card_number::text        AS card_number,
      c.card_number_display,
      c.set_release_date,
      clp.raw_usd                AS raw_usd_cents,
      clp.psa10_usd              AS psa10_usd_cents,
      clp.price_date,
      CASE
        WHEN upper(grader) = 'PSA' AND grade = '7'  THEN clp.psa7_usd
        WHEN upper(grader) = 'PSA' AND grade = '8'  THEN clp.psa8_usd
        WHEN upper(grader) = 'PSA' AND grade = '9'  THEN clp.psa9_usd
        WHEN upper(grader) = 'PSA' AND grade = '10' THEN clp.psa10_usd
        WHEN upper(grader) = 'RAW' OR upper(grader) = 'UNGRADED'
                                                    THEN clp.raw_usd
      END AS price_usd_cents
    FROM cards c
    JOIN card_latest_prices clp
      ON clp.card_slug = 'pc-' || c.card_slug
    WHERE
        COALESCE(c.is_sealed, false) = false
      AND (name_filter IS NULL OR c.card_name ILIKE '%' || name_filter || '%')
      AND (set_filter  IS NULL OR c.set_name  ILIKE '%' || set_filter  || '%')
      AND (language    IS NULL OR c.language = language)
  ),
  filtered AS (
    SELECT *
    FROM resolved
    WHERE price_usd_cents IS NOT NULL
      AND price_usd_cents > 0
      AND (max_price_cents IS NULL OR price_usd_cents <= max_price_cents)
  ),
  totals AS (
    SELECT COUNT(*)::integer AS total_match_count FROM filtered
  )
  SELECT
    f.card_slug,
    f.card_name,
    f.set_name,
    f.card_url_slug,
    f.language,
    f.card_number,
    f.card_number_display,
    f.set_release_date,
    f.price_usd_cents,
    f.raw_usd_cents,
    f.psa10_usd_cents,
    f.price_date,
    t.total_match_count
  FROM filtered f
  CROSS JOIN totals t
  ORDER BY
    -- Budget set → cheapest first (matches "under $X" intent).
    -- No budget → most expensive first (matches "show me options").
    (CASE WHEN max_price_cents IS NOT NULL THEN f.price_usd_cents END) ASC NULLS LAST,
    (CASE WHEN max_price_cents IS NULL     THEN f.price_usd_cents END) DESC NULLS LAST,
    f.set_release_date DESC NULLS LAST
  LIMIT GREATEST(1, LEAST(COALESCE(limit_count, 8), 20));
$$;

GRANT EXECUTE ON FUNCTION public.find_graded_cards_for_ai(text, text, text, integer, text, text, integer)
  TO authenticated, anon, service_role;

COMMENT ON FUNCTION public.find_graded_cards_for_ai(text, text, text, integer, text, text, integer) IS
  'AI assistant helper: constrained graded-card discovery with total_match_count so the caller can distinguish returned window from complete universe. Sort is ASC (cheapest first) when max_price_cents is set, DESC otherwise. MVP supports PSA 7/8/9/10 and raw.';
