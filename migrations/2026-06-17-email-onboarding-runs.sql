-- migrations/2026-06-17-email-onboarding-runs.sql
-- Block 3D — onboarding processor run log.
--
-- ADDITIVE ONLY. Does NOT alter or touch:
--   * email_onboarding_state           (Block 3B / 3B correction)
--   * email_contacts / email_consents  (Block 3A)
--   * email_delivery_log               (Block 3A)
--   * Onboarding eligibility / timing  (Block 3B)
--
-- Idempotent. Safe to re-run. Apply manually in the Supabase SQL Editor.
--
-- Row contents are intentionally minimal: no email addresses, no user
-- IDs, no onboarding row IDs, no secrets. Operators read summary
-- counts only.

BEGIN;

CREATE TABLE IF NOT EXISTS public.email_onboarding_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Where the run came from.
  source          TEXT NOT NULL CHECK (source IN ('cron','manual')),

  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ,

  -- See src/lib/email/onboardingProcessor.ts for the rules:
  --   running   — row inserted, batch in flight
  --   success   — batch completed and failed_count = 0 and retried_count = 0
  --   partial   — batch completed but failed_count > 0 OR retried_count > 0
  --   failed    — route or processor threw before producing a summary
  --   disabled  — feature flag off; no work done
  status          TEXT NOT NULL DEFAULT 'running' CHECK (status IN (
                    'running','success','partial','failed','disabled'
                  )),

  -- Counts mirror the processor's typed summary.
  processed_count INT NOT NULL DEFAULT 0,
  sent_count      INT NOT NULL DEFAULT 0,
  skipped_count   INT NOT NULL DEFAULT 0,
  retried_count   INT NOT NULL DEFAULT 0,
  cancelled_count INT NOT NULL DEFAULT 0,
  failed_count    INT NOT NULL DEFAULT 0,

  duration_ms     INT,
  error_code      TEXT,           -- short, operator-safe diagnostic — never a secret

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Retention guidance (docs/email-onboarding.md):
--   * keep last 30 days of rows for live monitoring
--   * archive or purge older rows quarterly
-- The migration intentionally does NOT install a retention trigger.

CREATE INDEX IF NOT EXISTS idx_email_onboarding_runs_started_at
  ON public.email_onboarding_runs(started_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_onboarding_runs_status_started
  ON public.email_onboarding_runs(status, started_at DESC);

-- ─────────────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────────────
-- Service-role only. No user-facing policies are created — every
-- consumer (status endpoint, run wrapper, admin panel) goes through
-- the service-role client.
ALTER TABLE public.email_onboarding_runs ENABLE ROW LEVEL SECURITY;

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
  WHERE table_schema = 'public' AND table_name = 'email_onboarding_runs';
  IF v_table <> 1 THEN
    RAISE EXCEPTION 'email_onboarding_runs: table missing';
  END IF;

  SELECT c.relrowsecurity INTO v_rls
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'email_onboarding_runs';
  IF v_rls IS NOT TRUE THEN
    RAISE EXCEPTION 'email_onboarding_runs: RLS not enabled';
  END IF;
END $$;

COMMIT;
