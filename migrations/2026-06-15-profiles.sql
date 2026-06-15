-- 2026-06-15 — public.profiles + auth.users INSERT trigger + backfill (Block 2A)
-- ============================================================================
-- REVISED 2026-06-15 (merge pass).
--
-- Production inspection confirmed the existing public.handle_new_user()
-- body inserts into public.user_profiles(id, display_name). The Block 2A
-- code requires an additional insert into public.profiles. This revision
-- MERGES both inserts into a single function so signup keeps populating
-- the legacy user_profiles row AND now also populates the new profiles
-- row.
--
-- Each insert lives in its own nested BEGIN ... EXCEPTION block. A
-- failure of one MUST NOT prevent the other; neither failure may block
-- the auth.users signup. Warnings carry only SQLSTATE — no email, no
-- token, no metadata content.
--
-- ──────────────────────────────────────────────────────────────────────────
-- IMPORTANT — INSPECT BEFORE RUNNING (still recommended)
-- ──────────────────────────────────────────────────────────────────────────
-- This migration uses CREATE OR REPLACE FUNCTION (no DROP), so any
-- existing dependent trigger continues to work throughout the transaction.
-- The pre-flight diagnostic in Section B still echoes the existing
-- function body via RAISE NOTICE during execution. If running by hand,
-- you can also paste this once before applying the migration:
--
--   SELECT pg_get_functiondef('public.handle_new_user()'::regprocedure);
--
-- ──────────────────────────────────────────────────────────────────────────
-- After this migration:
--   * Every auth.users row has a corresponding public.profiles row.
--   * New signups continue to receive a public.user_profiles row using
--     the EXACT legacy fallback (raw_user_meta_data->>'name', email
--     prefix, 'Collector').
--   * New signups also receive a public.profiles row with broader
--     display-name extraction and avatar URL.
--   * Profile rows are owner-only via RLS.
--
-- ---------------------------------------------------------------------------
-- ROLLBACK
-- ---------------------------------------------------------------------------
-- Order matters: drop the trigger BEFORE the function.
--
--   DROP TRIGGER  IF EXISTS on_auth_user_created   ON auth.users;
--   DROP FUNCTION IF EXISTS public.handle_new_user();
--   DROP POLICY   IF EXISTS profiles_owner_select  ON public.profiles;
--   DROP POLICY   IF EXISTS profiles_owner_update  ON public.profiles;
--   DROP TABLE    IF EXISTS public.profiles;
--
-- Dropping the function would also stop signup from inserting into
-- public.user_profiles. If you only want to roll back Block 2A, REPLACE
-- the function with the pre-Block-2A body instead of dropping it. The
-- pre-Block-2A body was:
--
--   CREATE OR REPLACE FUNCTION public.handle_new_user()
--   RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $function$
--   BEGIN
--     INSERT INTO public.user_profiles (id, display_name)
--     VALUES (
--       NEW.id,
--       COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1), 'Collector')
--     )
--     ON CONFLICT (id) DO NOTHING;
--     RETURN NEW;
--   EXCEPTION WHEN OTHERS THEN
--     RETURN NEW;
--   END;
--   $function$;
-- ============================================================================


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ SECTION A — public.profiles table, RLS, policies                         ║
-- ║ Always safe to run; does not touch any function or trigger.              ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- ── A.1. Table ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profiles (
  user_id                UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name           TEXT,
  avatar_key             TEXT,
  country_code           TEXT
                          CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$'),
  marketplace_preference TEXT,
  preferred_currency     TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- updated_at helper — reuses the project's existing function if present,
-- otherwise creates a tiny private one.
DO $check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname='set_updated_at'
  ) THEN
    EXECUTE $$
      CREATE OR REPLACE FUNCTION public.set_updated_at()
      RETURNS TRIGGER LANGUAGE plpgsql AS $body$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $body$;
    $$;
  END IF;
END
$check$;

DROP TRIGGER IF EXISTS profiles_set_updated_at ON public.profiles;
CREATE TRIGGER profiles_set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ── A.2. RLS + owner policies ──────────────────────────────────────────────
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Owner-only SELECT and UPDATE. No INSERT policy: inserts only happen via
-- the SECURITY DEFINER trigger below or via service-role (which bypasses
-- RLS). This prevents authenticated users from forging a profile for
-- another user.

