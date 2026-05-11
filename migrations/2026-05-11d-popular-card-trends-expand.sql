-- migrations/2026-05-11d-popular-card-trends-expand.sql
-- Expand popular_card_trends with card_number / card_number_display /
-- set_printed_total / is_sealed so the Content Studio can:
--   1. Show "123/165" style numbers on tiles instead of "#123"
--   2. Toggle Card Battle between cards / sealed / mixed
--   3. Surface the right metadata without an extra round-trip.
--
-- Postgres can't reorder a view's columns via CREATE OR REPLACE, so we
-- DROP and re-create.

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
