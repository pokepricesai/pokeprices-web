// src/lib/seo/bing/bqSchema.ts
// ============================================================================
// Bing warehouse schema — DDL + table constants.
//
// Dataset:  seo_measurement          (EU, project pokeprices-seo)
// Tables:
//   bing_site_daily        · GetRankAndTrafficStats,  grain=(date)
//   bing_page_weekly       · GetPageStats,            grain=(snapshot_date, canonical_url)
//   bing_query_weekly      · GetQueryStats,           grain=(snapshot_date, query)
//   bing_crawl_daily       · GetCrawlStats,           grain=(date)
//   bing_feed_snapshots    · GetFeeds,                grain=(snapshot_date, feed_url)
//   bing_ingest_runs       · this pipeline's audit log
//
// Data-semantic invariants encoded in table descriptions and, where useful,
// enforced by NOT NULL + logical-key deduplication in the upsert path
// (see src/lib/seo/bing/sources/*).
// ============================================================================

import 'server-only'
import type { BqContext } from '../bqClient'

export const BING_BQ_DATASET =
  process.env.SEO_MEASUREMENT_DATASET || 'seo_measurement'

export const BING_TABLES = {
  siteDaily:     'bing_site_daily',
  pageWeekly:    'bing_page_weekly',
  queryWeekly:   'bing_query_weekly',
  crawlDaily:    'bing_crawl_daily',
  feedSnapshots: 'bing_feed_snapshots',
  ingestRuns:    'bing_ingest_runs',
} as const

/** All-Bing-surfaces marker written into every bing_site_daily row so
 *  downstream consumers cannot forget that this is not Web-only. */
export const BING_SURFACE_SCOPE_COMBINED = 'bing_combined_surfaces'

/** Build the idempotent DDL that creates the dataset and all tables.
 *  Safe to run repeatedly. Returns the list of DDL statements in order. */
export function bingSchemaDdl(project: string, dataset: string): string[] {
  return [
    // ── Dataset ──────────────────────────────────────────────────────────
    `CREATE SCHEMA IF NOT EXISTS \`${project}.${dataset}\`
     OPTIONS (
       location = "EU",
       description = "PokePrices unified SEO measurement warehouse — Bing Webmaster ingest (Stage 5B). Not for Google-managed exports."
     )`,

    // ── bing_site_daily ──────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS \`${project}.${dataset}.${BING_TABLES.siteDaily}\` (
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
     )`,

    // ── bing_page_weekly ─────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS \`${project}.${dataset}.${BING_TABLES.pageWeekly}\` (
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
     )`,

    // ── bing_query_weekly ────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS \`${project}.${dataset}.${BING_TABLES.queryWeekly}\` (
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
     )`,

    // ── bing_crawl_daily ─────────────────────────────────────────────────
    // Field names below preserve Bing API semantics as returned. Do not
    // rename into interpretations we have not proven from the docs.
    `CREATE TABLE IF NOT EXISTS \`${project}.${dataset}.${BING_TABLES.crawlDaily}\` (
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
     )`,

    // ── bing_feed_snapshots ──────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS \`${project}.${dataset}.${BING_TABLES.feedSnapshots}\` (
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
       description = "Bing feed / sitemap snapshots from GetFeeds. Raw feed URL preserved; canonical_feed_url populated when the feed is a PokePrices URL under our canonicalisation rule."
     )`,

    // ── bing_ingest_runs ─────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS \`${project}.${dataset}.${BING_TABLES.ingestRuns}\` (
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
     )`,
  ]
}

/** Execute the idempotent DDL. Returns per-statement pass/fail so the
 *  caller can surface partial-failure diagnostics without aborting the
 *  ingest. Since every DDL is IF NOT EXISTS, a second run should report
 *  every statement as ok with zero side-effects. */
export async function ensureBingSchema(
  ctx: BqContext,
): Promise<{ statements: Array<{ label: string; ok: boolean; error?: string }> }> {
  const ddls = bingSchemaDdl(ctx.projectId, BING_BQ_DATASET)
  const statements: Array<{ label: string; ok: boolean; error?: string }> = []
  for (const sql of ddls) {
    const firstLine = sql.trim().split('\n')[0]?.slice(0, 90) ?? '(unknown)'
    try {
      const [job] = await ctx.bq.createQueryJob({
        query: sql,
        location: ctx.location,
        useLegacySql: false,
      })
      await job.getQueryResults()
      statements.push({ label: firstLine, ok: true })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'unknown ddl error'
      statements.push({ label: firstLine, ok: false, error: msg.slice(0, 300) })
    }
  }
  return { statements }
}
