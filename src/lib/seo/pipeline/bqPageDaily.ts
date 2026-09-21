// src/lib/seo/pipeline/bqPageDaily.ts
// ============================================================================
// Stage 4C — reusable BigQuery → seo_gsc_page_daily ingest logic.
//
// Mirrors scripts/seo/ingest-bq-page-daily.mjs but as a Node-friendly
// module callable from the /api/cron/seo-daily orchestrator. The CLI
// script is kept for manual local runs; this module is the source of
// truth for automation.
//
// Auth
//   Production (Vercel):  OIDC → WIF → SA impersonation. Requires
//                         GCP_PROJECT_NUMBER, GCP_WORKLOAD_IDENTITY_POOL_ID,
//                         GCP_WORKLOAD_IDENTITY_PROVIDER_ID,
//                         GCP_SERVICE_ACCOUNT_EMAIL.
//   Local dev:            Application Default Credentials via gcloud.
//
// Safety
//   * Bytes-scanned budget enforced (default 10 GiB) with pre-query
//     dry-run to abort BEFORE running an over-budget scan.
//   * Idempotent: dates already present in seo_gsc_page_daily are skipped.
//   * One row per invocation written to seo_bq_ingest_runs (job_kind
//     'page_daily_ingest'), status ok / error / aborted_budget.
// ============================================================================

import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { makeBigQueryClient } from '../bqClient'

const SITE_KEY = 'pokeprices'
const SOURCE   = 'google'
const JOB_KIND = 'page_daily_ingest'
const USD_PER_TIB = 6.25
/** First BigQuery-live day. API historical backfill owns dates before
 *  this; overlap would double-count. */
const BQ_INGEST_FLOOR_DATE = '2026-09-16'

export type IngestResult = {
  status: 'ok' | 'error' | 'aborted_budget' | 'noop_no_new_dates'
  bq_dates_available: string[]
  dates_ingested: string[]
  per_day: Array<{ date: string; rows: number; impressions: number; clicks: number; bytes: number }>
  total_rows: number
  total_bytes: number
  estimated_cost_usd: number
  auth_mode: string
  run_id: string | null
  error?: string
}

function bqDateToString(v: any): string | null {
  if (v == null) return null
  if (typeof v === 'string') return v.slice(0, 10)
  if (typeof v === 'object' && v.value) return String(v.value).slice(0, 10)
  return null
}

