-- migrations/2026-09-08-editorial-hq-reset.sql
--
-- FULL EDITORIAL HQ RESET — one-off, intentionally destructive.
--
-- WIPES:
--   * editorial_projects        (every row — ideas, planned, pipeline, archived, dismissed)
--   * editorial_research        (every row — packs, approvals, extractor output, staged runs, notes)
--   * opportunity_radar_cache   (every row — suggestion cache resets)
--
-- PRESERVES:
--   * insights                  (published + draft PokePrices articles — public content stays live)
--   * insight assets            (hero images, SEO metadata, slugs, bodies untouched)
--   * release_calendar          (future release intel needed to generate opportunities)
--   * ai_usage                  (historical AI cost telemetry — read-only ledger, not workflow state)
--   * all card / set / pricing / population / trend tables (nothing outside editorial workflow is touched)
--
-- FK safety: insights.editorial_project_id (if it exists) is nulled
-- before editorial_projects rows are deleted so a published article
-- with a link back to its project loses only the reverse pointer,
-- not the article. The insights → editorial_projects FK does not
-- have ON DELETE SET NULL by default; we do it explicitly.
--
-- Wrapped in a transaction. If any assertion looks wrong, ROLLBACK.
-- COMMIT only after you confirm the audit block matches expectations.

BEGIN;

-- ─────────────────────────────────────────────────────────────────
-- STEP 1 — AUDIT BEFORE
-- ─────────────────────────────────────────────────────────────────
--
-- Capture baseline counts so we can eyeball the diff. Read-only.

SELECT '--- BEFORE ---' AS phase;

SELECT
  (SELECT count(*) FROM editorial_projects)                        AS projects_before,
  (SELECT count(*) FROM editorial_research)                        AS research_before,
  (SELECT count(*) FROM opportunity_radar_cache)                   AS radar_cache_before,
  (SELECT count(*) FROM insights)                                  AS insights_all_before,
  (SELECT count(*) FROM insights WHERE status = 'published')       AS insights_published_before;

-- Foreign keys that point AT editorial_projects — anything listed
-- here needs its column nulled/deleted first. On a stock schema
-- this should be exactly editorial_research.project_id, and
-- possibly insights.editorial_project_id. If more appears, ROLLBACK
-- and inspect before continuing.

SELECT '--- FKs pointing at editorial_projects ---' AS phase;
SELECT
  tc.table_name    AS from_table,
  kcu.column_name  AS from_column,
  tc.constraint_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage ccu
  ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND ccu.table_name = 'editorial_projects'
ORDER BY tc.table_name;

-- ─────────────────────────────────────────────────────────────────
-- STEP 2 — DETACH insights → editorial_projects (SAFETY)
-- ─────────────────────────────────────────────────────────────────
--
-- Some deployments store insights.editorial_project_id as a link
-- from a published article back to the project that produced it.
-- Null it out so we can delete projects without cascading into
-- public articles. Guarded by an IF EXISTS check on the column.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'insights'
      AND column_name = 'editorial_project_id'
  ) THEN
    EXECUTE 'UPDATE insights SET editorial_project_id = NULL WHERE editorial_project_id IS NOT NULL';
    RAISE NOTICE 'insights.editorial_project_id nulled out for detach';
  ELSE
    RAISE NOTICE 'insights.editorial_project_id column not present — nothing to detach';
  END IF;
END $$;

-- Also null out any similarly-named column on other tables that
-- might reference editorial_projects. This is defensive and only
-- fires when the column exists.

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT tc.table_name AS from_table, kcu.column_name AS from_column
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND ccu.table_name = 'editorial_projects'
      AND tc.table_name NOT IN ('editorial_research')  -- editorial_research is being wiped entirely, no need to null
  LOOP
    EXECUTE format('UPDATE %I SET %I = NULL WHERE %I IS NOT NULL', r.from_table, r.from_column, r.from_column);
    RAISE NOTICE 'detached %.% → editorial_projects', r.from_table, r.from_column;
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────
-- STEP 3 — DELETE workflow rows in FK-safe order
-- ─────────────────────────────────────────────────────────────────
--
-- Order matters:
--   1. editorial_research (references editorial_projects)
--   2. editorial_projects (parent — now free of dependents)
--   3. opportunity_radar_cache (no FKs)

DELETE FROM editorial_research;
DELETE FROM editorial_projects;
TRUNCATE opportunity_radar_cache;

-- ─────────────────────────────────────────────────────────────────
-- STEP 4 — AUDIT AFTER
-- ─────────────────────────────────────────────────────────────────
--
-- Every workflow count should be 0. Published-insights count MUST
-- match the AFTER value below; if it moved, ROLLBACK immediately.

SELECT '--- AFTER ---' AS phase;

SELECT
  (SELECT count(*) FROM editorial_projects)                        AS projects_after,
  (SELECT count(*) FROM editorial_research)                        AS research_after,
  (SELECT count(*) FROM opportunity_radar_cache)                   AS radar_cache_after,
  (SELECT count(*) FROM insights)                                  AS insights_all_after,
  (SELECT count(*) FROM insights WHERE status = 'published')       AS insights_published_after;

-- ─────────────────────────────────────────────────────────────────
-- STEP 5 — COMMIT or ROLLBACK
-- ─────────────────────────────────────────────────────────────────
--
-- Uncomment the COMMIT line ONLY after confirming:
--   * projects_after = 0
--   * research_after = 0
--   * radar_cache_after = 0
--   * insights_published_after = insights_published_before
--
-- If any of those don't match, run ROLLBACK instead.

-- COMMIT;
-- ROLLBACK;
