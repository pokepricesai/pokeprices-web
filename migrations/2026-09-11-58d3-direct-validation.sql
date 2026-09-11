-- migrations/2026-09-11-58d3-direct-validation.sql
--
-- Block 5A-W-58D.3 — direct SQL equivalence + benchmark for the
-- `get_set_cards_sortable` LATERAL → card_latest_prices cutover.
--
-- Runs entirely inside Postgres via the Supabase SQL Editor. Does not
-- rely on PostgREST discovering the temporary function. Read-only
-- against production tables (the only writes are DROP + CREATE for the
-- temporary `_v2_test` function).
--
-- HOW TO USE
--   Paste the whole file into a fresh SQL Editor window (with nothing
--   selected) and hit Run. Read the four result-panel outputs in order:
--
--     1. Install-verify SELECT — expect exactly one row.
--     2. Equivalence table — expect `differing_rows = 0` for every row.
--     3. If any differences, the "first divergent rows" query surfaces
--        specific offending records.
--     4. Benchmark DO block — RAISE NOTICE output shows per-set,
--        per-sort avg ms for old vs new plus a speedup ratio.
--
-- Only recommend cutover if:
--   * every equivalence-table row has differing_rows = 0
--   * every benchmark line shows old_avg_ms >= new_avg_ms (speedup ≥ 1x)

-- ═══════════════════════════════════════════════════════════════════
-- A.  install / recreate the temporary comparison function
-- ═══════════════════════════════════════════════════════════════════

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

-- ═══════════════════════════════════════════════════════════════════
-- B.  verify install (expect exactly one row)
-- ═══════════════════════════════════════════════════════════════════

SELECT
  n.nspname AS schema,
  p.proname AS name,
  pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.proname = 'get_set_cards_sortable_v2_test';

-- ═══════════════════════════════════════════════════════════════════
-- C.  equivalence check — every (set, sort) combo, all 11 columns,
--     order-sensitive via row_number() over the function's own ORDER BY.
--     Expect `differing_rows = 0` on every row of the result.
-- ═══════════════════════════════════════════════════════════════════

WITH sets(set_name) AS (
  SELECT s FROM (VALUES
    ('Chaos Rising'),
    ('Astral Radiance'),
    ('Surging Sparks'),
    ('Prismatic Evolutions'),
    ('Base Set'),
    ('Base Set 2'),
    ((SELECT set_name FROM cards
       WHERE set_name ILIKE '%Promo%'
       GROUP BY set_name HAVING count(*) > 10
       ORDER BY count(*) DESC LIMIT 1))
  ) t(s) WHERE s IS NOT NULL
),
sorts(sort_col) AS (
  VALUES ('raw_desc'), ('raw_asc'), ('psa10_desc'), ('name_asc'), ('number_asc')
)
SELECT
  s.set_name,
  o.sort_col,
  (SELECT count(*) FROM public.get_set_cards_sortable(s.set_name, o.sort_col))         AS old_rows,
  (SELECT count(*) FROM public.get_set_cards_sortable_v2_test(s.set_name, o.sort_col)) AS new_rows,
  (
    SELECT count(*) FROM (
      SELECT row_number() OVER () AS rn, x.*
        FROM public.get_set_cards_sortable(s.set_name, o.sort_col) x
    ) a
    FULL OUTER JOIN (
      SELECT row_number() OVER () AS rn, y.*
        FROM public.get_set_cards_sortable_v2_test(s.set_name, o.sort_col) y
    ) b ON a.rn = b.rn
    WHERE
      a.rn IS NULL OR b.rn IS NULL
      OR a.card_slug     IS DISTINCT FROM b.card_slug
      OR a.card_name     IS DISTINCT FROM b.card_name
      OR a.card_number   IS DISTINCT FROM b.card_number
      OR a.set_name      IS DISTINCT FROM b.set_name
      OR a.raw_usd       IS DISTINCT FROM b.raw_usd
      OR a.psa9_usd      IS DISTINCT FROM b.psa9_usd
      OR a.psa10_usd     IS DISTINCT FROM b.psa10_usd
      OR a.image_url     IS DISTINCT FROM b.image_url
      OR a.card_url_slug IS DISTINCT FROM b.card_url_slug
      OR a.is_sealed     IS DISTINCT FROM b.is_sealed
  ) AS differing_rows
FROM sets s CROSS JOIN sorts o
ORDER BY s.set_name, o.sort_col;

-- ═══════════════════════════════════════════════════════════════════
-- D.  first-divergent-rows drill-down (safe to run always; produces
--     zero rows if equivalence held). Only shows up to 5 divergences
--     per combo so a bad combo doesn't blow up the result panel.
-- ═══════════════════════════════════════════════════════════════════

