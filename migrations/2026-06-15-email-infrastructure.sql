-- migrations/2026-06-15-email-infrastructure.sql
-- Block 3A — production email infrastructure foundation.
--
-- ADDITIVE ONLY. Does NOT drop, alter or migrate data out of:
--   * user_email_preferences (Block 1B) — remains authoritative for
--     existing dashboard toggles.
--   * pending_emails (Block 1B) — remains the authoritative queue
--     for the existing alert/digest flow.
--   * /api/unsubscribe route — keeps its current contract.
--
-- Idempotent: every CREATE uses IF NOT EXISTS / ON CONFLICT.
-- Safe to re-run. Apply manually in the Supabase SQL Editor.
--
-- After apply, run the post-conditions block at the end of the file to
-- confirm all five tables + RLS exist as expected.

BEGIN;

CREATE EXTENSION IF NOT EXISTS citext;

-- ─────────────────────────────────────────────────────────────────────
-- 1. email_contacts — canonical contact (email-keyed, user-optional)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.email_contacts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_normalized  CITEXT NOT NULL UNIQUE,
  user_id           UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  email_verified    BOOLEAN NOT NULL DEFAULT FALSE,
  email_verified_at TIMESTAMPTZ,
  -- 'auth_signup' | 'newsletter_form' | 'admin_import' | 'webhook_backfill' | 'send_service'
  source            TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_contacts_user_id
  ON public.email_contacts(user_id)
  WHERE user_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────
