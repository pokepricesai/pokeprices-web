-- migrations/2026-09-08-opportunity-radar-cache.sql
--
-- EIC — daily cache for the Opportunity Radar.
--
-- The Radar is deterministic but non-trivial (multiple aggregate
-- queries + overlap scoring). Caching it per calendar day means:
--   * repeated visits during the same day return a stable
--     suggestion set (no visual churn while an admin is working)
--   * "Refresh Opportunities" forces a recompute
--
-- Deliberately tiny — one row per calendar_date.
--
-- Manual apply: paste into Supabase SQL Editor and run.

CREATE TABLE IF NOT EXISTS opportunity_radar_cache (
  calendar_date TEXT        PRIMARY KEY,   -- YYYY-MM-DD in UTC
  computed_at   TIMESTAMPTZ NOT NULL       DEFAULT NOW(),
  radar_json    JSONB       NOT NULL
);
