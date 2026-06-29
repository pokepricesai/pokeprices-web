-- migrations/2026-06-29-pro-early-access-requests.sql
-- Block 5A-W-28 — capture Pro early-access interest before Stripe.
--
-- Adds a single additive table. No existing column or row is touched.
-- Apply by hand in the Supabase SQL Editor.
--
-- Writer surface: only the authenticated `/api/account/pro-early-access`
-- route writes rows here. The route uses the service-role client so
-- it can also run a dedupe SELECT across all rows (the owner-only RLS
-- SELECT policy would otherwise hide other users' rows). RLS policies
-- still ENABLED as defence in depth — the browser supabase client
-- cannot bypass them even if a future caller routes through it.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- Table
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.pro_early_access_requests (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- ON DELETE SET NULL — keeps the historical request even if the
  -- user later deletes their account. The email column survives as
  -- the only identifier in that case (and only for follow-up).
  user_id         uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Nullable today: the API route fills it from auth.users.email
  -- when present. The future anonymous-capture flow will fill it
  -- from the form input.
  email           text,
  source          text        NOT NULL DEFAULT 'unknown',
  plan_interest   text        NOT NULL DEFAULT 'pro',
  message         text,
  -- JSONB so future capture surfaces (a feedback survey, a discount
  -- code campaign tag, etc.) can attach context without a schema
  -- change. The route caps message length at 1000 chars but does
  -- not policy-check this column — it's free-form for the writer.
  metadata_json   jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────
-- Indexes
-- ─────────────────────────────────────────────────────────────────────

-- Dedupe lookup (route: "did this user submit in the last 24h?")
CREATE INDEX IF NOT EXISTS pro_early_access_user_id_idx
  ON public.pro_early_access_requests (user_id);

-- Future anonymous dedupe by email
CREATE INDEX IF NOT EXISTS pro_early_access_email_idx
  ON public.pro_early_access_requests (email);

-- Admin/operator "show me the latest 50 signups" listing
CREATE INDEX IF NOT EXISTS pro_early_access_created_at_desc_idx
  ON public.pro_early_access_requests (created_at DESC);

-- ─────────────────────────────────────────────────────────────────────
-- RLS — owner-only for the browser anon client; the API route uses
-- the service-role client which bypasses RLS, so this is purely
-- defence in depth.
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.pro_early_access_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pro_early_access_owner_insert ON public.pro_early_access_requests;
DROP POLICY IF EXISTS pro_early_access_owner_select ON public.pro_early_access_requests;

CREATE POLICY pro_early_access_owner_insert
  ON public.pro_early_access_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Owner-only SELECT lets the UI later show "you're already on the
-- list" without hitting an API. The route also reports it via
-- alreadyRegistered=true so a UI without this query still works.
CREATE POLICY pro_early_access_owner_select
  ON public.pro_early_access_requests
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────
-- Sanity check
-- ─────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'pro_early_access_requests'
  ) THEN
    RAISE EXCEPTION 'pro_early_access_requests table was not created';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'pro_early_access_requests'
      AND policyname = 'pro_early_access_owner_insert'
  ) THEN
    RAISE EXCEPTION 'RLS insert policy was not created';
  END IF;
END $$;

COMMIT;
