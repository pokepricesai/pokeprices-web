-- migrations/2026-09-23-smart-endpoint-find-graded-cards.sql
--
-- v167 smart-endpoint fix (2026-09-23). Adds a deterministic
-- constrained-graded-card discovery RPC so the AI assistant can
-- honestly answer "buy me a Charizard PSA 9 under $100" queries
-- against real PokePrices price data instead of guessing.
--
-- Real user regression that motivated this:
--   User: "I want to buy a charizard for under $100 PSA 9"
--   Assistant (v166 and earlier): claimed there were none, without
--       ever querying the DB.
--   Ground truth (probed 2026-09-23): 20+ Charizard rows in
--       card_latest_prices with psa9_usd <= 10000 cents.
--
-- Design:
--   * Reads card_latest_prices (compact one-row-per-slug snapshot
--     that is trigger-maintained from daily_prices; see
--     migrations/2026-08-11a-card-latest-prices-schema.sql).
--   * Joins to cards for card_name / set_name / card_url_slug /
--     language / card_number_display / set_release_date.
--   * Grader/grade combinations resolved to daily_prices columns
--     via CASE — no string interpolation, no SQL injection.
--   * MVP scope: PSA 7 / PSA 8 / PSA 9 / PSA 10 + raw. Other
--     graders (CGC / BGS / SGC / TAG / ACE) can be added later by
--     reading daily_prices directly (all their columns exist there
--     but card_latest_prices only carries PSA 7-10 + raw).
--   * `max_price_cents` filter is INCLUSIVE — a $99.00 card matches
--     `max_price_cents=10000`.
--   * ORDER BY price DESC, so the returned rows are the most
--     expensive within budget — usually the most desirable
--     candidates from a collector standpoint (better cards for
--     the budget).
--   * NULL max_price → no budget filter, returns the most expensive
--     matches so the caller can pick a "closest over budget"
--     candidate for a zero-result honesty hedge.
--
-- Reversible: pure additive. Safe to re-run (DROP FUNCTION IF
-- EXISTS before CREATE).
--
-- Verify after apply:
--   SELECT * FROM public.find_graded_cards_for_ai(
--     name_filter    => 'Charizard',
--     grader         => 'PSA',
--     grade          => '9',
--     max_price_cents=> 10000,
--     set_filter     => NULL,
--     language       => 'en',
--     limit_count    => 8
--   );
--   -- expect: real cards like Charizard EX Flashfire, Charizard
--   -- Theme Deck Vivid Voltage, Charizard VSTAR Brilliant Stars.

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
  price_date           date
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
      c.card_number,
      c.card_number_display,
      c.set_release_date,
      clp.raw_usd    AS raw_usd_cents,
      clp.psa10_usd  AS psa10_usd_cents,
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
  )
  SELECT
    card_slug,
    card_name,
    set_name,
    card_url_slug,
    language,
    card_number::text          AS card_number,
    card_number_display,
    set_release_date,
    price_usd_cents,
    raw_usd_cents,
    psa10_usd_cents,
    price_date
  FROM resolved
  WHERE price_usd_cents IS NOT NULL
    AND price_usd_cents > 0
    AND (max_price_cents IS NULL OR price_usd_cents <= max_price_cents)
  ORDER BY price_usd_cents DESC, set_release_date DESC NULLS LAST
  LIMIT GREATEST(1, LEAST(COALESCE(limit_count, 8), 20));
$$;

GRANT EXECUTE ON FUNCTION public.find_graded_cards_for_ai(text, text, text, integer, text, text, integer)
  TO authenticated, anon, service_role;

COMMENT ON FUNCTION public.find_graded_cards_for_ai(text, text, text, integer, text, text, integer) IS
  'AI assistant helper: constrained graded-card discovery. Filters cards + card_latest_prices by name / set / language, resolves grader+grade to the correct price column, applies max_price_cents budget, and returns top matches ordered by price descending. MVP supports PSA 7/8/9/10 and raw; other graders can be added by extending the CASE expression. Excludes sealed products.';
