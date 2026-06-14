-- 2026-06-14 — RLS verify (Block 1A, minimal & idempotent)
-- =========================================================
-- Re-applies known-good owner policies for user-owned tables only where
-- the expected policies are MISSING. Does not drop or alter existing
-- policies. Does not create service_role policies (service_role bypasses
-- RLS by default and explicit policies just add noise).
--
-- Tables covered:
--   watchlist                  (owner policies expected from
--                               supabase/migrations/20260426_dashboard_tools.sql)
--   user_alerts                (same)
--   user_email_preferences     (same)
--   card_show_stars            (granular policies from
--                               migrations/2026-05-02-card-show-stars.sql)
--   pending_emails             (service-role only — RLS on, no user policies)
--   scan_logs                  (service-role only — existing policy kept)
--
-- Safe to run multiple times. Reports its actions via NOTICE.
--
-- ---------------------------------------------------------------------------
-- ROLLBACK
-- ---------------------------------------------------------------------------
-- This migration only ADDS missing policies. To roll back, drop the
-- specific policies you would like to remove using their names listed
-- below. Do NOT use rollback to disable RLS or restore anonymous write
-- access.
--
--   DROP POLICY IF EXISTS watchlist_owner_select         ON public.watchlist;
--   DROP POLICY IF EXISTS watchlist_owner_modify         ON public.watchlist;
--   DROP POLICY IF EXISTS user_alerts_owner_select       ON public.user_alerts;
--   DROP POLICY IF EXISTS user_alerts_owner_modify       ON public.user_alerts;
--   DROP POLICY IF EXISTS email_prefs_owner_select       ON public.user_email_preferences;
--   DROP POLICY IF EXISTS email_prefs_owner_modify       ON public.user_email_preferences;
--   DROP POLICY IF EXISTS card_show_stars_select_own     ON public.card_show_stars;
--   DROP POLICY IF EXISTS card_show_stars_insert_own     ON public.card_show_stars;
--   DROP POLICY IF EXISTS card_show_stars_delete_own     ON public.card_show_stars;
-- ---------------------------------------------------------------------------

DO $verify$
DECLARE
  v_table  text;
  v_rls_on boolean;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'watchlist',
    'user_alerts',
    'user_email_preferences',
    'card_show_stars',
    'pending_emails',
    'scan_logs'
  ]
  LOOP
    SELECT c.relrowsecurity INTO v_rls_on
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = v_table;

    IF v_rls_on IS NULL THEN
      RAISE NOTICE '[rls-verify] skip: public.% does not exist', v_table;
      CONTINUE;
    END IF;

    IF v_rls_on IS NOT TRUE THEN
      RAISE NOTICE '[rls-verify] enabling RLS on public.%', v_table;
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
    ELSE
      RAISE NOTICE '[rls-verify] ok: RLS already enabled on public.%', v_table;
    END IF;
  END LOOP;
END
$verify$;


-- ── watchlist owner policies (add only if missing) ──────────────────────────
DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'watchlist'
      AND policyname = 'watchlist_owner_select'
  ) THEN
    RAISE NOTICE '[rls-verify] creating watchlist_owner_select';
    EXECUTE 'CREATE POLICY watchlist_owner_select ON public.watchlist '
         || 'FOR SELECT USING (user_id = auth.uid())';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'watchlist'
      AND policyname = 'watchlist_owner_modify'
  ) THEN
    RAISE NOTICE '[rls-verify] creating watchlist_owner_modify';
    EXECUTE 'CREATE POLICY watchlist_owner_modify ON public.watchlist '
         || 'FOR ALL USING (user_id = auth.uid()) '
         || 'WITH CHECK (user_id = auth.uid())';
  END IF;
END
$verify$;


-- ── user_alerts owner policies (add only if missing) ────────────────────────
DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_alerts'
      AND policyname = 'user_alerts_owner_select'
  ) THEN
    RAISE NOTICE '[rls-verify] creating user_alerts_owner_select';
    EXECUTE 'CREATE POLICY user_alerts_owner_select ON public.user_alerts '
         || 'FOR SELECT USING (user_id = auth.uid())';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_alerts'
      AND policyname = 'user_alerts_owner_modify'
  ) THEN
    RAISE NOTICE '[rls-verify] creating user_alerts_owner_modify';
    EXECUTE 'CREATE POLICY user_alerts_owner_modify ON public.user_alerts '
         || 'FOR ALL USING (user_id = auth.uid()) '
         || 'WITH CHECK (user_id = auth.uid())';
  END IF;
END
$verify$;


-- ── user_email_preferences owner policies (add only if missing) ─────────────
DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_email_preferences'
      AND policyname = 'email_prefs_owner_select'
  ) THEN
    RAISE NOTICE '[rls-verify] creating email_prefs_owner_select';
    EXECUTE 'CREATE POLICY email_prefs_owner_select ON public.user_email_preferences '
         || 'FOR SELECT USING (user_id = auth.uid())';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_email_preferences'
      AND policyname = 'email_prefs_owner_modify'
  ) THEN
    RAISE NOTICE '[rls-verify] creating email_prefs_owner_modify';
    EXECUTE 'CREATE POLICY email_prefs_owner_modify ON public.user_email_preferences '
         || 'FOR ALL USING (user_id = auth.uid()) '
         || 'WITH CHECK (user_id = auth.uid())';
  END IF;
END
$verify$;


-- ── card_show_stars granular policies (add only if missing) ─────────────────
-- Original policy names are quoted in the source migration.
DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'card_show_stars'
      AND policyname = 'card_show_stars_select_own'
  ) THEN
    RAISE NOTICE '[rls-verify] creating card_show_stars_select_own';
    EXECUTE 'CREATE POLICY "card_show_stars_select_own" ON public.card_show_stars '
         || 'FOR SELECT TO authenticated USING (auth.uid() = user_id)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'card_show_stars'
      AND policyname = 'card_show_stars_insert_own'
  ) THEN
    RAISE NOTICE '[rls-verify] creating card_show_stars_insert_own';
    EXECUTE 'CREATE POLICY "card_show_stars_insert_own" ON public.card_show_stars '
         || 'FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'card_show_stars'
      AND policyname = 'card_show_stars_delete_own'
  ) THEN
    RAISE NOTICE '[rls-verify] creating card_show_stars_delete_own';
    EXECUTE 'CREATE POLICY "card_show_stars_delete_own" ON public.card_show_stars '
         || 'FOR DELETE TO authenticated USING (auth.uid() = user_id)';
  END IF;
END
$verify$;


-- ── pending_emails and scan_logs ────────────────────────────────────────────
-- These are service-role-only tables. RLS is enabled above. No user
-- policies should exist; no service_role policies are created here on
-- purpose (service_role bypasses RLS). The existing scan_logs_service_all
-- policy from migrations/2026-05-14c-scan-logs-and-v3.sql is left untouched.
--
-- Report any unexpected user-visible policy so the operator can review.
DO $verify$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT tablename, policyname, roles
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('pending_emails', 'scan_logs')
  LOOP
    -- "service_role" is fine; anything else on these tables is a red flag.
    IF NOT (pol.roles::text ILIKE '%service_role%') THEN
      RAISE NOTICE '[rls-verify] REVIEW: %.% has a non-service-role policy: % (roles=%)',
        'public', pol.tablename, pol.policyname, pol.roles;
    END IF;
  END LOOP;
END
$verify$;
