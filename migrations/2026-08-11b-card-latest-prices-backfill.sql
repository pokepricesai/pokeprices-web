-- migrations/2026-08-11b-card-latest-prices-backfill.sql
--
-- Block 5A-W-56A.7a — batched backfill helper.  Run ONCE after
-- Migration A lands; then repeatedly invoke `SELECT * FROM
-- public.backfill_card_latest_prices_batch(1000);` in the SQL Editor
-- until it reports `more_remaining = false`.
--
-- Why keyset over recursive MIN() instead of a giant DISTINCT ON:
--   The one-shot `SELECT DISTINCT ON (card_slug) ... FROM daily_prices
--   ORDER BY card_slug, date DESC` timed out because it had to scan
--   the full 30M+ row table in a single transaction.  This helper
--   walks the (card_slug, date) index in bounded batches:
--
--     * A recursive CTE emits the next N distinct card_slugs strictly
--       greater than the last processed cursor.  Each recursion step
--       is one `SELECT MIN(card_slug) FROM daily_prices WHERE
--       card_slug > x` — a single index seek, ~0.5 ms.
--     * A LATERAL then resolves the LATEST daily_prices row per slug
--       (ORDER BY date DESC LIMIT 1) — also index-backed, one seek
--       per slug.
--     * The result is UPSERT-ed into card_latest_prices with the same
--       freshness guard the trigger uses (EXCLUDED.price_date >=
--       lp.price_date), so backfill and live trigger writes cannot
--       clobber each other.
--
-- Race safety:
--   The trigger from Migration A is already firing.  A card_slug X may
--   have arrived via the trigger with a newer date before backfill
--   reaches it — that is fine, the WHERE clause on the ON CONFLICT
--   discards the older backfill row.  A card_slug written by the
--   trigger with a slug > cursor does not get skipped: the cursor
--   advances only through slugs we have actually processed via the
--   recursive scan, and the trigger's write does not move the cursor.

BEGIN;

-- ─── 1. Cursor state (singleton row) ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.card_latest_prices_backfill_state (
  singleton   BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  last_slug   TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.card_latest_prices_backfill_state (singleton)
VALUES (TRUE)
ON CONFLICT (singleton) DO NOTHING;

-- ─── 2. Batched backfill function ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.backfill_card_latest_prices_batch(
  p_limit INT DEFAULT 1000
)
RETURNS TABLE (
  processed_slugs      INT,
  last_processed_slug  TEXT,
  more_remaining       BOOLEAN
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_cursor      TEXT;
  v_new_cursor  TEXT;
  v_processed   INT := 0;
  v_has_more    BOOLEAN := FALSE;
BEGIN
  -- Guard against silly inputs.
  IF p_limit IS NULL OR p_limit <= 0 THEN
    p_limit := 1000;
  ELSIF p_limit > 5000 THEN
    p_limit := 5000;
  END IF;

  SELECT last_slug INTO v_cursor
  FROM public.card_latest_prices_backfill_state
  WHERE singleton = TRUE;

  -- Recursive keyset skip-scan: emit next p_limit distinct card_slugs
  -- strictly greater than the cursor.  Each recursion step is a single
  -- index seek on (card_slug, date).
  WITH RECURSIVE distinct_slugs AS (
    SELECT
      (SELECT MIN(card_slug) FROM public.daily_prices
        WHERE card_slug > COALESCE(v_cursor, '')) AS slug,
      1 AS depth
    UNION ALL
    SELECT
      (SELECT MIN(card_slug) FROM public.daily_prices
        WHERE card_slug > ds.slug),
      ds.depth + 1
    FROM distinct_slugs ds
    WHERE ds.slug IS NOT NULL
      AND ds.depth < p_limit
  ),
  slugs AS (
    SELECT slug FROM distinct_slugs WHERE slug IS NOT NULL
  ),
  -- Bounded LATERAL — outer set is at most p_limit slugs, so each
  -- LATERAL fires at most p_limit times.  Never scans the whole table.
  latest AS (
    SELECT
      s.slug          AS card_slug,
      lp.date         AS price_date,
      lp.raw_usd,
      lp.psa7_usd,
      lp.psa8_usd,
      lp.psa9_usd,
      lp.psa10_usd
    FROM slugs s
    LEFT JOIN LATERAL (
      SELECT dp.date, dp.raw_usd, dp.psa7_usd, dp.psa8_usd, dp.psa9_usd, dp.psa10_usd
      FROM public.daily_prices dp
      WHERE dp.card_slug = s.slug
      ORDER BY dp.date DESC
      LIMIT 1
    ) lp ON TRUE
  ),
  -- Same freshness guard the trigger uses, so a live trigger write
  -- that already advanced this slug's price_date is never overwritten
  -- by an older backfill row.
  upsert AS (
    INSERT INTO public.card_latest_prices AS clp
      (card_slug, price_date, raw_usd, psa7_usd, psa8_usd, psa9_usd, psa10_usd, updated_at)
    SELECT card_slug, price_date, raw_usd, psa7_usd, psa8_usd, psa9_usd, psa10_usd, now()
    FROM latest
    WHERE price_date IS NOT NULL
    ON CONFLICT (card_slug) DO UPDATE
    SET price_date = EXCLUDED.price_date,
        raw_usd    = EXCLUDED.raw_usd,
        psa7_usd   = EXCLUDED.psa7_usd,
        psa8_usd   = EXCLUDED.psa8_usd,
        psa9_usd   = EXCLUDED.psa9_usd,
        psa10_usd  = EXCLUDED.psa10_usd,
        updated_at = now()
    WHERE EXCLUDED.price_date >= clp.price_date
    RETURNING clp.card_slug
  )
  -- We count SLUGS PROCESSED (from the CTE), not just rows changed by
  -- the UPSERT — so cursor advancement is still correct even when
  -- ON CONFLICT WHERE-clause skips a live-fresher row.
  SELECT
    (SELECT COUNT(*)::INT FROM slugs),
    (SELECT MAX(slug)     FROM slugs)
  INTO v_processed, v_new_cursor;

  -- Persist cursor only when we actually processed something.  Zero
  -- processed means we're at end-of-data; keep cursor as-is so the
  -- next call returns 0/false again cleanly.
  IF v_new_cursor IS NOT NULL THEN
    UPDATE public.card_latest_prices_backfill_state
    SET last_slug = v_new_cursor, updated_at = now()
    WHERE singleton = TRUE;
  END IF;

  -- Cheap has-more probe: any slug > new cursor?
  v_has_more := EXISTS (
    SELECT 1 FROM public.daily_prices
    WHERE card_slug > COALESCE(v_new_cursor, v_cursor, '')
    LIMIT 1
  );

  RETURN QUERY SELECT v_processed, v_new_cursor, v_has_more;
END;
$$;

GRANT EXECUTE ON FUNCTION public.backfill_card_latest_prices_batch(INT)
  TO authenticated, service_role;

COMMIT;
