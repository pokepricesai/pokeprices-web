-- 2026-06-15 — vendors.logo_url + vendor_upload_tokens + atomic RPC (Block 1B)
-- ============================================================================
-- Live-schema-confirmed Block 1B migration.
--
-- Production inspection on 2026-06-15 confirmed that:
--   * public.vendors has RLS disabled and NO policies.
--   * public.vendors does NOT have a logo_url column.
--   * public.vendors holds two rows (existing legitimate vendors).
--
-- This migration is ADDITIVE ONLY. It:
--   1. Adds vendors.logo_url (TEXT NULL) if missing.
--   2. Creates the vendor_upload_tokens table (idempotent).
--   3. Enables RLS on vendor_upload_tokens (no policies — service-role only).
--   4. Creates the SECURITY DEFINER atomic-commit function.
--
-- The function references vendors.logo_url, so the column is added BEFORE
-- the function body is parsed. Both happen in the same SQL session.
--
-- It deliberately does NOT touch vendors RLS — that is a separate
-- migration (`2026-06-15-vendors-rls-enable.sql`) that must run AFTER the
-- new application code is live.
--
-- Existing rows are untouched. active and verified flags are not changed.
--
-- ---------------------------------------------------------------------------
-- ROLLBACK
-- ---------------------------------------------------------------------------
-- This migration only adds objects. To roll back:
--
--   DROP FUNCTION IF EXISTS public.consume_vendor_upload_token(text, uuid, text);
--   DROP TABLE    IF EXISTS public.vendor_upload_tokens;
--   -- logo_url should be left in place once added; dropping it would lose
--   -- any logo URLs already written by approved-and-live vendor rows.
--
-- Do NOT drop logo_url unless you have confirmed no live vendor row uses it.
-- ============================================================================


-- ── 1. vendors.logo_url ─────────────────────────────────────────────────────
-- TEXT NULL is the right shape for an optional public URL. No index is
-- created here because: production has 2 rows today, the directory query
-- does not filter or sort on logo_url, and a partial index on
-- (logo_url IS NOT NULL) would be redundant against table-scan economics
-- at this scale.

ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS logo_url TEXT;


-- ── 2. vendor_upload_tokens table ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.vendor_upload_tokens (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id       UUID NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  token_hash      TEXT NOT NULL UNIQUE,
  expires_at      TIMESTAMPTZ NOT NULL,
  used_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_ip_hash TEXT,
  purpose         TEXT NOT NULL DEFAULT 'logo_upload'
);

CREATE INDEX IF NOT EXISTS idx_vendor_upload_tokens_vendor
  ON public.vendor_upload_tokens (vendor_id);

CREATE INDEX IF NOT EXISTS idx_vendor_upload_tokens_unused_expires
  ON public.vendor_upload_tokens (expires_at)
  WHERE used_at IS NULL;

ALTER TABLE public.vendor_upload_tokens ENABLE ROW LEVEL SECURITY;
-- No user policies. Service-role bypasses RLS by default; no explicit
-- service-role policy is created (Block 1A convention).


-- ── 3. Atomic single-use commit ─────────────────────────────────────────────
-- search_path is fixed to the empty string and every object inside is
-- fully qualified. Built-in functions (pg_catalog.now, pg_catalog.uuid)
-- resolve via the implicit pg_catalog search. This matches the strictest
-- Supabase advisory for SECURITY DEFINER functions.

DROP FUNCTION IF EXISTS public.consume_vendor_upload_token(text, uuid, text);

CREATE OR REPLACE FUNCTION public.consume_vendor_upload_token(
  p_token_hash text,
  p_vendor_id  uuid,
  p_logo_url   text
)
RETURNS TABLE(ok boolean, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_token_id uuid;
BEGIN
  SELECT t.id
    INTO v_token_id
  FROM public.vendor_upload_tokens t
  JOIN public.vendors v ON v.id = t.vendor_id
  WHERE t.token_hash  = p_token_hash
    AND t.vendor_id   = p_vendor_id
    AND t.used_at     IS NULL
    AND t.expires_at  > pg_catalog.now()
    AND v.active      = FALSE
    AND v.logo_url    IS NULL
    AND t.purpose     = 'logo_upload'
  FOR UPDATE;

  IF v_token_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'invalid_or_expired_or_already_committed';
    RETURN;
  END IF;

  UPDATE public.vendor_upload_tokens
     SET used_at = pg_catalog.now()
   WHERE id = v_token_id;

  UPDATE public.vendors
     SET logo_url = p_logo_url
   WHERE id = p_vendor_id;

  RETURN QUERY SELECT TRUE, 'ok';
END;
$$;

REVOKE ALL ON FUNCTION public.consume_vendor_upload_token(text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_vendor_upload_token(text, uuid, text) TO service_role;


-- ── 4. Final sanity check ──────────────────────────────────────────────────
-- Aborts the transaction (rolling back everything above) if logo_url did
-- not actually land, so the migration can never half-apply.
DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'vendors' AND column_name = 'logo_url'
  ) THEN
    RAISE EXCEPTION '[1B] post-condition failed: vendors.logo_url is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'vendor_upload_tokens'
  ) THEN
    RAISE EXCEPTION '[1B] post-condition failed: vendor_upload_tokens is missing';
  END IF;
END
$verify$;
