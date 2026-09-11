-- migrations/2026-09-11-set-cards-sortable-latest-price-cutover.sql
--
-- Block 5A-W-58D.3 — cut `public.get_set_cards_sortable(text, text)`
-- from a per-card LATERAL daily_prices lookup to a direct
-- `card_latest_prices` join. Same anti-pattern that was already cut for
-- `search_cards_deep` in 2026-08-11c. Deep Search now joins
-- `card_latest_prices` and the snapshot is trigger-maintained from
-- `daily_prices` (see 2026-08-11a for the schema, 2026-08-11b for the
-- backfill). Coverage on the six test sets used for W-58D.3 is 100% of
-- the `daily_prices` card set (Δ=0), so this cutover is output-equivalent
-- once `scripts/58d3-equivalence-check.mjs` reports zero diffs.
--
-- SAFETY
--   * CREATE OR REPLACE is atomic; concurrent readers never see the
--     function absent.
--   * Signature, return columns, RPC name, LANGUAGE all unchanged, so
--     client code needs no redeploy.
--   * Every sort clause (`c.is_sealed ASC` first, numeric parsing of
--     `card_number` with 999999 fallback for non-numeric, NULLS LAST on
--     price sorts, `c.card_name ASC` tie-break, `name_asc` falling
--     through to the tie-break with no dedicated CASE) is preserved
--     byte-for-byte from the current body.
--   * The `dp` alias is retained (now bound to `card_latest_prices`
--     instead of the LATERAL subquery) so the ORDER BY structure stays
--     visually identical; only three column-name references change:
--       dp.p_raw   → dp.raw_usd
--       dp.p_psa9  → dp.psa9_usd
--       dp.p_psa10 → dp.psa10_usd
--
-- HOW TO RUN
--   Do NOT run until:
--     1. `2026-09-11-58d3-comparison-fn.sql` has been applied.
--     2. `node scripts/58d3-equivalence-check.mjs` reports zero diffs.
--     3. `node scripts/58d3-benchmark.mjs` reports equal-or-faster.
--   Then paste this file into the Supabase SQL Editor and execute.
--
-- ROLLBACK
--   See the commented ROLLBACK block at the bottom.

CREATE OR REPLACE FUNCTION public.get_set_cards_sortable(set_text text, sort_col text)
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

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK — paste-back of the OLD LATERAL body verbatim.
--
-- If a regression is observed post-cutover, revert by re-running the
-- pre-cutover body with CREATE OR REPLACE (atomic, no downtime):
--
-- CREATE OR REPLACE FUNCTION public.get_set_cards_sortable(set_text text, sort_col text)
--  RETURNS TABLE(card_slug text, card_name text, card_number text, set_name text, raw_usd integer, psa9_usd integer, psa10_usd integer, image_url text, card_url_slug text, is_sealed boolean)
--  LANGUAGE sql
-- AS $function$
--   SELECT
--     c.card_slug, c.card_name, c.card_number, c.set_name,
--     dp.p_raw, dp.p_psa9, dp.p_psa10,
--     c.image_url, c.card_url_slug, COALESCE(c.is_sealed, FALSE)
--   FROM cards c
--   LEFT JOIN LATERAL (
--     SELECT raw_usd AS p_raw, psa9_usd AS p_psa9, psa10_usd AS p_psa10
--     FROM daily_prices
--     WHERE card_slug = 'pc-' || c.card_slug
--     ORDER BY date DESC LIMIT 1
--   ) dp ON true
--   WHERE c.set_name = set_text
--   ORDER BY
--     c.is_sealed ASC,
--     CASE
--       WHEN sort_col = 'number_asc' THEN
--         CASE WHEN c.card_number ~ '^\d+$' THEN c.card_number::integer ELSE 999999 END
--       ELSE 0
--     END ASC,
--     CASE WHEN sort_col = 'raw_asc'    THEN dp.p_raw   END ASC  NULLS LAST,
--     CASE WHEN sort_col = 'raw_desc'   THEN dp.p_raw   END DESC NULLS LAST,
--     CASE WHEN sort_col = 'psa10_desc' THEN dp.p_psa10 END DESC NULLS LAST,
--     c.card_name ASC;
-- $function$;
-- ─────────────────────────────────────────────────────────────────────────────
