-- 2026-06-14 — Portfolios RLS (guarded, Block 1A)
-- ============================================================================
-- DO NOT APPLY until you have reviewed the output of
-- `scripts/verify-portfolios-schema.sql` and confirmed:
--
--   * public.portfolios.user_id (uuid) exists
--   * public.portfolio_items.portfolio_id exists and references portfolios.id
--   * Existing RLS state and any pre-existing policies make sense
--
-- The migration is self-guarding:
--   * Verifies the expected columns are present before doing anything.
--   * Emits a NOTICE and exits cleanly if assumptions do not hold.
--   * Adds owner policies ONLY when missing.
--   * Never drops, alters, or replaces existing policies.
--
-- Ownership model
-- ---------------
--   portfolios:        a row is owned by its user_id.
--   portfolio_items:   a row is owned by the user whose portfolios.id matches
--                      portfolio_items.portfolio_id. Enforced via EXISTS, so
--                      the same auth.uid() check authorises both layers.
--
-- Policy names created (if missing):
--   portfolios_owner_select
--   portfolios_owner_modify
--   portfolio_items_owner_select
--   portfolio_items_owner_modify
--
-- ---------------------------------------------------------------------------
-- ROLLBACK
-- ---------------------------------------------------------------------------
-- This migration only ADDS owner policies. To roll back, drop the policies:
--
--   DROP POLICY IF EXISTS portfolios_owner_select       ON public.portfolios;
--   DROP POLICY IF EXISTS portfolios_owner_modify       ON public.portfolios;
--   DROP POLICY IF EXISTS portfolio_items_owner_select  ON public.portfolio_items;
--   DROP POLICY IF EXISTS portfolio_items_owner_modify  ON public.portfolio_items;
--
-- Do NOT disable RLS as part of rollback unless you are reverting to a
-- known-safe alternative. Disabling RLS on user-owned tables exposes every
-- user's portfolio to every other authenticated user.
-- ============================================================================

DO $portfolios$
DECLARE
  has_portfolios_user_id       boolean;
  has_portfolio_items_pid      boolean;
  rls_portfolios               boolean;
  rls_portfolio_items          boolean;
BEGIN
  -- ── 1. Column shape verification ──────────────────────────────────────────
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'portfolios'
      AND column_name = 'user_id' AND data_type = 'uuid'
  ) INTO has_portfolios_user_id;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'portfolio_items'
      AND column_name = 'portfolio_id'
  ) INTO has_portfolio_items_pid;

  IF NOT has_portfolios_user_id THEN
    RAISE NOTICE '[portfolios-rls] SKIP: public.portfolios.user_id (uuid) not found. Run scripts/verify-portfolios-schema.sql and revise this migration if your column shape differs.';
    RETURN;
  END IF;

  IF NOT has_portfolio_items_pid THEN
    RAISE NOTICE '[portfolios-rls] SKIP: public.portfolio_items.portfolio_id not found. Run scripts/verify-portfolios-schema.sql and revise this migration if your column shape differs.';
    RETURN;
  END IF;

  -- ── 2. RLS enable (idempotent) ────────────────────────────────────────────
  SELECT c.relrowsecurity INTO rls_portfolios
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'portfolios';

  IF rls_portfolios IS NOT TRUE THEN
    RAISE NOTICE '[portfolios-rls] enabling RLS on public.portfolios';
    EXECUTE 'ALTER TABLE public.portfolios ENABLE ROW LEVEL SECURITY';
  END IF;

  SELECT c.relrowsecurity INTO rls_portfolio_items
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'portfolio_items';

  IF rls_portfolio_items IS NOT TRUE THEN
    RAISE NOTICE '[portfolios-rls] enabling RLS on public.portfolio_items';
    EXECUTE 'ALTER TABLE public.portfolio_items ENABLE ROW LEVEL SECURITY';
  END IF;

  -- ── 3. Owner policies on portfolios ───────────────────────────────────────
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'portfolios'
      AND policyname = 'portfolios_owner_select'
  ) THEN
    RAISE NOTICE '[portfolios-rls] creating portfolios_owner_select';
    EXECUTE 'CREATE POLICY portfolios_owner_select ON public.portfolios '
         || 'FOR SELECT USING (user_id = auth.uid())';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'portfolios'
      AND policyname = 'portfolios_owner_modify'
  ) THEN
    RAISE NOTICE '[portfolios-rls] creating portfolios_owner_modify';
    EXECUTE 'CREATE POLICY portfolios_owner_modify ON public.portfolios '
         || 'FOR ALL USING (user_id = auth.uid()) '
         || 'WITH CHECK (user_id = auth.uid())';
  END IF;

  -- ── 4. Owner policies on portfolio_items (via portfolios ownership) ───────
  -- A portfolio_items row is owned by whoever owns the parent portfolio.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'portfolio_items'
      AND policyname = 'portfolio_items_owner_select'
  ) THEN
    RAISE NOTICE '[portfolios-rls] creating portfolio_items_owner_select';
    EXECUTE
      'CREATE POLICY portfolio_items_owner_select ON public.portfolio_items '
   || 'FOR SELECT USING ('
   || '  EXISTS ('
   || '    SELECT 1 FROM public.portfolios p '
   || '    WHERE p.id = portfolio_items.portfolio_id '
   || '      AND p.user_id = auth.uid()'
   || '  )'
   || ')';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'portfolio_items'
      AND policyname = 'portfolio_items_owner_modify'
  ) THEN
    RAISE NOTICE '[portfolios-rls] creating portfolio_items_owner_modify';
    EXECUTE
      'CREATE POLICY portfolio_items_owner_modify ON public.portfolio_items '
   || 'FOR ALL USING ('
   || '  EXISTS ('
   || '    SELECT 1 FROM public.portfolios p '
   || '    WHERE p.id = portfolio_items.portfolio_id '
   || '      AND p.user_id = auth.uid()'
   || '  )'
   || ') WITH CHECK ('
   || '  EXISTS ('
   || '    SELECT 1 FROM public.portfolios p '
   || '    WHERE p.id = portfolio_items.portfolio_id '
   || '      AND p.user_id = auth.uid()'
   || '  )'
   || ')';
  END IF;

  RAISE NOTICE '[portfolios-rls] complete';
END
$portfolios$;
