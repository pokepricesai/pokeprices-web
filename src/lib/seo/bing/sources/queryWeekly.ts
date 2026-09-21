// src/lib/seo/bing/sources/queryWeekly.ts
// ============================================================================
// GetQueryStats → bing_query_weekly
//
// Grain: one row per (snapshot_date, query). Idempotent MERGE.
//
// Same partial/top-N warning as bing_page_weekly. Avg position fields are
// pre-computed averages — never re-average.
// ============================================================================

import 'server-only'
import { bingFetch, parseWcfDate } from '../restClient'
import type { BqContext } from '../../bqClient'
import { BING_BQ_DATASET, BING_TABLES } from '../bqSchema'
import { upsertRows } from '../bqMerge'

type ApiRow = {
  Date?: unknown
  Query?: unknown
  Clicks?: unknown
  Impressions?: unknown
  AvgClickPosition?: unknown
  AvgImpressionPosition?: unknown
}

export type QueryWeeklyResult = {
  status: 'ok' | 'error'
  rows_seen: number
  rows_inserted: number
  rows_updated: number
  distinct_snapshot_dates: number
  first_snapshot_date: string | null
  last_snapshot_date:  string | null
  distinct_queries: number
  bytes_billed: number
  api_attempts: number
  api_latency_ms: number
  error?: string
}

export async function ingestQueryWeekly(
  ctx: BqContext,
  apiKey: string,
  siteUrl: string,
  ingestRunId: string,
): Promise<QueryWeeklyResult> {
  const fetched = await bingFetch<ApiRow[]>('GetQueryStats', { siteUrl }, apiKey)
  const empty = {
    rows_seen: 0, rows_inserted: 0, rows_updated: 0,
    distinct_snapshot_dates: 0, first_snapshot_date: null, last_snapshot_date: null,
    distinct_queries: 0, bytes_billed: 0,
    api_attempts: fetched.attempts, api_latency_ms: fetched.latency_ms,
  }
  if (!fetched.ok) return { status: 'error', ...empty, error: fetched.error }
  if (!Array.isArray(fetched.data)) {
    return { status: 'error', ...empty, error: '`d` field is not an array' }
  }

  const rows: Array<{
    snapshot_date: string
    query: string
    clicks: number | null
    impressions: number | null
    avg_click_position: number | null
    avg_impression_position: number | null
  }> = []
  const seen = new Set<string>()

  for (const raw of fetched.data) {
    const iso = parseWcfDate(raw.Date)
    if (!iso) continue
    const snapshot_date = iso.slice(0, 10)
    const q = typeof raw.Query === 'string' ? raw.Query : null
    if (!q) continue
    const key = `${snapshot_date}\x00${q}`
    if (seen.has(key)) continue
    seen.add(key)
    rows.push({
      snapshot_date,
      query: q,
      clicks:      numOrNull(raw.Clicks),
      impressions: numOrNull(raw.Impressions),
      avg_click_position:      numOrNull(raw.AvgClickPosition),
      avg_impression_position: numOrNull(raw.AvgImpressionPosition),
    })
  }

  if (rows.length === 0) return { status: 'ok', ...empty }

  const table = `${ctx.projectId}.${BING_BQ_DATASET}.${BING_TABLES.queryWeekly}`
  const result = await upsertRows(
    ctx, table,
    [
      { name: 'snapshot_date', type: 'DATE'   },
      { name: 'query',         type: 'STRING' },
    ],
    [
      { name: 'clicks',                  type: 'INT64'   },
      { name: 'impressions',             type: 'INT64'   },
      { name: 'avg_click_position',      type: 'FLOAT64' },
      { name: 'avg_impression_position', type: 'FLOAT64' },
    ],
    rows,
    ingestRunId,
  )
  if (!result.ok) {
    return { status: 'error', ...empty, rows_seen: rows.length, error: result.error }
  }

  const dates = rows.map(r => r.snapshot_date).sort()
  return {
    status: 'ok',
    rows_seen: rows.length,
    rows_inserted: result.rows_inserted,
    rows_updated:  result.rows_updated,
    distinct_snapshot_dates: new Set(dates).size,
    first_snapshot_date: dates[0]!,
    last_snapshot_date:  dates[dates.length - 1]!,
    distinct_queries: new Set(rows.map(r => r.query)).size,
    bytes_billed: result.bytes_billed,
    api_attempts: fetched.attempts,
    api_latency_ms: fetched.latency_ms,
  }
}

function numOrNull(v: unknown): number | null {
  if (v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
