-- migrations/2026-07-29-japanese-foundation-preflight.sql
--
-- Block 5A-W-48B — PRE-flight read-only checks BEFORE the foundation
-- migration. Paste this into the Supabase SQL Editor and confirm the
-- expected results before running 2026-07-29-japanese-foundation.sql.
--
-- Every query here is read-only. Run each block in isolation and copy
-- the row counts into the W48B report.

-- ── 1. Zero-leakage: any card row already looks Japanese? ─────

-- Expected: 0 rows.
SELECT set_name, COUNT(*) AS n
  FROM cards
 WHERE set_name ILIKE '%japan%'
    OR set_name ILIKE '%jpn%'
    OR set_name ILIKE '%日本%'  -- 日本 (Japan in kanji) — belt-and-braces
 GROUP BY set_name
 ORDER BY n DESC;

-- Expected: 0 rows. Any language-adjacent column that has slipped
-- into cards without our knowledge would surface here.
SELECT column_name, data_type
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name   = 'cards'
   AND column_name IN ('language', 'lang', 'region', 'market', 'edition', 'origin');

-- Expected: 0 rows. Same probe on set_metadata.
SELECT column_name, data_type
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name   = 'set_metadata'
   AND column_name IN ('language', 'lang', 'region', 'market', 'edition', 'origin');

-- ── 2. Existing UNIQUE constraint on watchlist ──────────────

-- Expected: one row named like 'watchlist_user_id_card_slug_key'
-- (Postgres default naming for the inline UNIQUE in the CREATE TABLE).
SELECT conname, pg_get_constraintdef(oid) AS defn
  FROM pg_constraint
 WHERE conrelid = 'public.watchlist'::regclass
   AND contype  = 'u';

-- Expected: same, on portfolio_items. Note that portfolio_items uses
-- a UNIQUE INDEX (idx_portfolio_items_unique_holding) rather than a
-- constraint — check both:
SELECT conname, pg_get_constraintdef(oid) AS defn
  FROM pg_constraint
 WHERE conrelid = 'public.portfolio_items'::regclass
   AND contype  = 'u';

SELECT indexname, indexdef
  FROM pg_indexes
 WHERE schemaname = 'public'
   AND tablename  = 'portfolio_items'
   AND indexname LIKE '%unique_holding%';

-- ── 3. provider_card_links.language current CHECK ──────────

-- Expected: one row, defn contains "CHECK ((language = ANY (ARRAY['en'::text])))"
SELECT conname, pg_get_constraintdef(oid) AS defn
  FROM pg_constraint
 WHERE conrelid = 'public.provider_card_links'::regclass
   AND contype  = 'c'
   AND conname ILIKE '%language%';

-- Expected: 0 rows. Any provider row for a non-en language would be
-- an actual data leak.
SELECT language, COUNT(*) AS n
  FROM provider_card_links
 GROUP BY language;

-- ── 4. Any PriceCharting product IDs already suspicious? ───

-- Expected: 0 rows. Anything joining a Japanese-looking set name back
-- to a live PC id would be an early warning.
SELECT c.card_slug, c.set_name, c.card_name
  FROM cards c
 WHERE c.set_name ILIKE '%japan%'
 LIMIT 20;

-- ── 5. popular_card_trends current column list ────────────

-- Expected: NO language column today.
SELECT column_name, data_type
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name   = 'popular_card_trends'
 ORDER BY ordinal_position;

-- ── 6. Snapshot of what the pilot set_name would look like ─

-- Expected: 0 rows. Confirms nothing shadows the intended pilot
-- set_name before we import.
SELECT set_name FROM set_metadata WHERE set_name ILIKE 'Japanese %';
SELECT DISTINCT set_name FROM cards        WHERE set_name ILIKE 'Japanese %';