DROP POLICY IF EXISTS profiles_owner_select ON public.profiles;
CREATE POLICY profiles_owner_select ON public.profiles
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS profiles_owner_update ON public.profiles;
CREATE POLICY profiles_owner_update ON public.profiles
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ SECTION B — handle_new_user (merged: user_profiles + profiles)           ║
-- ║                                                                          ║
-- ║ Pre-flight 1 echoes the existing function body so any unexpected logic   ║
-- ║ is visible in SQL editor output BEFORE the new body is applied.          ║
-- ║                                                                          ║
-- ║ Pre-flight 2 verifies public.user_profiles has the shape the merged      ║
-- ║ function expects (id PK/unique + display_name column). Fails loudly      ║
-- ║ rather than letting signup break at runtime.                             ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- ── Pre-flight 1: print existing handle_new_user body ──────────────────────
DO $preflight_body$
DECLARE
  v_body TEXT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname='handle_new_user'
  ) THEN
    SELECT pg_get_functiondef('public.handle_new_user()'::regprocedure) INTO v_body;
    RAISE NOTICE '[profiles] EXISTING public.handle_new_user() body follows.';
    RAISE NOTICE E'\n%', v_body;
  ELSE
    RAISE NOTICE '[profiles] public.handle_new_user() does not exist yet — will be created fresh.';
  END IF;
END
$preflight_body$;


-- ── Pre-flight 2: verify public.user_profiles shape ────────────────────────
-- The repository has zero references to public.user_profiles. The merged
-- function inserts (id, display_name) into it. Verify those columns exist
-- and that `id` is unique/PK so ON CONFLICT (id) is valid. Abort with a
-- clear message if not — DO NOT silently break signup.
DO $preflight_shape$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='user_profiles'
  ) THEN
    RAISE EXCEPTION '[handle_new_user] precondition failed: public.user_profiles does not exist. The existing handle_new_user() inserts into it; aborting to avoid silently breaking signup.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='user_profiles' AND column_name='id'
  ) THEN
    RAISE EXCEPTION '[handle_new_user] precondition failed: public.user_profiles.id is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='user_profiles' AND column_name='display_name'
  ) THEN
    RAISE EXCEPTION '[handle_new_user] precondition failed: public.user_profiles.display_name is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
    WHERE n.nspname = 'public'
      AND c.relname = 'user_profiles'
      AND i.indisunique = TRUE
      AND i.indnatts    = 1
      AND a.attname     = 'id'
  ) THEN
    RAISE EXCEPTION '[handle_new_user] precondition failed: no unique single-column index on public.user_profiles.id. ON CONFLICT (id) would error at runtime.';
  END IF;
END
$preflight_shape$;


-- ── Merged function ────────────────────────────────────────────────────────
-- search_path = '' plus full qualification (public., pg_catalog.). COALESCE
-- and NULLIF are SQL expressions (not function calls), so they resolve
-- regardless of search_path. split_part and btrim are pg_catalog functions
-- and ARE prefixed.
--
-- Two independent nested BEGIN ... EXCEPTION blocks isolate failures:
--   * Insert into public.user_profiles is the legacy behaviour and must
--     never be skipped because the new profiles insert fails.
--   * Insert into public.profiles is the Block 2A behaviour and must
--     never be skipped because the legacy user_profiles insert fails.
--   * Neither failure may block auth.users signup; RETURN NEW always.
-- Warning messages carry only SQLSTATE so no email, token or other
-- metadata is ever logged.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_legacy_display TEXT;
  v_display        TEXT;
  v_avatar         TEXT;
