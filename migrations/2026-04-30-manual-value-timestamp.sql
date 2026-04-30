-- 2026-04-30 — Manual-value timestamp on portfolio holdings
-- Used by the dashboard to show "manual value · last updated DD MMM" and
-- nudge users to refresh stale entries (e.g. > 60 days old).

ALTER TABLE portfolio_items
  ADD COLUMN IF NOT EXISTS manual_value_updated_at TIMESTAMPTZ;
