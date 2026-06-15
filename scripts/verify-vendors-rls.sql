-- scripts/verify-vendors-rls.sql
-- ============================================================================
-- READ-ONLY inspection of the current RLS posture on public.vendors.
-- Run this BEFORE applying migrations/2026-06-14-vendors-rls-tighten.sql.
--
-- Purpose:
--   * Confirm whether RLS is currently enabled.
--   * List every policy currently attached to vendors so the operator
--     can decide whether the tighten migration's behaviour matches the
--     intended posture.
--   * Surface any RPCs (SECURITY DEFINER functions) that may bypass RLS
--     in unexpected ways.
-- ============================================================================

-- 1. Current RLS state ------------------------------------------------------
SELECT
  c.relname                  AS table_name,
  c.relrowsecurity           AS rls_enabled,
  c.relforcerowsecurity      AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'vendors';


-- 2. All current policies on vendors ----------------------------------------
SELECT
  policyname,
  cmd        AS command,
  roles,
  permissive,
  qual       AS using_expression,
  with_check AS with_check_expression
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'vendors'
ORDER BY policyname;


-- 3. Sanity row counts ------------------------------------------------------
-- Run as service-role (default in SQL editor). These counts should be
-- non-zero in production and stable across runs.
SELECT
  COUNT(*)                                  AS total_rows,
  COUNT(*) FILTER (WHERE active)            AS active_rows,
  COUNT(*) FILTER (WHERE NOT active)        AS pending_rows,
  COUNT(*) FILTER (WHERE verified)          AS verified_rows,
  COUNT(*) FILTER (WHERE logo_url IS NULL)  AS without_logo
FROM public.vendors;


-- 4. RPCs that touch vendors ------------------------------------------------
-- SECURITY DEFINER functions bypass RLS. List anything that names vendors
-- so the operator can confirm there are no privilege escalations after
-- the tighten migration.
SELECT
  p.proname                                   AS function_name,
  pg_catalog.pg_get_function_identity_arguments(p.oid) AS args,
  p.prosecdef                                 AS security_definer,
  l.lanname                                   AS language
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN pg_language  l ON l.oid = p.prolang
WHERE n.nspname = 'public'
  AND pg_get_functiondef(p.oid) ILIKE '%vendors%'
ORDER BY p.proname;
