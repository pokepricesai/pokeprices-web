// src/lib/seo/bing/sources/siteDaily.ts
// ============================================================================
// GetRankAndTrafficStats → bing_site_daily
//
// Grain: one row per date. Idempotent MERGE on `date`.
//
// Data-semantic guard: every row is stamped surface_scope='bing_combined_
// surfaces' — GetRankAndTrafficStats reports Bing across Web + Chat + News
// + Images + Videos + Knowledge Panel (all-surface combined from 2023-03-24
// onward, per Bing docs). This is NOT equivalent to Google Search Console
// WEB totals. Downstream consumers must never combine the two mechanically.
// ============================================================================

import 'server-only'
import { bingFetch, parseWcfDate } from '../restClient'
import type { BqContext } from '../../bqClient'
import { BING_BQ_DATASET, BING_TABLES, BING_SURFACE_SCOPE_COMBINED } from '../bqSchema'
import { upsertRows } from '../bqMerge'

type ApiRow = {
  Date?: unknown
  Clicks?: unknown
  Impressions?: unknown
}

export type SiteDailyResult = {
  status: 'ok' | 'error'
  rows_seen: number
  rows_inserted: number
  rows_updated: number
  distinct_dates: number
  first_date: string | null
  last_date:  string | null
  bytes_billed: number
  api_attempts: number
  api_latency_ms: number
  error?: string
}

export async function ingestSiteDaily(
  ctx: BqContext,
  apiKey: string,
  siteUrl: string,
  ingestRunId: string,
): Promise<SiteDailyResult> {
  const fetched = await bingFetch<ApiRow[]>('GetRankAndTrafficStats', { siteUrl }, apiKey)
  const empty = {
    rows_seen: 0, rows_inserted: 0, rows_updated: 0, distinct_dates: 0,
    first_date: null, last_date: null, bytes_billed: 0,
    api_attempts: fetched.attempts, api_latency_ms: fetched.latency_ms,
  }
  if (!fetched.ok) {
    return { status: 'error', ...empty, error: fetched.error }
  }
  if (!Array.isArray(fetched.data)) {
    return { status: 'error', ...empty, error: '`d` field is not an array' }
  }

  const rows: Array<{
    date: string
    clicks: number | null
    impressions: number | null
    surface_scope: string
    source_updated_at: string | null
  }> = []

  for (const raw of fetched.data) {
    const iso = parseWcfDate(raw.Date)
    if (!iso) continue
    const date = iso.slice(0, 10)
    const clicks      = raw.Clicks      != null ? Number(raw.Clicks)      : null
    const impressions = raw.Impressions != null ? Number(raw.Impressions) : null
    rows.push({
      date,
      clicks:      Number.isFinite(clicks as number)      ? clicks      : null,
      impressions: Number.isFinite(impressions as number) ? impressions : null,
      surface_scope: BING_SURFACE_SCOPE_COMBINED,
      source_updated_at: null,
    })
  }

  if (rows.length === 0) {
    return { status: 'ok', ...empty }
  }

  const table = `${ctx.projectId}.${BING_BQ_DATASET}.${BING_TABLES.siteDaily}`
  const result = await upsertRows(
    ctx, table,
    [{ name: 'date', type: 'DATE' }],
    [
      { name: 'clicks',            type: 'INT64'     },
      { name: 'impressions',       type: 'INT64'     },
      { name: 'surface_scope',     type: 'STRING'    },
      { name: 'source_updated_at', type: 'TIMESTAMP' },
    ],
    rows,
    ingestRunId,
  )

  if (!result.ok) {
    return {
      status: 'error',
      rows_seen: result.rows_seen,
      rows_inserted: 0, rows_updated: 0, distinct_dates: 0,
      first_date: null, last_date: null, bytes_billed: 0,
      api_attempts: fetched.attempts, api_latency_ms: fetched.latency_ms,
      error: result.error,
    }
  }

  const dates = rows.map(r => r.date).sort()
  return {
    status: 'ok',
    rows_seen: result.rows_seen,
    rows_inserted: result.rows_inserted,
    rows_updated: result.rows_updated,
    distinct_dates: new Set(dates).size,
    first_date: dates[0]!,
    last_date:  dates[dates.length - 1]!,
    bytes_billed: result.bytes_billed,
    api_attempts: fetched.attempts,
    api_latency_ms: fetched.latency_ms,
  }
}
