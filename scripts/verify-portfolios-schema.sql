-- scripts/verify-portfolios-schema.sql
-- ============================================================================
-- READ-ONLY schema inspection for `portfolios` and `portfolio_items`.
--
-- The portfolios tables were created outside this repository (no creation
-- migration is checked in). Before applying the portfolios RLS migration,
-- review the output of this script to confirm that:
--
--   1. Both tables exist in the `public` schema.
--   2. portfolios has a `user_id uuid` column.
--   3. portfolio_items has a `portfolio_id` column whose type matches
--      portfolios.id.
--   4. Current RLS state on each table.
--   5. Current policies on each table.
--
-- If anything looks unexpected (e.g. ownership column has a different
-- name, or RLS is already enabled with policies you do not recognise),
-- STOP and review with the engineer before running
-- `migrations/2026-06-14-portfolios-rls.sql`.
--
-- Usage: paste into the Supabase SQL Editor and run. Strictly read-only.
-- ============================================================================

-- 1. Table existence -----------------------------------------------------------
SELECT
  table_schema,
  table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('portfolios', 'portfolio_items')
ORDER BY table_name;


-- 2. portfolios columns --------------------------------------------------------
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'portfolios'
ORDER BY ordinal_position;


-- 3. portfolio_items columns ---------------------------------------------------
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'portfolio_items'
ORDER BY ordinal_position;


-- 4. Primary keys, foreign keys, and unique constraints -----------------------
SELECT
  tc.table_name,
  tc.constraint_type,
  tc.constraint_name,
  string_agg(kcu.column_name, ', ' ORDER BY kcu.ordinal_position) AS columns,
  ccu.table_name  AS references_table,
  string_agg(ccu.column_name, ', ' ORDER BY kcu.ordinal_position) AS references_columns
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON kcu.constraint_name = tc.constraint_name
 AND kcu.table_schema    = tc.table_schema
LEFT JOIN information_schema.constraint_column_usage ccu
  ON ccu.constraint_name = tc.constraint_name
 AND ccu.table_schema    = tc.table_schema
WHERE tc.table_schema = 'public'
  AND tc.table_name IN ('portfolios', 'portfolio_items')
GROUP BY tc.table_name, tc.constraint_type, tc.constraint_name, ccu.table_name
ORDER BY tc.table_name, tc.constraint_type;


-- 5. Current RLS state --------------------------------------------------------
SELECT
  c.relname             AS table_name,
  c.relrowsecurity      AS rls_enabled,
  c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('portfolios', 'portfolio_items');


-- 6. Existing policies on these tables ----------------------------------------
SELECT
  schemaname,
  tablename,
  policyname,
  cmd,
  roles,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('portfolios', 'portfolio_items')
ORDER BY tablename, policyname;


-- 7. Sanity counts (does not expose row content) ------------------------------
-- Only run as a service-role user. If RLS is properly scoped these counts
-- should match. Anonymous count is included to confirm anon cannot read.
SELECT 'portfolios'      AS table_name, COUNT(*) AS row_count FROM public.portfolios
UNION ALL
SELECT 'portfolio_items' AS table_name, COUNT(*) AS row_count FROM public.portfolio_items;
