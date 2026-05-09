-- migrations/2026-05-09-grade-ladder-columns.sql
-- Extend get_card_detail_by_url_slug to expose the new grade-tier columns
-- the scraper now populates in daily_prices. JSON keys match DB column names
-- verbatim. All previously-exposed fields preserved exactly.

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
    -- existing grade columns (preserved)
    'raw_usd',               dp.raw_usd,
    'psa7_usd',              dp.psa7_usd,
    'psa8_usd',              dp.psa8_usd,
    'psa9_usd',              dp.psa9_usd,
    'psa10_usd',             dp.psa10_usd,
    'cgc95_usd',             dp.cgc95_usd,
    -- new low-grade PSA columns (1-6)
    'grade1_usd',            dp.grade1_usd,
    'grade2_usd',            dp.grade2_usd,
    'grade3_usd',            dp.grade3_usd,
    'grade4_usd',            dp.grade4_usd,
    'grade5_usd',            dp.grade5_usd,
    'grade6_usd',            dp.grade6_usd,
    -- new gem-mint tiers from other graders
    'tag10_usd',             dp.tag10_usd,
    'ace10_usd',             dp.ace10_usd,
    'sgc10_usd',             dp.sgc10_usd,
    'cgc10_usd',             dp.cgc10_usd,
    'bgs10_usd',             dp.bgs10_usd,
    'bgs10black_usd',        dp.bgs10black_usd,
    'cgc10pristine_usd',     dp.cgc10pristine_usd,
    -- BGS 9.5 (analogous to existing cgc95_usd)
    'bgs95_usd',             dp.bgs95_usd
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
