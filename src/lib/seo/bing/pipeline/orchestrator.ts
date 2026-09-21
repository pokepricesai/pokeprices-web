// src/lib/seo/bing/pipeline/orchestrator.ts
// ============================================================================
// Bing warehouse orchestrator.
//
// Runs the five source ingests in sequence and records one row in
// bing_ingest_runs describing the outcome. Idempotent by construction:
// every source is a MERGE upsert on a logical key.
//
// One code path serves both:
//   - the first-time historical backfill (whatever the API currently returns)
//   - the daily incremental (also whatever the API returns — MERGE dedupes)
//
// The cron route is the sole caller in production. The trigger string
// distinguishes 'cron' from 'admin_manual' when the operator invokes the
// same route ad-hoc.
// ============================================================================

import 'server-only'
import { randomUUID } from 'node:crypto'

import { makeBigQueryClient, type BqContext } from '../../bqClient'
import { requireBingApiKey, BING_SITE_URL } from '../restClient'
import { ensureBingSchema, BING_BQ_DATASET, BING_TABLES } from '../bqSchema'

import { ingestSiteDaily,     type SiteDailyResult }    from '../sources/siteDaily'
import { ingestPageWeekly,    type PageWeeklyResult }   from '../sources/pageWeekly'
import { ingestQueryWeekly,   type QueryWeeklyResult }  from '../sources/queryWeekly'
import { ingestCrawlDaily,    type CrawlDailyResult }   from '../sources/crawlDaily'
import { ingestFeedSnapshots, type FeedSnapshotResult } from '../sources/feedSnapshots'

export type BingIngestTrigger = 'cron' | 'admin_manual'

export type BingIngestResult = {
  run_id: string
  status: 'ok' | 'partial' | 'error'
  trigger: BingIngestTrigger
  started_at: string
  finished_at: string
  auth_mode: string
  bq_dataset: string
  site_url: string
  schema_result: { ok_count: number; failed_count: number; failed?: Array<{ label: string; error: string }> }
  site_daily:     SiteDailyResult
  page_weekly:    PageWeeklyResult
  query_weekly:   QueryWeeklyResult
  crawl_daily:    CrawlDailyResult
  feed_snapshots: FeedSnapshotResult
  before: {
    latest_site_date:   string | null
    latest_weekly_date: string | null
  }
  after: {
    latest_site_date:   string | null
    latest_weekly_date: string | null
  }
  total_bytes_billed: number
  error?: string
}

async function latestDateFromTable(ctx: BqContext, table: string, dateCol: string): Promise<string | null> {
  try {
    const sql = `SELECT MAX(${dateCol}) AS d FROM \`${ctx.projectId}.${BING_BQ_DATASET}.${table}\``
    const [job] = await ctx.bq.createQueryJob({ query: sql, location: ctx.location, useLegacySql: false })
    const [rows] = await job.getQueryResults()
    const v = rows?.[0]?.d
    if (v == null) return null
    if (typeof v === 'string') return v.slice(0, 10)
    if (typeof v === 'object' && v && (v as any).value) return String((v as any).value).slice(0, 10)
    return null
  } catch {
    // Missing table on first run — perfectly fine. Report null.
    return null
  }
}

async function recordRun(
  ctx: BqContext,
  patch: {
    run_id: string
    started_at: string
    finished_at: string
    status: BingIngestResult['status']
    trigger: BingIngestTrigger
    site_daily_rows: number | null
    page_weekly_rows: number | null
    query_weekly_rows: number | null
    crawl_daily_rows: number | null
    feed_rows: number | null
    latest_site_date_before: string | null
    latest_site_date_after: string | null
    latest_weekly_date_before: string | null
    latest_weekly_date_after: string | null
    error_summary: string | null
  },
): Promise<void> {
  const sql = `
    INSERT INTO \`${ctx.projectId}.${BING_BQ_DATASET}.${BING_TABLES.ingestRuns}\` (
      run_id, started_at, finished_at, status, trigger,
      site_daily_rows, page_weekly_rows, query_weekly_rows, crawl_daily_rows, feed_rows,
      latest_site_date_before, latest_site_date_after,
      latest_weekly_date_before, latest_weekly_date_after,
      error_summary
    ) VALUES (
      @run_id, @started_at, @finished_at, @status, @trigger,
      @site_daily_rows, @page_weekly_rows, @query_weekly_rows, @crawl_daily_rows, @feed_rows,
      @latest_site_date_before, @latest_site_date_after,
      @latest_weekly_date_before, @latest_weekly_date_after,
      @error_summary
    )
  `
  await ctx.bq.createQueryJob({
    query: sql,
    location: ctx.location,
    useLegacySql: false,
    params: patch,
    types: {
      run_id: 'STRING', started_at: 'TIMESTAMP', finished_at: 'TIMESTAMP',
      status: 'STRING', trigger: 'STRING',
      site_daily_rows: 'INT64', page_weekly_rows: 'INT64', query_weekly_rows: 'INT64',
      crawl_daily_rows: 'INT64', feed_rows: 'INT64',
      latest_site_date_before: 'DATE', latest_site_date_after: 'DATE',
      latest_weekly_date_before: 'DATE', latest_weekly_date_after: 'DATE',
      error_summary: 'STRING',
    },
  }).then(([job]) => job.getQueryResults()).catch(() => { /* best-effort audit; don't crash ingest */ })
}

