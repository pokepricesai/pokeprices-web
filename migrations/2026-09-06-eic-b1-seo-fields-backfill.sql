-- 2026-09-06-eic-b1-seo-fields-backfill.sql
--
-- EIC Block 1 — Part 4. One-shot backfill from meta_title /
-- meta_description into seo_title / seo_description.
--
-- Live state inspected before writing this migration (see Block 1
-- report):
--   * public.insights has both column pairs.
--   * meta_title  NOT NULL DEFAULT ''    (populated on all 8 rows)
--   * meta_description NOT NULL DEFAULT '' (populated on all 8 rows)
--   * seo_title  TEXT NULL   (0 rows populated)
--   * seo_description TEXT NULL   (0 rows populated)
--   * no divergence between pairs (obviously — one side is empty).
--   * 8 rows would benefit from backfill.
--
-- Backfill rules from the block:
--   * only copy meta_title  -> seo_title       when seo_title is null/blank
--   * only copy meta_description -> seo_description when seo_description is null/blank
--   * never overwrite an existing non-empty seo_* value
--   * do not touch slug, headline, body_json, status, published_at,
--     image_url, or any other content field
--
-- After this migration, /insights/{slug} will render the admin's
-- authored meta_title in <title> and meta_description in
-- <meta name="description"> because the public route reads seo_*
-- fields directly (see src/app/insights/[slug]/page.tsx). Headline,
-- URL, JSON-LD structure and body all remain unchanged.
--
-- Application-level dual-write is installed at the same time in
-- src/lib/insights/adminApi.ts (mirrorSeoFields), so future admin
-- saves keep the two pairs in sync going forward.

BEGIN;

-- Guard: both target columns must exist. If schema has drifted, abort.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='insights' AND column_name='seo_title'
  ) THEN
    RAISE EXCEPTION 'Expected public.insights.seo_title to exist before backfilling. Aborting.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='insights' AND column_name='seo_description'
  ) THEN
    RAISE EXCEPTION 'Expected public.insights.seo_description to exist before backfilling. Aborting.';
  END IF;
END $$;

UPDATE public.insights
SET seo_title = meta_title
WHERE (seo_title IS NULL OR btrim(seo_title) = '')
  AND meta_title IS NOT NULL
  AND btrim(meta_title) <> '';

UPDATE public.insights
SET seo_description = meta_description
WHERE (seo_description IS NULL OR btrim(seo_description) = '')
  AND meta_description IS NOT NULL
  AND btrim(meta_description) <> '';

COMMIT;

-- Verification (run separately after applying):
--
--   SELECT slug, seo_title, meta_title,
--          seo_title = meta_title AS pair_title_matches,
--          seo_description = meta_description AS pair_desc_matches
--   FROM public.insights
--   ORDER BY published_at DESC NULLS LAST;
--
-- Expected: pair_title_matches = TRUE and pair_desc_matches = TRUE
-- for every row that had non-empty meta_* values before this ran.
