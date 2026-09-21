-- =============================================================================
-- Stage 5B · Bing warehouse schema — source-of-truth BigQuery DDL.
--
-- This file is REFERENCE ONLY. It is not applied by the Supabase migration
-- runner. The canonical execution path is src/lib/seo/bing/bqSchema.ts
-- → ensureBingSchema(), invoked by the daily cron. This SQL exists so the
-- schema can be inspected, replayed manually, or reviewed in-repo.
--
-- Target:   BigQuery
-- Project:  pokeprices-seo
-- Dataset:  seo_measurement (EU)
--
-- Every statement is idempotent (CREATE ... IF NOT EXISTS). Running the
-- file end-to-end on a fresh project creates the dataset + all six tables.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS `pokeprices-seo.seo_measurement`
OPTIONS (
  location = "EU",
  description = "PokePrices unified SEO measurement warehouse — Bing Webmaster ingest (Stage 5B). Not for Google-managed exports."
);

-- ── bing_site_daily ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `pokeprices-seo.seo_measurement.bing_site_daily` (
  date              DATE      NOT NULL,
  clicks            INT64,
  impressions       INT64,
  surface_scope     STRING    NOT NULL,
  source_updated_at TIMESTAMP,
  ingested_at       TIMESTAMP NOT NULL,
  ingest_run_id     STRING    NOT NULL
)
PARTITION BY date
OPTIONS (
  description = "Bing site-wide daily totals from GetRankAndTrafficStats. surface_scope=bing_combined_surfaces indicates Web+Chat+News+Images+Videos+Knowledge Panel combined (as of 2023-03-24). NOT equivalent to Google WEB totals — do not compare mechanically."
);

-- ── bing_page_weekly ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `pokeprices-seo.seo_measurement.bing_page_weekly` (
  snapshot_date           DATE      NOT NULL,
  raw_url                 STRING    NOT NULL,
  canonical_url           STRING,
  clicks                  INT64,
  impressions             INT64,
  avg_click_position      FLOAT64,
  avg_impression_position FLOAT64,
  ingested_at             TIMESTAMP NOT NULL,
  ingest_run_id           STRING    NOT NULL
)
PARTITION BY snapshot_date
OPTIONS (
  description = "Bing weekly page snapshots from GetPageStats. PARTIAL/TOP-N: a page missing from a snapshot IS NOT ZERO. avg_click_position and avg_impression_position are pre-computed averages — never re-average or roll up naively. Raw and canonical URLs both preserved."
);

-- ── bing_query_weekly ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `pokeprices-seo.seo_measurement.bing_query_weekly` (
  snapshot_date           DATE      NOT NULL,
  query                   STRING    NOT NULL,
  clicks                  INT64,
  impressions             INT64,
  avg_click_position      FLOAT64,
  avg_impression_position FLOAT64,
  ingested_at             TIMESTAMP NOT NULL,
  ingest_run_id           STRING    NOT NULL
)
PARTITION BY snapshot_date
OPTIONS (
  description = "Bing weekly query snapshots from GetQueryStats. PARTIAL/TOP-N. Position averages must not be re-averaged."
);

-- ── bing_crawl_daily ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `pokeprices-seo.seo_measurement.bing_crawl_daily` (
  date                   DATE      NOT NULL,
  crawled_pages          INT64,
  crawl_errors           INT64,
  code_2xx               INT64,
  code_301               INT64,
  code_302               INT64,
  code_4xx               INT64,
  code_5xx               INT64,
  blocked_by_robots_txt  INT64,
  connection_timeout     INT64,
  dns_failures           INT64,
  contains_malware       INT64,
  all_other_codes        INT64,
  in_index               INT64,
  in_links               INT64,
  ingested_at            TIMESTAMP NOT NULL,
  ingest_run_id          STRING    NOT NULL
)
PARTITION BY date
OPTIONS (
  description = "Bing daily crawl telemetry from GetCrawlStats. Field names mirror Bing API semantics as-returned."
);

-- ── bing_feed_snapshots ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `pokeprices-seo.seo_measurement.bing_feed_snapshots` (
  snapshot_date       DATE      NOT NULL,
  feed_url            STRING    NOT NULL,
  canonical_feed_url  STRING,
  feed_type           STRING,
  status              STRING,
  url_count           INT64,
  file_size           INT64,
  last_crawled        TIMESTAMP,
  submitted           TIMESTAMP,
  compressed          BOOL,
  ingested_at         TIMESTAMP NOT NULL,
  ingest_run_id       STRING    NOT NULL
)
PARTITION BY snapshot_date
OPTIONS (
  description = "Bing feed / sitemap snapshots from GetFeeds."
);

-- ── bing_ingest_runs ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `pokeprices-seo.seo_measurement.bing_ingest_runs` (
  run_id                     STRING    NOT NULL,
  started_at                 TIMESTAMP NOT NULL,
  finished_at                TIMESTAMP,
  status                     STRING    NOT NULL,
  trigger                    STRING    NOT NULL,
  site_daily_rows            INT64,
  page_weekly_rows           INT64,
  query_weekly_rows          INT64,
  crawl_daily_rows           INT64,
  feed_rows                  INT64,
  latest_site_date_before    DATE,
  latest_site_date_after     DATE,
  latest_weekly_date_before  DATE,
  latest_weekly_date_after   DATE,
  error_summary              STRING
)
OPTIONS (
  description = "Bing ingest run audit log. Never stores API keys, request headers, or auth material."
);
