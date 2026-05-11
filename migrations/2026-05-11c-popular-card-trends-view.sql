-- migrations/2026-05-11c-popular-card-trends-view.sql
-- Server-side join of card_trends × cards × card_volume so the Content
-- Studio edge function can query "popular cards with trend data" in a
-- single request without sending hundreds of (name, set) pairs through
-- the URL .in() filter (which trips HTTP/2 protocol limits).
--
-- "Popular" = Ungraded sales_30d >= 5, confidence in high/medium,
-- and the set name doesn't contain "topps" (excluded per content rules).

CREATE OR REPLACE VIEW public.popular_card_trends AS
SELECT
  ct.card_name,
  ct.set_name,
  c.card_slug,
  c.image_url,
  c.card_url_slug,
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
