-- migrations/2026-08-11a-card-latest-prices-schema.sql
--
-- Block 5A-W-56A.7a — schema + trigger only.  Fast and safe to run in
-- the Supabase SQL Editor.
--
-- What this installs:
--   * public.card_latest_prices — one row per card (PK = card_slug,
--     pc-prefixed to match daily_prices' key convention).
--   * public.upsert_card_latest_prices() + trg_daily_prices_upsert_latest
--     — AFTER trigger on daily_prices that keeps the snapshot fresh
--     from the moment this migration lands.  The trigger's freshness
--     guard (EXCLUDED.price_date >= lp.price_date) ensures backfill
--     rows applied later can never overwrite live-writer rows that
--     already carry a newer date.
--
-- What this migration does NOT do:
--   * No historical backfill.  That is Migration B (the batched
--     helper) driven manually per-batch by the operator.
--   * No cards_search_v / search_cards_deep changes.  Those come in
--     Migration C, run only after the backfill is complete, so Deep
--     Search never reads from a partially populated snapshot.
--
-- Sequence expected by the operator:
--   1. Run THIS file (Migration A).
--   2. Run Migration B once (installs the batched helper).
--   3. Repeatedly run the batch helper until it reports no more
--      remaining rows.
--   4. Run the coverage verification query.
--   5. Run Migration C (view + RPC cutover).

BEGIN;

-- ─── 1. Snapshot table ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.card_latest_prices (
  -- pc-prefixed to match the daily_prices key convention.  Deep Search
  -- will join with `lp.card_slug = 'pc-' || cards.card_slug`.
  card_slug   TEXT PRIMARY KEY,
  price_date  DATE NOT NULL,
  raw_usd     INTEGER,
  psa7_usd    INTEGER,
  psa8_usd    INTEGER,
  psa9_usd    INTEGER,
  psa10_usd   INTEGER,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.card_latest_prices TO anon, authenticated, service_role;

-- ─── 2. Trigger function ───────────────────────────────────────────────────
--
-- Fires on every INSERT or UPDATE of a daily_prices row.  The scraper's
-- `INSERT ... ON CONFLICT (card_slug, date, source) DO UPDATE` shape
-- fires the AFTER trigger for both branches, so no scraper change is
-- needed.
--
-- Freshness guard: EXCLUDED.price_date >= lp.price_date so a stale
-- historical backfill row can never overwrite a newer live-scrape row.
-- Same-date rewrites (a second source posting later in the same batch)
-- are permitted so the snapshot converges toward the most recently
-- written row per date — matches the current LATERAL semantics.

CREATE OR REPLACE FUNCTION public.upsert_card_latest_prices()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.card_latest_prices AS lp (
    card_slug, price_date,
    raw_usd, psa7_usd, psa8_usd, psa9_usd, psa10_usd,
    updated_at
  )
  VALUES (
    NEW.card_slug, NEW.date,
    NEW.raw_usd, NEW.psa7_usd, NEW.psa8_usd, NEW.psa9_usd, NEW.psa10_usd,
    now()
  )
  ON CONFLICT (card_slug) DO UPDATE
  SET price_date = EXCLUDED.price_date,
      raw_usd    = EXCLUDED.raw_usd,
      psa7_usd   = EXCLUDED.psa7_usd,
      psa8_usd   = EXCLUDED.psa8_usd,
      psa9_usd   = EXCLUDED.psa9_usd,
      psa10_usd  = EXCLUDED.psa10_usd,
      updated_at = now()
  WHERE EXCLUDED.price_date >= lp.price_date;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_daily_prices_upsert_latest ON public.daily_prices;
CREATE TRIGGER trg_daily_prices_upsert_latest
  AFTER INSERT OR UPDATE ON public.daily_prices
  FOR EACH ROW
  EXECUTE FUNCTION public.upsert_card_latest_prices();

COMMIT;
