-- migrations/2026-05-10-price-history-grade-columns.sql
-- Extend get_card_price_history to expose more grade columns from
-- daily_prices. Older dates will return null for the recently-added
-- tiers; that is expected and the chart connects null values.
-- Return shape changes (4 → 14 columns) so we DROP first.

DROP FUNCTION IF EXISTS public.get_card_price_history(text);

CREATE OR REPLACE FUNCTION public.get_card_price_history(slug text)
RETURNS TABLE (
  date              date,
  raw_usd           integer,
  psa7_usd          integer,
  psa8_usd          integer,
  psa9_usd          integer,
  psa10_usd         integer,
  cgc95_usd         integer,
  cgc10_usd         integer,
  bgs10_usd         integer,
  bgs10black_usd    integer,
  cgc10pristine_usd integer,
  sgc10_usd         integer,
  tag10_usd         integer,
  ace10_usd         integer
)
LANGUAGE sql STABLE
AS $$
  SELECT
    date,
    raw_usd, psa7_usd, psa8_usd, psa9_usd, psa10_usd,
    cgc95_usd, cgc10_usd, bgs10_usd, bgs10black_usd, cgc10pristine_usd,
    sgc10_usd, tag10_usd, ace10_usd
  FROM daily_prices
  WHERE card_slug = 'pc-' || slug
  ORDER BY date ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_card_price_history(text) TO authenticated, anon;