-- 2. email_consents — append-only consent log
-- ─────────────────────────────────────────────────────────────────────
-- One row per consent event (granted OR revoked). The CURRENT state for
-- a (contact, category) pair is the row with the largest created_at.
-- We never UPDATE this table; revoking inserts a new row with
-- state='revoked'.
CREATE TABLE IF NOT EXISTS public.email_consents (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id        UUID NOT NULL REFERENCES public.email_contacts(id) ON DELETE CASCADE,
  -- Categories — keep in sync with src/lib/email/categories.ts:
  --   transactional, service_product, marketing_newsletter,
  --   watchlist_alert, card_show_reminder, weekly_report, onboarding
  category          TEXT NOT NULL,
  state             TEXT NOT NULL CHECK (state IN ('granted', 'revoked')),
  source            TEXT NOT NULL,    -- 'settings_toggle' | 'newsletter_form' | 'admin_action' | 'unsubscribe_link' | 'webhook_complaint' | 'webhook_bounce' | 'auth_signup'
  consent_version   TEXT NOT NULL DEFAULT 'v1',
  notes_internal    TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_consents_contact_cat_created
  ON public.email_consents(contact_id, category, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────
-- 3. email_suppressions — global or per-category
-- ─────────────────────────────────────────────────────────────────────
-- An ACTIVE suppression is one where lifted_at IS NULL. A NULL
-- category means a GLOBAL suppression (blocks all non-transactional
-- application email). The UNIQUE constraint makes apply-suppression
-- idempotent.
CREATE TABLE IF NOT EXISTS public.email_suppressions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id        UUID NOT NULL REFERENCES public.email_contacts(id) ON DELETE CASCADE,
  reason            TEXT NOT NULL CHECK (reason IN (
                       'hard_bounce',
                       'complaint',
                       'manual_unsubscribe',
                       'admin_suppression',
                       'invalid_address',
                       'provider_rejection',
                       'soft_bounce_threshold'
                     )),
  category          TEXT,                    -- NULL = global
  source            TEXT NOT NULL,
  provider_event_id TEXT,
  notes_internal    TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lifted_at         TIMESTAMPTZ
);

-- Idempotency: at most one row per (contact, reason, category-or-global).
-- We treat NULL category as a stable bucket using COALESCE on a sentinel.
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_suppressions_unique
  ON public.email_suppressions(contact_id, reason, COALESCE(category, '__global__'));

CREATE INDEX IF NOT EXISTS idx_email_suppressions_active
  ON public.email_suppressions(contact_id)
  WHERE lifted_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────
-- 4. email_delivery_log — one row per send attempt
-- ─────────────────────────────────────────────────────────────────────
-- idempotency_key is UNIQUE so two concurrent send attempts with the
-- same key collapse into a single delivery log row at insert time.
CREATE TABLE IF NOT EXISTS public.email_delivery_log (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id            UUID REFERENCES public.email_contacts(id) ON DELETE SET NULL,
  user_id               UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  recipient_email_hash  TEXT,                    -- SHA-256 of normalized email
  template_key          TEXT NOT NULL,
  category              TEXT NOT NULL,
  campaign_key          TEXT,
  status                TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                          'pending',
                          'sent',
                          'delivered',
                          'delivery_delayed',
                          'bounced',
                          'complained',
                          'failed',
                          'suppressed',
                          'unsubscribed',
                          'preference_disabled',
                          'duplicate',
                          'invalid_recipient',
                          'configuration_error',
                          'provider_error'
                        )),
  idempotency_key       TEXT NOT NULL UNIQUE,
  resend_email_id       TEXT,
  error_code            TEXT,
  retry_count           INT NOT NULL DEFAULT 0,
  metadata_json         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at               TIMESTAMPTZ,
  delivered_at          TIMESTAMPTZ,
  bounced_at            TIMESTAMPTZ,
  complained_at         TIMESTAMPTZ,
  failed_at             TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_email_delivery_log_contact_created
  ON public.email_delivery_log(contact_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_delivery_log_resend_id
  ON public.email_delivery_log(resend_email_id)
  WHERE resend_email_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────
-- 5. email_webhook_events — raw provider events
-- ─────────────────────────────────────────────────────────────────────
-- Source of truth for dedup BEFORE reconciling into delivery log.
-- provider_event_id is UNIQUE so duplicate webhook deliveries are
-- detected at insert time.
CREATE TABLE IF NOT EXISTS public.email_webhook_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider            TEXT NOT NULL DEFAULT 'resend',
  provider_event_id   TEXT NOT NULL UNIQUE,
  event_type          TEXT NOT NULL,
  event_at            TIMESTAMPTZ NOT NULL,
  resend_email_id     TEXT,
  payload_normalized  JSONB NOT NULL,
  signature_verified  BOOLEAN NOT NULL DEFAULT TRUE,
  processed_at        TIMESTAMPTZ,
  processing_error    TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_webhook_events_resend
  ON public.email_webhook_events(resend_email_id)
  WHERE resend_email_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────
-- Idempotent backfill from auth.users → email_contacts
-- ─────────────────────────────────────────────────────────────────────
-- Does NOT create any consents — historical signup did not collect
-- per-category consent under this model. Categories must be granted
-- explicitly through settings, the newsletter form or auth events
-- after this block ships.
INSERT INTO public.email_contacts (email_normalized, user_id, email_verified, email_verified_at, source, created_at, updated_at)
SELECT
  LOWER(u.email)::citext,
  u.id,
  (u.email_confirmed_at IS NOT NULL),
  u.email_confirmed_at,
  'auth_signup',
  u.created_at,
  NOW()
FROM auth.users u
WHERE u.email IS NOT NULL AND u.email <> ''
ON CONFLICT (email_normalized) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────────────
-- email_contacts + email_consents: a signed-in user can SEE their own
-- rows. Inserts/updates always go through the server with the
-- service-role client (no policies grant write access).
-- email_suppressions, email_delivery_log, email_webhook_events: no
-- user-facing policies → service-role only.
ALTER TABLE public.email_contacts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_consents        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_suppressions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_delivery_log    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_webhook_events  ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  -- Drop any prior copies so the migration stays idempotent under re-run.
  EXECUTE 'DROP POLICY IF EXISTS email_contacts_self_select ON public.email_contacts';
  EXECUTE 'DROP POLICY IF EXISTS email_consents_self_select ON public.email_consents';
END $$;

CREATE POLICY email_contacts_self_select ON public.email_contacts
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY email_consents_self_select ON public.email_consents
  FOR SELECT TO authenticated
  USING (contact_id IN (SELECT id FROM public.email_contacts WHERE user_id = auth.uid()));

-- ─────────────────────────────────────────────────────────────────────
-- Post-conditions (verify before committing the transaction)
-- ─────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_tables INT;
  v_rls    INT;
BEGIN
  SELECT COUNT(*) INTO v_tables
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN (
      'email_contacts','email_consents','email_suppressions',
      'email_delivery_log','email_webhook_events'
    );
  IF v_tables <> 5 THEN
    RAISE EXCEPTION 'email-infrastructure: expected 5 tables, found %', v_tables;
  END IF;

  SELECT COUNT(*) INTO v_rls
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname IN (
      'email_contacts','email_consents','email_suppressions',
      'email_delivery_log','email_webhook_events'
    )
    AND c.relrowsecurity;
  IF v_rls <> 5 THEN
    RAISE EXCEPTION 'email-infrastructure: expected RLS enabled on 5 tables, found %', v_rls;
  END IF;
END $$;

COMMIT;