WITH sets(set_name) AS (
  SELECT s FROM (VALUES
    ('Chaos Rising'),
    ('Astral Radiance'),
    ('Surging Sparks'),
    ('Prismatic Evolutions'),
    ('Base Set'),
    ('Base Set 2'),
    ((SELECT set_name FROM cards
       WHERE set_name ILIKE '%Promo%'
       GROUP BY set_name HAVING count(*) > 10
       ORDER BY count(*) DESC LIMIT 1))
  ) t(s) WHERE s IS NOT NULL
),
sorts(sort_col) AS (
  VALUES ('raw_desc'), ('raw_asc'), ('psa10_desc'), ('name_asc'), ('number_asc')
),
diffs AS (
  SELECT
    s.set_name AS combo_set,
    o.sort_col AS combo_sort,
    COALESCE(a.rn, b.rn) AS rn,
    a.card_slug AS old_card_slug,
    b.card_slug AS new_card_slug,
    a.raw_usd  AS old_raw_usd,
    b.raw_usd  AS new_raw_usd,
    a.psa9_usd AS old_psa9_usd,
    b.psa9_usd AS new_psa9_usd,
    a.psa10_usd AS old_psa10_usd,
    b.psa10_usd AS new_psa10_usd,
    row_number() OVER (PARTITION BY s.set_name, o.sort_col ORDER BY COALESCE(a.rn, b.rn)) AS drill_rn
  FROM sets s CROSS JOIN sorts o
  LEFT JOIN LATERAL (
    SELECT row_number() OVER () AS rn, x.*
      FROM public.get_set_cards_sortable(s.set_name, o.sort_col) x
  ) a ON true
  FULL OUTER JOIN LATERAL (
    SELECT row_number() OVER () AS rn, y.*
      FROM public.get_set_cards_sortable_v2_test(s.set_name, o.sort_col) y
  ) b ON b.rn = a.rn
  WHERE
    a.rn IS NULL OR b.rn IS NULL
    OR a.card_slug     IS DISTINCT FROM b.card_slug
    OR a.card_name     IS DISTINCT FROM b.card_name
    OR a.card_number   IS DISTINCT FROM b.card_number
    OR a.set_name      IS DISTINCT FROM b.set_name
    OR a.raw_usd       IS DISTINCT FROM b.raw_usd
    OR a.psa9_usd      IS DISTINCT FROM b.psa9_usd
    OR a.psa10_usd     IS DISTINCT FROM b.psa10_usd
    OR a.image_url     IS DISTINCT FROM b.image_url
    OR a.card_url_slug IS DISTINCT FROM b.card_url_slug
    OR a.is_sealed     IS DISTINCT FROM b.is_sealed
)
SELECT combo_set, combo_sort, rn,
       old_card_slug, new_card_slug,
       old_raw_usd, new_raw_usd,
       old_psa9_usd, new_psa9_usd,
       old_psa10_usd, new_psa10_usd
FROM diffs WHERE drill_rn <= 5
ORDER BY combo_set, combo_sort, rn;

-- ═══════════════════════════════════════════════════════════════════
-- E.  benchmark — 1 warm-up + 5 timed calls per (set, sort, fn).
--     Emits RAISE NOTICE lines with per-call avg ms.
-- ═══════════════════════════════════════════════════════════════════

DO $$
DECLARE
  target       text;
  srt          text;
  t_start      timestamp;
  t_end        timestamp;
  old_total    interval;
  new_total    interval;
  n_calls      int := 5;
  test_sets    text[] := ARRAY['Astral Radiance', 'Surging Sparks', 'Prismatic Evolutions', 'Base Set'];
  test_sorts   text[] := ARRAY['raw_desc', 'number_asc'];
  old_avg_ms   numeric;
  new_avg_ms   numeric;
BEGIN
  RAISE NOTICE '── 58D.3 benchmark: % calls per (set, sort, fn) after 1 warm-up ──', n_calls;
  FOREACH target IN ARRAY test_sets LOOP
    FOREACH srt IN ARRAY test_sorts LOOP
      old_total := interval '0';
      new_total := interval '0';

      -- warm-up (results discarded)
      PERFORM * FROM public.get_set_cards_sortable(target, srt);
      PERFORM * FROM public.get_set_cards_sortable_v2_test(target, srt);

      -- OLD
      FOR i IN 1..n_calls LOOP
        t_start := clock_timestamp();
        PERFORM * FROM public.get_set_cards_sortable(target, srt);
        t_end := clock_timestamp();
        old_total := old_total + (t_end - t_start);
      END LOOP;

      -- NEW
      FOR i IN 1..n_calls LOOP
        t_start := clock_timestamp();
        PERFORM * FROM public.get_set_cards_sortable_v2_test(target, srt);
        t_end := clock_timestamp();
        new_total := new_total + (t_end - t_start);
      END LOOP;

      old_avg_ms := round((extract(epoch FROM old_total) * 1000.0 / n_calls)::numeric, 2);
      new_avg_ms := round((extract(epoch FROM new_total) * 1000.0 / n_calls)::numeric, 2);

      RAISE NOTICE 'set=% sort=% old_avg_ms=% new_avg_ms=% speedup=%x',
        target, srt, old_avg_ms, new_avg_ms,
        round((extract(epoch FROM old_total) /
               GREATEST(extract(epoch FROM new_total), 0.000001))::numeric, 2);
    END LOOP;
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════════
-- OPTIONAL — plan-shape verification (run any of these individually
-- to confirm the new function uses card_latest_prices and NOT a
-- per-card LATERAL scan of daily_prices).
-- ═══════════════════════════════════════════════════════════════════
--
-- EXPLAIN (ANALYZE, BUFFERS)
-- SELECT * FROM public.get_set_cards_sortable('Astral Radiance', 'raw_desc');
--
-- EXPLAIN (ANALYZE, BUFFERS)
-- SELECT * FROM public.get_set_cards_sortable_v2_test('Astral Radiance', 'raw_desc');