BEGIN
  -- Legacy user_profiles display name (preserved verbatim from the
  -- previous production body): COALESCE(name, email prefix, 'Collector').
  v_legacy_display := COALESCE(
    NEW.raw_user_meta_data ->> 'name',
    pg_catalog.split_part(NEW.email, '@', 1),
    'Collector'
  );

  -- Block 2A profiles display name (broader metadata coverage).
  v_display := COALESCE(
    NEW.raw_user_meta_data ->> 'full_name',
    NEW.raw_user_meta_data ->> 'name',
    NEW.raw_user_meta_data ->> 'display_name',
    pg_catalog.split_part(NEW.email, '@', 1),
    'Collector'
  );

  -- Avatar / picture URL from common OAuth providers; null if none.
  v_avatar := NULLIF(pg_catalog.btrim(COALESCE(
    NEW.raw_user_meta_data ->> 'avatar_url',
    NEW.raw_user_meta_data ->> 'picture',
    ''
  )), '');

  -- Block A: legacy user_profiles insert.
  BEGIN
    INSERT INTO public.user_profiles (id, display_name)
    VALUES (NEW.id, v_legacy_display)
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[handle_new_user] user_profiles insert failed (sqlstate=%)', SQLSTATE;
  END;

  -- Block B: Block 2A profiles insert.
  BEGIN
    INSERT INTO public.profiles (user_id, display_name, avatar_key)
    VALUES (NEW.id, v_display, v_avatar)
    ON CONFLICT (user_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[handle_new_user] profiles insert failed (sqlstate=%)', SQLSTATE;
  END;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ SECTION C — Trigger swap (safe because the function still exists)        ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ SECTION D — Backfill public.profiles ONLY                                ║
-- ║ Inserts a profiles row for every auth.users row that does not already    ║
-- ║ have one. NEVER overwrites existing profile rows. NEVER touches          ║
-- ║ public.user_profiles. Safe to re-run.                                    ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

INSERT INTO public.profiles (user_id, display_name, avatar_key, created_at)
SELECT
  u.id,
  NULLIF(pg_catalog.btrim(COALESCE(
    u.raw_user_meta_data ->> 'full_name',
    u.raw_user_meta_data ->> 'name',
    u.raw_user_meta_data ->> 'display_name',
    ''
  )), ''),
  NULLIF(pg_catalog.btrim(COALESCE(
    u.raw_user_meta_data ->> 'avatar_url',
    u.raw_user_meta_data ->> 'picture',
    ''
  )), ''),
  u.created_at
FROM auth.users u
LEFT JOIN public.profiles p ON p.user_id = u.id
WHERE p.user_id IS NULL;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ SECTION E — Final blocking verification                                  ║
-- ║ Aborts the transaction (rolling back everything above) if any expected   ║
-- ║ object is missing.                                                       ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

DO $verify$
DECLARE
  v_orphan_users INT;
BEGIN
  -- 1. public.profiles exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='profiles'
  ) THEN
    RAISE EXCEPTION '[profiles] post-condition: public.profiles missing';
  END IF;

  -- 2. RLS enabled
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.profiles'::regclass) THEN
    RAISE EXCEPTION '[profiles] post-condition: RLS not enabled on public.profiles';
  END IF;

  -- 3. Owner SELECT + UPDATE policies present
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='profiles' AND policyname='profiles_owner_select'
  ) THEN
    RAISE EXCEPTION '[profiles] post-condition: profiles_owner_select policy missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='profiles' AND policyname='profiles_owner_update'
  ) THEN
    RAISE EXCEPTION '[profiles] post-condition: profiles_owner_update policy missing';
  END IF;

  -- 4. Trigger present
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname='on_auth_user_created' AND tgrelid='auth.users'::regclass
  ) THEN
    RAISE EXCEPTION '[profiles] post-condition: on_auth_user_created trigger missing';
  END IF;

  -- 5. Function present
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname='handle_new_user'
  ) THEN
    RAISE EXCEPTION '[profiles] post-condition: public.handle_new_user() missing';
  END IF;

  -- 6. Backfill complete — every auth.users row has a profiles row
  SELECT COUNT(*) INTO v_orphan_users
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.user_id = u.id
  WHERE p.user_id IS NULL;

  IF v_orphan_users > 0 THEN
    RAISE EXCEPTION '[profiles] post-condition: backfill incomplete — % auth.users row(s) still missing a profiles row', v_orphan_users;
  END IF;
END
$verify$;
