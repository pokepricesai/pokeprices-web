-- migrations/2026-06-24-alert-preferences-v2.sql
-- Block 5A-W-13 — additive expansion of user_alert_preferences for the
-- final user-facing alert settings UI (weekly digest + instant alerts +
-- per-scope thresholds + per-rule count thresholds + user-overridable
-- digest cooldown).
--
-- ADDITIVE ONLY
--   * No alter / drop / truncate on existing columns.
--   * Every new column is NOT NULL with a safe DEFAULT, so existing
--     rows get sensible values immediately and the typed helper in
--     src/lib/alerts/preferences.ts can stop reading them defensively.
--   * No new tables. No new triggers. No new RLS policies (the
--     existing user_alert_preferences_owner_* policies already cover
--     these columns because they apply to the row, not to individual
--     columns).
--   * Idempotent: re-running this migration is a no-op once the
--     columns exist (`ADD COLUMN IF NOT EXISTS`).
--
-- WHY
--   The 5A-W-1 schema modelled a single rule-based alert preference.
--   5A-W-11 / 5A-W-12 added card-grouped delivery + per-recipient
--   cooldown at the orchestrator level. Users now need direct control
--   over:
--     (a) the weekly overview email — on/off, portfolio half on/off,
--         watchlist half on/off, what day of the week to receive it
--     (b) the instant-alert cadence — a dedicated switch separate from
--         the master `enabled` so a user can disable per-event alerts
--         while keeping the weekly overview
--     (c) different price-move thresholds for portfolio vs watchlist
--         (collectors care more about meaningful moves on cards they
--          OWN than on cards they merely watch)
--     (d) numerical thresholds for the recent_sales and market_activity
--         rules (currently on/off only — too noisy without a min count)
--     (e) a per-user override of the system-wide digest cooldown
--
--   The evaluator + delivery orchestrator are NOT updated in this
--   block; they still read the legacy fields. A later block will wire
--   the new fields once the UI ships.

BEGIN;

ALTER TABLE public.user_alert_preferences
  -- (A) Weekly overview controls
  ADD COLUMN IF NOT EXISTS weekly_digest_enabled              BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS weekly_overview_portfolio_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS weekly_overview_watchlist_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
  -- 1 = Monday, 7 = Sunday (ISO weekday convention)
  ADD COLUMN IF NOT EXISTS weekly_digest_day_of_week          INT     NOT NULL DEFAULT 1,

  -- (B) Instant alerts switch (distinct from the master `enabled`)
  ADD COLUMN IF NOT EXISTS instant_alerts_enabled             BOOLEAN NOT NULL DEFAULT TRUE,

  -- (C) Per-scope price-move thresholds
  ADD COLUMN IF NOT EXISTS rule_price_move_portfolio_pct      INT     NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS rule_price_move_watchlist_pct      INT     NOT NULL DEFAULT 15,

  -- (C) Numerical thresholds for previously on/off-only rules
  ADD COLUMN IF NOT EXISTS rule_recent_sales_min_count        INT     NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS rule_market_activity_min_count     INT     NOT NULL DEFAULT 5,

  -- (D) Per-user override of the system-wide digest cooldown.
  -- NULL semantics are NOT used here so the helper doesn't need a
  -- two-step "if null, fall back" read; the orchestrator can compare
  -- this directly against the env-supplied global. The env override
  -- (ALERT_DELIVERY_USER_COOLDOWN_HOURS) remains the operator-side
  -- floor — the orchestrator will eventually pick max(envHours, userHours).
  ADD COLUMN IF NOT EXISTS digest_cooldown_hours              INT     NOT NULL DEFAULT 24;

