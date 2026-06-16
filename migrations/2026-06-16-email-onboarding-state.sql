-- migrations/2026-06-16-email-onboarding-state.sql
-- Block 3B — onboarding email sequence state.
--
-- ADDITIVE ONLY. No backfill of existing users into the sequence.
-- Existing email infrastructure (Block 3A) is untouched.
--
-- Idempotent. Safe to re-run. Apply manually in the Supabase SQL Editor.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- email_onboarding_state
-- ─────────────────────────────────────────────────────────────────────
-- One row per user. PK on user_id makes duplicate enrolment impossible
-- — the enrolment helper relies on the ON CONFLICT DO NOTHING semantics
-- of this constraint.
CREATE TABLE IF NOT EXISTS public.email_onboarding_state (
  user_id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id           UUID REFERENCES public.email_contacts(id) ON DELETE SET NULL,

  status               TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                          'pending',     -- enrolled but not yet active (reserved)
                          'active',      -- in-flight; processor will pick due rows
                          'completed',   -- discovery step sent successfully
                          'paused',      -- transient error: bounded retries left
                          'cancelled'    -- terminal: see cancellation_reason
                        )),

  started_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  welcome_due_at       TIMESTAMPTZ NOT NULL,
  activation_due_at    TIMESTAMPTZ NOT NULL,
  discovery_due_at     TIMESTAMPTZ NOT NULL,

  welcome_sent_at      TIMESTAMPTZ,
  activation_sent_at   TIMESTAMPTZ,
  discovery_sent_at    TIMESTAMPTZ,

  completed_at         TIMESTAMPTZ,
  cancelled_at         TIMESTAMPTZ,
  -- Why the sequence stopped — operator-readable, never sent to clients.
  -- Common values: 'manual_opt_out', 'preference_disabled', 'hard_bounce',
  -- 'complaint', 'invalid_address', 'admin_suppression',
  -- 'provider_rejection', 'retry_exhausted', 'account_deleted'.
  cancellation_reason  TEXT,

  -- Bounded retries for provider_error outcomes. The processor caps at
  -- a small number (e.g. 5); the column is here for the queries.
  retry_count          INT NOT NULL DEFAULT 0,

  -- ── Atomic claim (correction pass) ──────────────────────────────────
  -- Two-step claim model. The processor writes (step, token, now) on a
  -- row whose claim is either NULL or stale (older than
  -- ONBOARDING_CLAIM_STALE_SECONDS, default 300s). Concurrent processors
  -- racing for the same row see Postgres row-level locks; only one
  -- UPDATE returns a row. The deterministic sendEmail idempotency key
  -- (`onboarding:<uid>:<step>`) is a second safety layer at the
  -- email_delivery_log level.
  processing_step       TEXT CHECK (processing_step IS NULL OR processing_step IN ('welcome','activation','discovery')),
  processing_token      UUID,
  processing_started_at TIMESTAMPTZ,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- For idempotent re-applies after the initial table existed without
-- the claim columns:
ALTER TABLE public.email_onboarding_state
  ADD COLUMN IF NOT EXISTS processing_step       TEXT,
  ADD COLUMN IF NOT EXISTS processing_token      UUID,
  ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'email_onboarding_state_processing_step_check'
  ) THEN
    ALTER TABLE public.email_onboarding_state
      ADD CONSTRAINT email_onboarding_state_processing_step_check
      CHECK (processing_step IS NULL OR processing_step IN ('welcome','activation','discovery'));
  END IF;
END $$;

-- Processor index: pick rows where the next step is due. Each step
-- gets its own partial index so the planner doesn't read finished
-- rows. status='active' is the only path that drives a send; other
-- statuses are excluded by the partial WHERE.
CREATE INDEX IF NOT EXISTS idx_email_onboarding_welcome_due
  ON public.email_onboarding_state(welcome_due_at)
  WHERE welcome_sent_at IS NULL AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_email_onboarding_activation_due
  ON public.email_onboarding_state(activation_due_at)
  WHERE activation_sent_at IS NULL AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_email_onboarding_discovery_due
  ON public.email_onboarding_state(discovery_due_at)
  WHERE discovery_sent_at IS NULL AND status = 'active';

-- Recovery: surface stale claims for both observability and the
-- claim-recovery path in src/lib/email/onboarding.ts.
CREATE INDEX IF NOT EXISTS idx_email_onboarding_claim_active
  ON public.email_onboarding_state(processing_started_at)
  WHERE processing_token IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────────────
-- A signed-in user can read their own row (the settings UI uses this
-- to surface the "Getting started tips" status). Writes always go
-- through the service-role client.
ALTER TABLE public.email_onboarding_state ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  EXECUTE 'DROP POLICY IF EXISTS email_onboarding_self_select ON public.email_onboarding_state';
END $$;

CREATE POLICY email_onboarding_self_select ON public.email_onboarding_state
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────
-- Post-conditions
-- ─────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_table INT;
  v_rls   BOOLEAN;
BEGIN
  SELECT COUNT(*) INTO v_table
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'email_onboarding_state';
  IF v_table <> 1 THEN
    RAISE EXCEPTION 'email_onboarding_state: table missing';
  END IF;

  SELECT c.relrowsecurity INTO v_rls
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'email_onboarding_state';
  IF v_rls IS NOT TRUE THEN
    RAISE EXCEPTION 'email_onboarding_state: RLS not enabled';
  END IF;
END $$;

COMMIT;
