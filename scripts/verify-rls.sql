-- scripts/verify-rls.sql
-- =========================================================================
-- READ-ONLY visual verification of Row Level Security across user-owned and
-- service-role-only tables. Run in the Supabase SQL Editor.
--
-- Run this AFTER applying any of:
--   migrations/2026-06-14-rls-verify.sql
--   migrations/2026-06-14-portfolios-rls.sql
--   migrations/2026-06-14-social-content-posts-rls-tighten.sql
--
-- The goal is human-readable confirmation that:
--   * RLS is enabled on every table that should have it.
--   * Each user-owned table has owner-policies and nothing more permissive.
--   * social_content_posts has only the public SELECT policy.
--   * pending_emails and scan_logs have no user-visible policies.
-- =========================================================================

-- 1. RLS state across the tables we care about ------------------------------
SELECT
  c.relname                  AS table_name,
  c.relrowsecurity           AS rls_enabled,
  c.relforcerowsecurity      AS rls_forced,
  obj_description(c.oid)     AS table_comment
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'watchlist',
    'user_alerts',
    'user_email_preferences',
    'card_show_stars',
    'pending_emails',
    'scan_logs',
    'portfolios',
    'portfolio_items',
    'social_content_posts'
  )
ORDER BY c.relname;


-- 2. Per-table policy list --------------------------------------------------
SELECT
  schemaname,
  tablename,
  policyname,
  cmd        AS command,
  roles,
  qual       AS using_expression,
  with_check AS with_check_expression,
  permissive
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'watchlist',
    'user_alerts',
    'user_email_preferences',
    'card_show_stars',
    'pending_emails',
    'scan_logs',
    'portfolios',
    'portfolio_items',
    'social_content_posts'
  )
ORDER BY tablename, policyname;


-- 3. Red-flag policies on service-role-only tables --------------------------
-- Any policy whose role list does not contain `service_role` is suspicious.
SELECT
  tablename,
  policyname,
  cmd  AS command,
  roles
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('pending_emails', 'scan_logs')
  AND roles::text NOT ILIKE '%service_role%';


-- 4. Red-flag write policies on social_content_posts ------------------------
-- After 2026-06-14-social-content-posts-rls-tighten.sql, only a single
-- SELECT policy should remain. Any UPDATE or DELETE policy with USING true
-- is a regression to the prior insecure posture.
SELECT
  policyname,
  cmd  AS command,
  qual AS using_expression,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename  = 'social_content_posts'
  AND cmd       IN ('UPDATE', 'DELETE', 'INSERT');
