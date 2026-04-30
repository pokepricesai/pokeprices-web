-- 2026-04-30 — Portfolio improvements
-- Adds: display currency preference, manual value override on holdings,
-- and ensures the (portfolio_id, card_slug, holding_type) uniqueness that
-- the upsert in handleAddCard relies on (without it, "upserts" silently
-- become inserts and you get duplicates — the booster-bundle-shows-20-times
-- bug Luke reported).

-- 1. Display currency on email-prefs row (already used by the dashboard area)
ALTER TABLE user_email_preferences
  ADD COLUMN IF NOT EXISTS display_currency TEXT
    DEFAULT 'GBP'
    CHECK (display_currency IN ('GBP', 'USD'));

-- 2. Manual current-value override on individual holdings.
-- When non-null, the dashboard prefers this over the market-derived value.
ALTER TABLE portfolio_items
  ADD COLUMN IF NOT EXISTS manual_value_cents BIGINT;

-- 3. Make the upsert key actually unique. Without this, ON CONFLICT just
-- does nothing and the row inserts as a duplicate. Run carefully — if
-- this errors with "could not create unique index" you have existing
-- duplicates to clean up first (see helper query below).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'portfolio_items'
      AND indexname = 'idx_portfolio_items_unique_holding'
  ) THEN
    CREATE UNIQUE INDEX idx_portfolio_items_unique_holding
      ON portfolio_items (portfolio_id, card_slug, holding_type);
  END IF;
END $$;

-- ── Helper query to find pre-existing duplicates (run manually if step 3 fails)
-- Comment-only — paste into the SQL editor if needed:
--
--   SELECT portfolio_id, card_slug, holding_type, COUNT(*) AS dupes,
--          ARRAY_AGG(id ORDER BY created_at DESC) AS ids
--   FROM portfolio_items
--   GROUP BY portfolio_id, card_slug, holding_type
--   HAVING COUNT(*) > 1;
--
-- To keep only the most-recent duplicate of each:
--   DELETE FROM portfolio_items
--   WHERE id IN (
--     SELECT id FROM (
--       SELECT id, ROW_NUMBER() OVER (
--         PARTITION BY portfolio_id, card_slug, holding_type
--         ORDER BY created_at DESC
--       ) AS rn
--       FROM portfolio_items
--     ) t WHERE rn > 1
--   );
