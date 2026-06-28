-- migrations/2026-06-26-watchlist-alert-overrides.sql
-- Block 5A-W-19 — per-card watchlist alert thresholds.
--
-- Adds the watchlist_alert_overrides table that lets a user customise
-- alert thresholds for individual watched cards. Global
-- user_alert_preferences remain the default; a row in this table only
-- takes effect when use_global_defaults=false (asymmetric rise/drop
-- thresholds) OR when enabled=false (silences alerts for that card
-- without changing any global setting).
--
-- Additive only — no DROP, no column rename, no destructive change.
-- RLS scopes to the owner; the service-role evaluator bypasses RLS
-- and reads every override row by user_id.
--
-- Apply by hand in the Supabase SQL Editor.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- Table
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.watchlist_alert_overrides (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- URL slug, matching watchlist.card_slug and cards.card_url_slug.
  -- The evaluator joins on the SAME key the watchlist uses so a card
  -- and its override stay paired regardless of how the bare-numeric
  -- cards.card_slug evolves.
  card_slug                text        NOT NULL,
  -- Master per-card switch. enabled=false silences instant alerts on
  -- this card even when global preferences are on. Independent of
  -- use_global_defaults.
  enabled                  boolean     NOT NULL DEFAULT true,
  -- When true, ignore rise_pct/drop_pct/recent_sales_enabled/
  -- market_activity_enabled and use the user's global thresholds.
  -- A row with use_global_defaults=true is meaningful only when
  -- enabled=false (i.e. card is silenced but global thresholds would
  -- otherwise apply).
  use_global_defaults      boolean     NOT NULL DEFAULT true,
  -- Asymmetric thresholds — applied to the SIGNED percent change.
  -- pct>0 compares to rise_pct; pct<0 compares to drop_pct. NULL
  -- means "no opinion" for that direction (the resolver falls back
  -- to the global watchlist threshold for that side).
  rise_pct                 integer,
  drop_pct                 integer,
  -- Per-card override of the recent_sales / market_activity rule
  -- toggles. Honoured only when use_global_defaults=false.
  recent_sales_enabled     boolean     NOT NULL DEFAULT true,
  market_activity_enabled  boolean     NOT NULL DEFAULT true,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT watchlist_alert_overrides_user_card_uniq
    UNIQUE (user_id, card_slug),
  CONSTRAINT watchlist_alert_overrides_rise_pct_range
    CHECK (rise_pct IS NULL OR (rise_pct BETWEEN 1 AND 100)),
  CONSTRAINT watchlist_alert_overrides_drop_pct_range
    CHECK (drop_pct IS NULL OR (drop_pct BETWEEN 1 AND 100))
);

-- Lookup index — every evaluator pass loads every override row for the
-- considered users in one batched query keyed by user_id.
CREATE INDEX IF NOT EXISTS watchlist_alert_overrides_user_id_idx
  ON public.watchlist_alert_overrides (user_id);

-- ─────────────────────────────────────────────────────────────────────
-- RLS — owner-only access for the browser client; service role
-- bypasses RLS by design.
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.watchlist_alert_overrides ENABLE ROW LEVEL SECURITY;

-- Drop any pre-existing policies of these names so the migration is
-- safely re-runnable. Policies are then re-created from scratch.
DROP POLICY IF EXISTS watchlist_alert_overrides_owner_select ON public.watchlist_alert_overrides;
DROP POLICY IF EXISTS watchlist_alert_overrides_owner_insert ON public.watchlist_alert_overrides;
DROP POLICY IF EXISTS watchlist_alert_overrides_owner_update ON public.watchlist_alert_overrides;
DROP POLICY IF EXISTS watchlist_alert_overrides_owner_delete ON public.watchlist_alert_overrides;

CREATE POLICY watchlist_alert_overrides_owner_select
  ON public.watchlist_alert_overrides
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY watchlist_alert_overrides_owner_insert
  ON public.watchlist_alert_overrides
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY watchlist_alert_overrides_owner_update
  ON public.watchlist_alert_overrides
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY watchlist_alert_overrides_owner_delete
  ON public.watchlist_alert_overrides
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────
-- updated_at trigger
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.watchlist_alert_overrides_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS watchlist_alert_overrides_set_updated_at ON public.watchlist_alert_overrides;
CREATE TRIGGER watchlist_alert_overrides_set_updated_at
  BEFORE UPDATE ON public.watchlist_alert_overrides
  FOR EACH ROW EXECUTE FUNCTION public.watchlist_alert_overrides_set_updated_at();

-- ─────────────────────────────────────────────────────────────────────
-- Sanity check — fail-fast if any of the bits above silently no-oped.
-- ─────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'watchlist_alert_overrides'
  ) THEN
    RAISE EXCEPTION 'watchlist_alert_overrides table was not created';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'watchlist_alert_overrides'
      AND policyname = 'watchlist_alert_overrides_owner_select'
  ) THEN
    RAISE EXCEPTION 'RLS select policy was not created';
  END IF;
END $$;

COMMIT;