-- ─────────────────────────────────────────────────────────────────────
-- CHECK constraints — added separately so they're easy to drop / amend
-- without touching the column definitions. Each is idempotent.
-- ─────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'user_alert_preferences_weekly_dow_chk'
       AND conrelid = 'public.user_alert_preferences'::regclass
  ) THEN
    ALTER TABLE public.user_alert_preferences
      ADD CONSTRAINT user_alert_preferences_weekly_dow_chk
        CHECK (weekly_digest_day_of_week BETWEEN 1 AND 7);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'user_alert_preferences_pm_portfolio_chk'
       AND conrelid = 'public.user_alert_preferences'::regclass
  ) THEN
    ALTER TABLE public.user_alert_preferences
      ADD CONSTRAINT user_alert_preferences_pm_portfolio_chk
        CHECK (rule_price_move_portfolio_pct BETWEEN 1 AND 100);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'user_alert_preferences_pm_watchlist_chk'
       AND conrelid = 'public.user_alert_preferences'::regclass
  ) THEN
    ALTER TABLE public.user_alert_preferences
      ADD CONSTRAINT user_alert_preferences_pm_watchlist_chk
        CHECK (rule_price_move_watchlist_pct BETWEEN 1 AND 100);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'user_alert_preferences_recent_sales_chk'
       AND conrelid = 'public.user_alert_preferences'::regclass
  ) THEN
    ALTER TABLE public.user_alert_preferences
      ADD CONSTRAINT user_alert_preferences_recent_sales_chk
        CHECK (rule_recent_sales_min_count BETWEEN 1 AND 50);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'user_alert_preferences_market_activity_chk'
       AND conrelid = 'public.user_alert_preferences'::regclass
  ) THEN
    ALTER TABLE public.user_alert_preferences
      ADD CONSTRAINT user_alert_preferences_market_activity_chk
        CHECK (rule_market_activity_min_count BETWEEN 1 AND 100);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'user_alert_preferences_digest_cooldown_chk'
       AND conrelid = 'public.user_alert_preferences'::regclass
  ) THEN
    ALTER TABLE public.user_alert_preferences
      ADD CONSTRAINT user_alert_preferences_digest_cooldown_chk
        CHECK (digest_cooldown_hours BETWEEN 1 AND 168);
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- Sanity checks
-- ─────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  expected_cols TEXT[] := ARRAY[
    'weekly_digest_enabled',
    'weekly_overview_portfolio_enabled',
    'weekly_overview_watchlist_enabled',
    'weekly_digest_day_of_week',
    'instant_alerts_enabled',
    'rule_price_move_portfolio_pct',
    'rule_price_move_watchlist_pct',
    'rule_recent_sales_min_count',
    'rule_market_activity_min_count',
    'digest_cooldown_hours'
  ];
  found_count INT;
BEGIN
  SELECT count(*) INTO found_count
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name   = 'user_alert_preferences'
     AND column_name  = ANY(expected_cols);
  IF found_count <> array_length(expected_cols, 1) THEN
    RAISE EXCEPTION
      'expected 10 new columns on user_alert_preferences after migration, found %', found_count;
  END IF;
END $$;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────
-- Operator notes
-- ─────────────────────────────────────────────────────────────────────
--
-- Rollback (if needed BEFORE the UI ships and writes any non-default
-- values):
--   ALTER TABLE public.user_alert_preferences
--     DROP CONSTRAINT IF EXISTS user_alert_preferences_weekly_dow_chk,
--     DROP CONSTRAINT IF EXISTS user_alert_preferences_pm_portfolio_chk,
--     DROP CONSTRAINT IF EXISTS user_alert_preferences_pm_watchlist_chk,
--     DROP CONSTRAINT IF EXISTS user_alert_preferences_recent_sales_chk,
--     DROP CONSTRAINT IF EXISTS user_alert_preferences_market_activity_chk,
--     DROP CONSTRAINT IF EXISTS user_alert_preferences_digest_cooldown_chk;
--   ALTER TABLE public.user_alert_preferences
--     DROP COLUMN IF EXISTS weekly_digest_enabled,
--     DROP COLUMN IF EXISTS weekly_overview_portfolio_enabled,
--     DROP COLUMN IF EXISTS weekly_overview_watchlist_enabled,
--     DROP COLUMN IF EXISTS weekly_digest_day_of_week,
--     DROP COLUMN IF EXISTS instant_alerts_enabled,
--     DROP COLUMN IF EXISTS rule_price_move_portfolio_pct,
--     DROP COLUMN IF EXISTS rule_price_move_watchlist_pct,
--     DROP COLUMN IF EXISTS rule_recent_sales_min_count,
--     DROP COLUMN IF EXISTS rule_market_activity_min_count,
--     DROP COLUMN IF EXISTS digest_cooldown_hours;
