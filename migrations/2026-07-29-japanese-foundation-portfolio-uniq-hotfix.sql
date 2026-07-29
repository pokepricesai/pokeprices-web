-- migrations/2026-07-29-japanese-foundation-portfolio-uniq-hotfix.sql
--
-- Block 5A-W-48B-FINAL — post-deploy hotfix.
--
-- Deployment verification uncovered that portfolio_items carries TWO
-- separate uniqueness enforcers on the old 3-column key
-- (portfolio_id, card_slug, holding_type):
--
--   1. UNIQUE INDEX  idx_portfolio_items_unique_holding
--      — created by migrations/2026-04-30-portfolio-improvements.sql.
--        Correctly replaced by 2026-07-29-japanese-foundation.sql to
--        the 4-column key (adds set_name_snapshot).
--
--   2. UNIQUE CONSTRAINT  portfolio_items_portfolio_id_card_slug_holding_type_key
--      — created earlier, undocumented in any tracked migration. Not
--        touched by the foundation migration. Still enforces the old
--        3-column key and blocks dual-version portfolio entries.
--
-- Live evidence (2026-07-29):
--   POST /rest/v1/portfolio_items → HTTP 409
--     "duplicate key value violates unique constraint
--      portfolio_items_portfolio_id_card_slug_holding_type_key"
--     when inserting a Japanese Battle Partners row for a card_slug
--     that already exists under a different set_name_snapshot.
--
-- Fix: drop the old constraint. The uniqueness the application
-- actually relies on is the 4-column index (which the foundation
-- migration rebuilt with set_name_snapshot in the key).
--
-- Safe to run twice: DROP CONSTRAINT IF EXISTS.
--
-- Rollback: re-add the old constraint. Only safe when no dual-version
-- rows exist yet; if any dual-version portfolio entries have been
-- inserted, the ADD CONSTRAINT step will fail on the existing dupes.

BEGIN;

ALTER TABLE public.portfolio_items
  DROP CONSTRAINT IF EXISTS portfolio_items_portfolio_id_card_slug_holding_type_key;

-- Sanity: assert the replacement index is still in place. If the
-- foundation migration was not applied for any reason, the next
-- INSERT would have no uniqueness backing at all — which is worse
-- than the old blocked-dual-version state. Fail loudly here.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename  = 'portfolio_items'
       AND indexname  = 'idx_portfolio_items_unique_holding'
  ) THEN
    RAISE EXCEPTION 'Prerequisite missing: idx_portfolio_items_unique_holding does not exist. Apply 2026-07-29-japanese-foundation.sql first.';
  END IF;
END $$;

COMMIT;

-- Rollback:
--   BEGIN;
--   ALTER TABLE public.portfolio_items
--     ADD CONSTRAINT portfolio_items_portfolio_id_card_slug_holding_type_key
--       UNIQUE (portfolio_id, card_slug, holding_type);
--   COMMIT;