export async function runBqDailyIngest(supa: SupabaseClient): Promise<IngestResult> {
  const PROJECT_ID = process.env.SEO_BQ_PROJECT_ID!
  const DATASET   = process.env.SEO_BQ_DATASET
  const LOCATION  = process.env.SEO_BQ_LOCATION || 'EU'
  const MAX_BYTES = Number(process.env.SEO_INGEST_MAX_BYTES_SCANNED || 10 * 1024 * 1024 * 1024)
  if (!DATASET) throw new Error('SEO_BQ_DATASET env var is not set')

  let runId: string | null = null
  const openRun = async (authMode: string): Promise<string> => {
    const { data, error } = await supa
      .from('seo_bq_ingest_runs')
      .insert({ site_key: SITE_KEY, source: SOURCE, job_kind: JOB_KIND, status: 'in_progress' })
      .select('run_id').single()
    if (error) throw new Error(`open ingest run: ${error.message}`)
    return data.run_id as string
  }
  const closeRun = async (patch: { status: string; bytes?: number; rows?: number; error?: string }) => {
    if (!runId) return
    await supa.from('seo_bq_ingest_runs').update({
      ended_at: new Date().toISOString(),
      status: patch.status,
      rows_ingested: patch.rows ?? null,
      bytes_scanned: patch.bytes ?? null,
      estimated_cost_usd: patch.bytes != null
        ? Number(((patch.bytes / (1024 ** 4)) * USD_PER_TIB).toFixed(6))
        : null,
      error: patch.error ?? null,
    }).eq('run_id', runId)
  }

  let bytesUsed = 0
  let ctxAuthMode = 'unknown'

  try {
    const ctx = await makeBigQueryClient()
    ctxAuthMode = ctx.authMode
    runId = await openRun(ctx.authMode)

    const dryRun = async (sql: string, params: Record<string, any>): Promise<number> => {
      const [job] = await ctx.bq.createQueryJob({
        query: sql, dryRun: true, location: LOCATION, useLegacySql: false, params,
      })
      return Number(job.metadata.statistics?.totalBytesProcessed || 0)
    }
    const runQuery = async (sql: string, params: Record<string, any>, label: string) => {
      const est = await dryRun(sql, params).catch(() => 0)
      if (bytesUsed + est > MAX_BYTES) {
        throw new Error(`[budget] ${label} would push bytes to ${bytesUsed + est}, over cap ${MAX_BYTES}`)
      }
      const [job] = await ctx.bq.createQueryJob({
        query: sql, location: LOCATION, useLegacySql: false, params,
      })
      const [rows] = await job.getQueryResults()
      const billed = Number(job.metadata.statistics?.query?.totalBytesBilled || 0)
      bytesUsed += billed
      return { rows: rows as any[], billedBytes: billed }
    }

    // 1) Discover BQ dates from the floor onward.
    const discoverSql = `
      SELECT DISTINCT data_date
      FROM \`${PROJECT_ID}.${DATASET}.searchdata_url_impression\`
      WHERE data_date >= DATE(@start_date)
        AND data_date <= CURRENT_DATE()
      ORDER BY data_date
    `
    const disc = await runQuery(discoverSql, { start_date: BQ_INGEST_FLOOR_DATE }, 'discover-dates')
    const bqDates = disc.rows.map(r => bqDateToString(r.data_date)).filter((s): s is string => !!s).sort()

    // 2) Which dates are missing from seo_gsc_page_daily?
    const pending: string[] = []
    for (const d of bqDates) {
      const { count, error } = await supa
        .from('seo_gsc_page_daily')
        .select('*', { count: 'exact', head: true })
        .eq('site_key', SITE_KEY).eq('source', SOURCE).eq('date', d)
      if (error) throw new Error(`count for ${d}: ${error.message}`)
      if ((count ?? 0) === 0) pending.push(d)
    }

    if (pending.length === 0) {
      await closeRun({ status: 'ok', bytes: bytesUsed, rows: 0 })
      return {
        status: 'noop_no_new_dates',
        bq_dates_available: bqDates,
        dates_ingested: [],
        per_day: [],
        total_rows: 0,
        total_bytes: bytesUsed,
        estimated_cost_usd: Number(((bytesUsed / (1024 ** 4)) * USD_PER_TIB).toFixed(6)),
        auth_mode: ctxAuthMode,
        run_id: runId,
      }
    }

    // 3) Aggregate + upsert each pending date.
    const aggregateSql = `
      WITH per_url AS (
        SELECT data_date, url,
               SUM(impressions)  AS impressions,
               SUM(clicks)       AS clicks,
               SUM(sum_position) AS sum_position
        FROM \`${PROJECT_ID}.${DATASET}.searchdata_url_impression\`
        WHERE data_date = DATE(@date) AND search_type = 'WEB'
        GROUP BY data_date, url
      )
      SELECT data_date, url, impressions, clicks, sum_position
      FROM per_url WHERE impressions > 0
    `
    const perDay: IngestResult['per_day'] = []
    let totalRows = 0

    for (const date of pending) {
      const agg = await runQuery(aggregateSql, { date }, `aggregate-${date}`)
      const outRows = agg.rows.map(r => ({
        site_key: SITE_KEY, source: SOURCE, url: String(r.url), date,
        impressions: Number(r.impressions), clicks: Number(r.clicks || 0),
        sum_position: Math.max(0, Number(r.sum_position || 0)),
      }))
      const CHUNK = 500
      let written = 0
      for (let i = 0; i < outRows.length; i += CHUNK) {
        const { error } = await supa
          .from('seo_gsc_page_daily')
          .upsert(outRows.slice(i, i + CHUNK), {
            onConflict: 'site_key,source,url,date', ignoreDuplicates: false,
          })
        if (error) throw new Error(`upsert ${date} chunk ${i}: ${error.message}`)
        written += Math.min(CHUNK, outRows.length - i)
      }
      totalRows += written
      const sumImp = outRows.reduce((s, r) => s + r.impressions, 0)
      const sumClk = outRows.reduce((s, r) => s + r.clicks, 0)
      perDay.push({ date, rows: written, impressions: sumImp, clicks: sumClk, bytes: agg.billedBytes })
    }

    await closeRun({ status: 'ok', bytes: bytesUsed, rows: totalRows })
    return {
      status: 'ok',
      bq_dates_available: bqDates,
      dates_ingested: pending,
      per_day: perDay,
      total_rows: totalRows,
      total_bytes: bytesUsed,
      estimated_cost_usd: Number(((bytesUsed / (1024 ** 4)) * USD_PER_TIB).toFixed(6)),
      auth_mode: ctxAuthMode,
      run_id: runId,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    const isBudget = message.startsWith('[budget]')
    await closeRun({
      status: isBudget ? 'aborted_budget' : 'error',
      bytes: bytesUsed,
      error: message,
    })
    return {
      status: isBudget ? 'aborted_budget' : 'error',
      bq_dates_available: [],
      dates_ingested: [],
      per_day: [],
      total_rows: 0,
      total_bytes: bytesUsed,
      estimated_cost_usd: Number(((bytesUsed / (1024 ** 4)) * USD_PER_TIB).toFixed(6)),
      auth_mode: ctxAuthMode,
      run_id: runId,
      error: message,
    }
  }
}
