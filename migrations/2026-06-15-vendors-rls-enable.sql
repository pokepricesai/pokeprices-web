-- 2026-06-15 — vendors RLS enable (Block 1B)
-- ============================================================================
-- Live-schema-confirmed Block 1B migration.
--
-- Production inspection on 2026-06-15 confirmed:
--   * public.vendors RLS is DISABLED.
--   * public.vendors has ZERO policies.
--
-- Because there are no pre-existing policies to disambiguate, this
-- migration can be simple and strict:
--
--   1. Enable RLS.
--   2. Add the only intended user-visible policy: public SELECT for
--      `active = true` rows.
--   3. Verify that no INSERT / UPDATE / DELETE policy and no other SELECT
--      policy were silently added between inspection and migration. If
--      one is found, RAISE EXCEPTION — the transaction rolls back and the
--      migration fails loudly.
--
-- After this migration:
--   * Pending (active=false) and rejected vendor rows are invisible to
--     anon and authenticated users.
--   * Existing two active vendors remain publicly readable.
--   * Anon INSERT / UPDATE / DELETE is rejected by default (no policy).
--   * Service-role bypasses RLS as always — the new server route at
--     /api/vendors/submit continues to work.
--
-- FORCE ROW LEVEL SECURITY is intentionally NOT enabled. The single
-- service-role usage is a controlled server boundary, and forcing RLS on
-- table owners (which the service-role can become) would add operational
-- friction without an observable threat-model benefit at this stage.
--
-- ORDER OF DEPLOYMENT
--   1. `migrations/2026-06-15-vendors-logo-url-and-upload-tokens.sql`
--      must be applied first (adds logo_url + token plumbing).
--   2. New application code must be deployed to production and verified.
--   3. THIS migration is applied immediately after step 2.
--
-- ---------------------------------------------------------------------------
-- ROLLBACK
-- ---------------------------------------------------------------------------
-- This migration enables RLS and adds a single SELECT policy. To roll back:
--
--   DROP POLICY IF EXISTS vendors_public_select_active ON public.vendors;
--   -- Do NOT also disable RLS unless you intend to revert to the
--   -- pre-Block-1B posture, which exposed all vendor rows (pending and
--   -- rejected included) to every anon visitor.
--
-- A safer rollback path is to revert the application code while leaving
-- the RLS posture intact, then perform any one-off mutations under the
-- service role.
-- ============================================================================


-- ── 1. Enable RLS (idempotent) ─────────────────────────────────────────────
DO $rls$
DECLARE v boolean;
BEGIN
  SELECT relrowsecurity INTO v
  FROM pg_class
  WHERE oid = 'public.vendors'::regclass;

  IF v IS NULL THEN
    RAISE EXCEPTION '[vendors-rls] public.vendors not found';
  END IF;

  IF v IS NOT TRUE THEN
    RAISE NOTICE '[vendors-rls] enabling RLS on public.vendors';
    EXECUTE 'ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY';
  ELSE
    RAISE NOTICE '[vendors-rls] RLS already enabled on public.vendors';
  END IF;
END
$rls$;


-- ── 2. Add the only intended policy ─────────────────────────────────────────
DO $sel$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'vendors'
      AND policyname = 'vendors_public_select_active'
  ) THEN
    RAISE NOTICE '[vendors-rls] creating vendors_public_select_active';
    EXECUTE 'CREATE POLICY vendors_public_select_active ON public.vendors '
         || 'FOR SELECT USING (active = true)';
  ELSE
    RAISE NOTICE '[vendors-rls] vendors_public_select_active already exists';
  END IF;
END
$sel$;


-- ── 3. Blocking verification ───────────────────────────────────────────────
-- Fail the migration if anything other than the single SELECT policy is
-- present on vendors. This catches a state where a permissive write policy
-- was added between inspection and migration, or where a SELECT policy
-- broader than active=true survives.
DO $check$
DECLARE
  pol record;
  extra_count int := 0;
BEGIN
  FOR pol IN
    SELECT policyname, cmd, qual::text AS qual, with_check::text AS with_check
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'vendors'
  LOOP
    IF pol.policyname = 'vendors_public_select_active'
       AND pol.cmd = 'SELECT' THEN
      CONTINUE;
    END IF;

    extra_count := extra_count + 1;
    RAISE WARNING '[vendors-rls] unexpected policy: name=% cmd=% qual=% with_check=%',
      pol.policyname, pol.cmd, pol.qual, pol.with_check;
  END LOOP;

  IF extra_count > 0 THEN
    RAISE EXCEPTION '[vendors-rls] blocking: % extra polic(y/ies) present on public.vendors. Drop them by hand and re-run this migration.',
      extra_count;
  END IF;

  -- Final state check.
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.vendors'::regclass) THEN
    RAISE EXCEPTION '[vendors-rls] post-condition failed: RLS not enabled on public.vendors';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'vendors'
      AND policyname = 'vendors_public_select_active' AND cmd = 'SELECT'
  ) THEN
    RAISE EXCEPTION '[vendors-rls] post-condition failed: public-select-active policy not present';
  END IF;
END
$check$;
