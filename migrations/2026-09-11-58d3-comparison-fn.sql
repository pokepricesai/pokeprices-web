-- migrations/2026-09-11-58d3-comparison-fn.sql
--
-- Block 5A-W-58D.3 — TEMPORARY comparison function used only to
-- validate old-vs-new equivalence before cutting `get_set_cards_sortable`
-- from a LATERAL daily_prices lookup to a direct `card_latest_prices`
-- join.
--
-- What this installs:
--   * `public.get_set_cards_sortable_v2_test(text, text)` — a byte-for-
--     byte copy of the current production `get_set_cards_sortable`, with
--     ONE change: the LATERAL daily_prices subquery is replaced with a
--     direct LEFT JOIN on `public.card_latest_prices dp` keyed on
--     `dp.card_slug = 'pc-' || c.card_slug`. The `dp` alias is retained
--     so the ORDER BY structure stays visually identical; only the
--     column names change (`dp.p_raw` → `dp.raw_usd`, etc.).
--
-- Preserved byte-for-byte from production:
--   * Return signature (10 columns, exact types)
--   * LANGUAGE sql (no STABLE / IMMUTABLE — matches production default)
--   * WHERE c.set_name = set_text
--   * c.is_sealed ASC first-key ordering
--   * number_asc numeric parsing with 999999 fallback for non-numeric
--   * raw_asc, raw_desc, psa10_desc CASE clauses with NULLS LAST
--   * name_asc intentionally falls through to c.card_name ASC (no
--     dedicated CASE) — preserved
--   * Final c.card_name ASC tie-break
--   * COALESCE(c.is_sealed, FALSE) in the SELECT
--
-- What this migration does NOT do:
--   * Does not touch `get_set_cards_sortable` itself.
--   * Does not drop itself on completion — equivalence + benchmark scripts
--     need `_v2_test` to remain callable. Teardown lives in
--     `2026-09-11-58d3-comparison-fn-drop.sql` and runs AFTER cutover.
--
-- OPERATOR:
--   Paste this file into the Supabase SQL Editor and run once. Then
--   `node scripts/58d3-equivalence-check.mjs` will be callable.

-- Idempotent re-apply.
DROP FUNCTION IF EXISTS public.get_set_cards_sortable_v2_test(text, text);

CREATE FUNCTION public.get_set_cards_sortable_v2_test(set_text text, sort_col text)
 RETURNS TABLE(card_slug text, card_name text, card_number text, set_name text, raw_usd integer, psa9_usd integer, psa10_usd integer, image_url text, card_url_slug text, is_sealed boolean)
 LANGUAGE sql
AS $function$
  SELECT
    c.card_slug, c.card_name, c.card_number, c.set_name,
    dp.raw_usd, dp.psa9_usd, dp.psa10_usd,
    c.image_url, c.card_url_slug, COALESCE(c.is_sealed, FALSE)
  FROM cards c
  LEFT JOIN public.card_latest_prices dp
    ON dp.card_slug = 'pc-' || c.card_slug
  WHERE c.set_name = set_text
  ORDER BY
    c.is_sealed ASC,
    CASE
      WHEN sort_col = 'number_asc' THEN
        CASE WHEN c.card_number ~ '^\d+$' THEN c.card_number::integer ELSE 999999 END
      ELSE 0
    END ASC,
    CASE WHEN sort_col = 'raw_asc'    THEN dp.raw_usd   END ASC  NULLS LAST,
    CASE WHEN sort_col = 'raw_desc'   THEN dp.raw_usd   END DESC NULLS LAST,
    CASE WHEN sort_col = 'psa10_desc' THEN dp.psa10_usd END DESC NULLS LAST,
    c.card_name ASC;
$function$;

GRANT EXECUTE ON FUNCTION public.get_set_cards_sortable_v2_test(text, text)
  TO anon, authenticated, service_role;
