-- migrations/2026-09-11-58d3-comparison-fn-drop.sql
--
-- Block 5A-W-58D.3 — teardown for temporary artefacts installed during
-- the `get_set_cards_sortable` LATERAL → card_latest_prices cutover
-- validation.
--
-- WHEN TO RUN
--   Only AFTER the production cutover migration
--   (`2026-09-11-set-cards-sortable-latest-price-cutover.sql`) has been
--   applied AND /set/[slug] is confirmed healthy in production.
--   Running this before cutover throws away the equivalence-check tools.
--
-- Both DROPs are guarded with IF EXISTS so a missing artefact (never
-- created, or already cleaned up) is silently OK — the migration is
-- fully idempotent.

DROP FUNCTION IF EXISTS public.get_set_cards_sortable_v2_test(text, text);
DROP FUNCTION IF EXISTS public.benchmark_set_cards_sortable_58d3();