export async function runBingIngest(trigger: BingIngestTrigger): Promise<BingIngestResult> {
  const run_id = randomUUID()
  const started_at = new Date().toISOString()
  const apiKey = requireBingApiKey()
  const ctx = await makeBigQueryClient()

  // 1) Ensure schema exists (idempotent).
  const schema = await ensureBingSchema(ctx)
  const schema_failed = schema.statements.filter(s => !s.ok).map(s => ({ label: s.label, error: s.error ?? 'unknown' }))
  const schema_result = {
    ok_count: schema.statements.length - schema_failed.length,
    failed_count: schema_failed.length,
    ...(schema_failed.length ? { failed: schema_failed } : {}),
  }

  // 2) Capture "before" state.
  const [latest_site_date_before, latest_weekly_date_before] = await Promise.all([
    latestDateFromTable(ctx, BING_TABLES.siteDaily,   'date'),
    latestDateFromTable(ctx, BING_TABLES.pageWeekly,  'snapshot_date'),
  ])

  // 3) Run all five sources. Continue on individual failures; the run
  //    status downgrades to 'partial' or 'error' as appropriate.
  const [site_daily, page_weekly, query_weekly, crawl_daily, feed_snapshots] = await Promise.all([
    ingestSiteDaily     (ctx, apiKey, BING_SITE_URL, run_id),
    ingestPageWeekly    (ctx, apiKey, BING_SITE_URL, run_id),
    ingestQueryWeekly   (ctx, apiKey, BING_SITE_URL, run_id),
    ingestCrawlDaily    (ctx, apiKey, BING_SITE_URL, run_id),
    ingestFeedSnapshots (ctx, apiKey, BING_SITE_URL, run_id),
  ])

  // 4) Capture "after" state.
  const [latest_site_date_after, latest_weekly_date_after] = await Promise.all([
    latestDateFromTable(ctx, BING_TABLES.siteDaily,   'date'),
    latestDateFromTable(ctx, BING_TABLES.pageWeekly,  'snapshot_date'),
  ])

  const errors: string[] = []
  if (site_daily.status     === 'error') errors.push(`site_daily: ${site_daily.error ?? 'unknown'}`)
  if (page_weekly.status    === 'error') errors.push(`page_weekly: ${page_weekly.error ?? 'unknown'}`)
  if (query_weekly.status   === 'error') errors.push(`query_weekly: ${query_weekly.error ?? 'unknown'}`)
  if (crawl_daily.status    === 'error') errors.push(`crawl_daily: ${crawl_daily.error ?? 'unknown'}`)
  if (feed_snapshots.status === 'error') errors.push(`feed_snapshots: ${feed_snapshots.error ?? 'unknown'}`)
  if (schema_failed.length)              errors.push(`schema: ${schema_failed.length} DDL statement(s) failed`)
  const status: BingIngestResult['status'] =
    errors.length === 0 ? 'ok' :
    (errors.length === 5 || schema_failed.length) ? 'error' : 'partial'

  const finished_at = new Date().toISOString()
  const total_bytes_billed =
    site_daily.bytes_billed +
    page_weekly.bytes_billed +
    query_weekly.bytes_billed +
    crawl_daily.bytes_billed +
    feed_snapshots.bytes_billed

  // 5) Best-effort audit row. Not critical to ingest correctness.
  if (schema_failed.length === 0) {
    await recordRun(ctx, {
      run_id, started_at, finished_at, status, trigger,
      site_daily_rows:   site_daily.rows_seen,
      page_weekly_rows:  page_weekly.rows_seen,
      query_weekly_rows: query_weekly.rows_seen,
      crawl_daily_rows:  crawl_daily.rows_seen,
      feed_rows:         feed_snapshots.rows_seen,
      latest_site_date_before, latest_site_date_after,
      latest_weekly_date_before, latest_weekly_date_after,
      error_summary: errors.length ? errors.join(' | ').slice(0, 500) : null,
    })
  }

  return {
    run_id, status, trigger, started_at, finished_at,
    auth_mode: ctx.authMode,
    bq_dataset: BING_BQ_DATASET,
    site_url: BING_SITE_URL,
    schema_result,
    site_daily, page_weekly, query_weekly, crawl_daily, feed_snapshots,
    before: { latest_site_date: latest_site_date_before, latest_weekly_date: latest_weekly_date_before },
    after:  { latest_site_date: latest_site_date_after,  latest_weekly_date: latest_weekly_date_after  },
    total_bytes_billed,
    ...(errors.length ? { error: errors.join(' | ').slice(0, 500) } : {}),
  }
}
