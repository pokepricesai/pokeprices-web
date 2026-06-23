-- migrations/2026-06-23-user-alert-preferences.sql
-- Block 5A-W-1 — foundation for rule-based alerts.
--
-- WHY
--   The legacy user_alerts table (supabase/migrations/20260426_dashboard_tools.sql)
--   is THRESHOLD-based: one row per (user, card, grade, alert_type) with
--   an explicit cents threshold. That UI was hidden as "coming soon"
--   because asking users to pick a threshold per card has been a poor
--   retention pattern.
--
--   This block introduces a RULE-based model instead — one row per user
--   stating "notify me when any watched/owned card matches any of these
--   rules". The evaluation cron / email send path comes in later blocks;
--   this migration ONLY adds the schema + RLS + indexes that future
--   work will read.
--
--   The legacy user_alerts table is KEPT and untouched — its data (any
--   existing per-card thresholds) remains valid and a future block may
--   wire it back as an "Advanced — per-card targets" surface.
--
-- ADDITIVE ONLY
--   * No alter / drop / truncate on existing objects (watchlist,
--     portfolios, portfolio_items, user_alerts, user_email_preferences,
--     profiles, email_*).
--   * Two new tables, both with RLS + owner policies.
--   * No backfill rows; tables start empty. The application reads a
--     synthesised default when no preference row exists.

-- ─────────────────────────────────────────────────────────────────────
-- 1. user_alert_preferences — one row per user, sensible defaults
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_alert_preferences (
  user_id                       UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Master switch. When false NO rule fires, regardless of the rule
  -- flags below.
  enabled                       BOOLEAN NOT NULL DEFAULT TRUE,

  -- Scope: which lists the evaluator pulls cards from.
  scope_watchlist               BOOLEAN NOT NULL DEFAULT TRUE,
  scope_portfolio               BOOLEAN NOT NULL DEFAULT TRUE,

  -- Rule toggles + thresholds. Each rule has an enabled flag; the
  -- _pct threshold is always present so a future evaluator does not
  -- need to default a missing column.
  --
  -- Rule list mirrors the brief:
  --   * price_move        — any tracked price moved by >= pct
  --   * recent_sales      — new recent_sales rows landed for the card
  --   * psa10_change      — PSA 10 price moved by >= pct (sub-rule of move)
  --   * raw_change        — raw price moved by >= pct           (sub-rule of move)
  --   * spread_change     — raw→PSA10 multiple widened/narrowed by >= pct
  --   * market_activity   — heuristic "this card is moving" flag

  rule_price_move_enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  rule_price_move_pct           INT     NOT NULL DEFAULT 10
                                  CHECK (rule_price_move_pct BETWEEN 1 AND 100),

  rule_recent_sales_enabled     BOOLEAN NOT NULL DEFAULT TRUE,

  rule_psa10_change_enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  rule_psa10_change_pct         INT     NOT NULL DEFAULT 10
                                  CHECK (rule_psa10_change_pct BETWEEN 1 AND 100),

  rule_raw_change_enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  rule_raw_change_pct           INT     NOT NULL DEFAULT 10
                                  CHECK (rule_raw_change_pct BETWEEN 1 AND 100),

  rule_spread_change_enabled    BOOLEAN NOT NULL DEFAULT FALSE,
  rule_spread_change_pct        INT     NOT NULL DEFAULT 15
                                  CHECK (rule_spread_change_pct BETWEEN 1 AND 100),

  rule_market_activity_enabled  BOOLEAN NOT NULL DEFAULT TRUE,

  -- Quiet period. The evaluator MUST NOT raise more than one event per
  -- (user, card, rule) within this window. Zero is allowed (no
  -- cooldown) for the future "instant" cadence.
  min_hours_between_alerts      INT     NOT NULL DEFAULT 24
                                  CHECK (min_hours_between_alerts BETWEEN 0 AND 168),

  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.user_alert_preferences ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  EXECUTE 'DROP POLICY IF EXISTS user_alert_preferences_owner_select ON public.user_alert_preferences';
  EXECUTE 'DROP POLICY IF EXISTS user_alert_preferences_owner_modify ON public.user_alert_preferences';
END $$;

CREATE POLICY user_alert_preferences_owner_select ON public.user_alert_preferences
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY user_alert_preferences_owner_modify ON public.user_alert_preferences
  FOR ALL USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());


