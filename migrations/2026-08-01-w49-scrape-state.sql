-- Block 5A-W-49: minimal narrow scrape-attempt state for cadence
-- classification. Backs the WEEKLY_UNPRICED transition (three
-- successful no-price fetches → weekly) and the DAILY_DISCOVERY
-- retry-on-transient path.
--
-- Intentionally NOT a duplicate of daily_prices — this table stores
-- ATTEMPT and RESULT-CATEGORY state only. Never holds price values.
-- daily_prices remains the sole store for observed price observations.
--
-- Idempotent: safe to run more than once. Includes rollback guidance.

BEGIN;

-- The result category enum:
--   priced                     -- scraper extracted at least one price
--   page_reached_no_price      -- HTTP 200 + valid product page, no
--                                 price fields were extractable
--   not_found                  -- HTTP 404 or PriceCharting redirected
--                                 to a search-page fallback
--   transient_http_failure     -- 429 / 5xx / connection reset,
--                                 retry-eligible
--   timeout                    -- request-level timeout, retry-eligible
--   incorrect_product_rejected -- console-name mismatch or seeder-side
--                                 identity check refused the row
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'scrape_result_category'
  ) THEN
    CREATE TYPE public.scrape_result_category AS ENUM (
      'priced',
      'page_reached_no_price',
      'not_found',
      'transient_http_failure',
      'timeout',
      'incorrect_product_rejected'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.scrape_attempt_state (
  card_slug                              TEXT PRIMARY KEY
    REFERENCES public.cards(card_slug) ON DELETE CASCADE,
  last_attempted_at                      TIMESTAMPTZ,
  last_successful_fetch_at               TIMESTAMPTZ,
  last_result_category                   public.scrape_result_category,
  consecutive_successful_no_price_count  INTEGER NOT NULL DEFAULT 0
    CHECK (consecutive_successful_no_price_count >= 0),
  last_http_status                       INTEGER,
  updated_at                             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Speed the daily cadence filter: cards last flagged as transient
-- failure are due for retry sooner than the general daily queue.
CREATE INDEX IF NOT EXISTS scrape_attempt_state_last_result_idx
  ON public.scrape_attempt_state (last_result_category);

CREATE INDEX IF NOT EXISTS scrape_attempt_state_updated_at_idx
  ON public.scrape_attempt_state (updated_at DESC);

-- Auto-bump updated_at on UPDATE.
CREATE OR REPLACE FUNCTION public.tg_scrape_attempt_state_touch()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS scrape_attempt_state_touch ON public.scrape_attempt_state;
CREATE TRIGGER scrape_attempt_state_touch
  BEFORE UPDATE ON public.scrape_attempt_state
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_scrape_attempt_state_touch();

COMMIT;

-- ROLLBACK guidance (run in a separate transaction if the table has
-- to be dropped — normal deployment does not need to run these):
--   BEGIN;
--   DROP TRIGGER  IF EXISTS scrape_attempt_state_touch ON public.scrape_attempt_state;
--   DROP FUNCTION IF EXISTS public.tg_scrape_attempt_state_touch();
--   DROP TABLE    IF EXISTS public.scrape_attempt_state;
--   DROP TYPE     IF EXISTS public.scrape_result_category;
--   COMMIT;
