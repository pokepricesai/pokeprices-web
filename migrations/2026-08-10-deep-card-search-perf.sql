-- migrations/2026-08-10-deep-card-search-perf.sql
--
-- Block 5A-W-56A.2 — smallest targeted fix for the six Deep Card
-- Search queries that hit the 3-second Supabase statement_timeout
-- in production. Diagnostic:
--
--   * count_deep_search_catalogue:            239 ms   ✅
--   * cards_search_v LIMIT 1:                 147 ms   ✅
--   * Pikachu-filtered searches (B, C, E):    ~150 ms  ✅
--   * Every filter-less / filter-broad query
--     (A, D, F, G, H, I):                     3s TIMEOUT ❌
--
-- Every timing-out query scans the full 60,495-row view. The view's
-- LATERAL card_trends lookup joins on (card_name, set_name) — 60k
-- probes into a table with no compound index on those two columns.
-- That's the single dominant hot spot.
--
-- Fix: add ONE compound index. No structural change to the view or
-- RPC. No new columns. Rerun the same six queries after apply — they
-- should all fall under 1500 ms.
--
-- Reversible: `DROP INDEX IF EXISTS idx_card_trends_name_set`.

CREATE INDEX IF NOT EXISTS idx_card_trends_name_set
  ON public.card_trends (card_name, set_name);