-- ─────────────────────────────────────────────────────────────────────
-- 2. alert_events — append-only triggered-rule log
-- ─────────────────────────────────────────────────────────────────────
-- One row per (user, card, rule) firing. Future evaluator inserts;
-- future email/digest job reads undelivered rows and updates
-- delivered_at. The user's dashboard reads the recent-7d slice.
CREATE TABLE IF NOT EXISTS public.alert_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Denormalised card identity (matches the watchlist convention so
  -- the email renderer never has to join back to scraper-owned cards).
  card_slug         TEXT NOT NULL CHECK (length(card_slug) BETWEEN 1 AND 80),
  card_name         TEXT NULL CHECK (card_name IS NULL OR length(card_name) <= 200),
  set_name          TEXT NULL CHECK (set_name  IS NULL OR length(set_name)  <= 200),

  -- The rule that fired. Mirrors the rule_*_enabled column names on
  -- user_alert_preferences minus the rule_ prefix and _enabled suffix.
  rule              TEXT NOT NULL CHECK (rule IN (
                      'price_move',
                      'recent_sales',
                      'psa10_change',
                      'raw_change',
                      'spread_change',
                      'market_activity'
                    )),

  -- Operator-tunable priority for future digest grouping.
  severity          TEXT NOT NULL DEFAULT 'normal'
                      CHECK (severity IN ('low','normal','high')),

  -- Free-form typed-but-flexible payload: { pct, old_cents, new_cents,
  -- raw_cents, psa10_cents, marketplace, … }. Bounded by row size
  -- (Postgres default) — keep terse.
  payload_json      JSONB NOT NULL DEFAULT '{}'::jsonb,

  detected_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at      TIMESTAMPTZ NULL,
  delivery_channel  TEXT NULL CHECK (delivery_channel IS NULL OR delivery_channel IN ('email','in_app')),

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Dashboard "your recent alerts" listing.
CREATE INDEX IF NOT EXISTS idx_alert_events_user_detected
  ON public.alert_events (user_id, detected_at DESC);

-- Future digest cron: "give me all undelivered events grouped by user".
CREATE INDEX IF NOT EXISTS idx_alert_events_undelivered
  ON public.alert_events (detected_at)
  WHERE delivered_at IS NULL;

-- Cooldown lookup: "did this user + card + rule fire in the last N hours?"
CREATE INDEX IF NOT EXISTS idx_alert_events_user_card_rule
  ON public.alert_events (user_id, card_slug, rule, detected_at DESC);

ALTER TABLE public.alert_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  EXECUTE 'DROP POLICY IF EXISTS alert_events_owner_select   ON public.alert_events';
  EXECUTE 'DROP POLICY IF EXISTS alert_events_no_public_write ON public.alert_events';
END $$;

-- Owner can read their own events. Writes happen via the service-role
-- evaluator only (which bypasses RLS); no public INSERT/UPDATE/DELETE
-- policy means anon/authenticated cannot mutate this table.
CREATE POLICY alert_events_owner_select ON public.alert_events
  FOR SELECT USING (user_id = auth.uid());


-- ─────────────────────────────────────────────────────────────────────
-- 3. updated_at trigger for user_alert_preferences
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.touch_user_alert_preferences_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_alert_preferences_touch_updated_at
  ON public.user_alert_preferences;

CREATE TRIGGER user_alert_preferences_touch_updated_at
  BEFORE UPDATE ON public.user_alert_preferences
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_user_alert_preferences_updated_at();
