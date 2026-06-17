-- scripts/verify-recent-sales-schema.sql
-- Block 4B-W-1 — read-only verification queries.
--
-- Run after applying migrations/2026-06-17-recent-sales-stage-1.sql.
-- Every query is SELECT-only; no INSERT, no UPDATE, no DELETE.

-- ─────────────────────────────────────────────────────────────────────
-- A. All four tables exist
-- ─────────────────────────────────────────────────────────────────────
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'provider_card_links','market_import_runs',
    'recent_sales','recent_sales_card_allow_list'
  )
ORDER BY table_name;
-- Expected: 4 rows.

-- ─────────────────────────────────────────────────────────────────────
-- B. RLS enabled on all four
-- ─────────────────────────────────────────────────────────────────────
SELECT c.relname, c.relrowsecurity AS rls_enabled
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'provider_card_links','market_import_runs',
    'recent_sales','recent_sales_card_allow_list'
  )
ORDER BY c.relname;
-- Expected: all 4 rows with rls_enabled = t.

-- ─────────────────────────────────────────────────────────────────────
-- C. No user-facing policies (service-role only at this stage)
-- ─────────────────────────────────────────────────────────────────────
SELECT schemaname, tablename, policyname
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'provider_card_links','market_import_runs',
    'recent_sales','recent_sales_card_allow_list'
  );
-- Expected: 0 rows.

-- ─────────────────────────────────────────────────────────────────────
-- D. Expected indexes
-- ─────────────────────────────────────────────────────────────────────
SELECT tablename, indexname
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN (
    'provider_card_links','market_import_runs',
    'recent_sales','recent_sales_card_allow_list'
  )
ORDER BY tablename, indexname;
-- Expected (at minimum):
--   provider_card_links: pkey + UNIQUE on (provider, provider_card_id, language)
--                        + idx_provider_card_links_card_slug
--                        + idx_provider_card_links_lookup
--   market_import_runs:  pkey + idx_market_import_runs_started_at
--                        + idx_market_import_runs_status_started
--   recent_sales:        pkey + UNIQUE on provider_sale_key
--                        + idx_recent_sales_card_section_date
--                        + idx_recent_sales_provider_section_date
--                        + idx_recent_sales_status_review_run
--                        + idx_recent_sales_marketplace_date
--                        + idx_recent_sales_last_seen
--                        + idx_recent_sales_item_id
--                        + idx_recent_sales_raw_hash
--   recent_sales_card_allow_list: pkey + UNIQUE on (provider, provider_card_id)
--                                 + idx_recent_sales_allow_lookup

-- ─────────────────────────────────────────────────────────────────────
-- E. provider_sale_key is UNIQUE; raw_hash is NOT; marketplace_item_id is NOT
-- ─────────────────────────────────────────────────────────────────────
SELECT
  conname,
  pg_get_constraintdef(c.oid) AS definition
FROM pg_constraint c
JOIN pg_class      t ON t.oid = c.conrelid
WHERE t.relname = 'recent_sales'
  AND c.contype = 'u'
ORDER BY conname;
-- Expected: exactly one UNIQUE constraint, on (provider_sale_key).
-- NO unique constraint on raw_hash; NO unique constraint on marketplace_item_id.

-- ─────────────────────────────────────────────────────────────────────
-- F. Backfill — total eligible cards
-- ─────────────────────────────────────────────────────────────────────
SELECT COUNT(*) AS eligible_cards
FROM public.cards
WHERE card_slug ~ '^\d+$';

-- ─────────────────────────────────────────────────────────────────────
-- G. Backfill — total provider_card_links created
-- ─────────────────────────────────────────────────────────────────────
SELECT
  COUNT(*)                                        AS total_links,
  COUNT(*) FILTER (WHERE confidence = 1.000)     AS validated_by_pc_url,
  COUNT(*) FILTER (WHERE confidence = 0.900)     AS no_pc_url,
  COUNT(*) FILTER (WHERE confidence = 0.700)     AS pc_url_mismatch
FROM public.provider_card_links
WHERE provider = 'pricecharting'
  AND language = 'en';

-- ─────────────────────────────────────────────────────────────────────
-- H. Cards with no provider_card_links row
-- ─────────────────────────────────────────────────────────────────────
SELECT COUNT(*) AS cards_without_links
FROM public.cards c
WHERE c.card_slug ~ '^\d+$'
  AND NOT EXISTS (
    SELECT 1 FROM public.provider_card_links pcl
    WHERE pcl.provider = 'pricecharting'
      AND pcl.language = 'en'
      AND pcl.provider_card_id = c.card_slug
  );
-- Expected: 0 after a fresh backfill.

-- ─────────────────────────────────────────────────────────────────────
-- I. Duplicate provider identities (must be zero — UNIQUE constraint
--    enforces this, but the check is cheap)
-- ─────────────────────────────────────────────────────────────────────
SELECT provider, provider_card_id, language, COUNT(*) AS dup_count
FROM public.provider_card_links
GROUP BY provider, provider_card_id, language
HAVING COUNT(*) > 1;
-- Expected: 0 rows.

-- ─────────────────────────────────────────────────────────────────────
-- J. Links with missing card_slug (the soft-ref is nullable; this
--    measures bridge orphans)
-- ─────────────────────────────────────────────────────────────────────
SELECT COUNT(*) AS links_without_card_slug
FROM public.provider_card_links
WHERE card_slug IS NULL;
-- Expected: 0 after a fresh backfill (every backfilled row copied
-- card_slug from cards.card_slug).

-- ─────────────────────────────────────────────────────────────────────
-- K. Stage 1 invariants — these tables must remain empty
-- ─────────────────────────────────────────────────────────────────────
SELECT
  (SELECT COUNT(*) FROM public.recent_sales)                AS recent_sales_count,
  (SELECT COUNT(*) FROM public.recent_sales_card_allow_list) AS allow_list_count,
  (SELECT COUNT(*) FROM public.market_import_runs)          AS import_runs_count;
-- Expected: all three = 0 until later stages.
