// src/lib/seo/bing/sources/pageWeekly.ts
// ============================================================================
// GetPageStats → bing_page_weekly
//
// Grain: one row per (snapshot_date, canonical_url). Idempotent MERGE.
//
// Data-semantic guards:
//   - Snapshots are PARTIAL/TOP-N. A page missing from a snapshot is NOT
//     zero — do not left-join and fill with 0.
//   - avg_click_position and avg_impression_position are pre-computed
//     averages returned by Bing. Store as-returned. Never re-average or
//     roll them up naively across days or the top-N.
//   - raw_url and canonical_url are BOTH persisted. canonical_url may be
//     null when a returned page is off-site or unparsable.
// ============================================================================

import 'server-only'
import { bingFetch, parseWcfDate } from '../restClient'
import { canonicaliseUrl } from '../../canonicaliseUrl'
import type { BqContext } from '../../bqClient'
import { BING_BQ_DATASET, BING_TABLES } from '../bqSchema'
import { upsertRows } from '../bqMerge'

type ApiRow = {
  Date?: unknown
  Page?: unknown              // Some responses use "Page"
  Query?: unknown
  Clicks?: unknown
  Impressions?: unknown
  AvgClickPosition?: unknown
  AvgImpressionPosition?: unknown
}

export type PageWeeklyResult = {
  status: 'ok' | 'error'
  rows_seen: number
  rows_inserted: number
  rows_updated: number
  distinct_snapshot_dates: number
  first_snapshot_date: string | null
  last_snapshot_date:  string | null
  distinct_canonical_urls: number
  distinct_raw_urls: number
  bytes_billed: number
  api_attempts: number
  api_latency_ms: number
  error?: string
}

export async function ingestPageWeekly(
  ctx: BqContext,
  apiKey: string,
  siteUrl: string,
  ingestRunId: string,
): Promise<PageWeeklyResult> {
  const fetched = await bingFetch<ApiRow[]>('GetPageStats', { siteUrl }, apiKey)
  const empty = {
    rows_seen: 0, rows_inserted: 0, rows_updated: 0,
    distinct_snapshot_dates: 0, first_snapshot_date: null, last_snapshot_date: null,
    distinct_canonical_urls: 0, distinct_raw_urls: 0,
    bytes_billed: 0,
    api_attempts: fetched.attempts, api_latency_ms: fetched.latency_ms,
  }
  if (!fetched.ok) return { status: 'error', ...empty, error: fetched.error }
  if (!Array.isArray(fetched.data)) {
    return { status: 'error', ...empty, error: '`d` field is not an array' }
  }

  type Row = {
    snapshot_date: string
    raw_url: string
    canonical_url: string | null
    clicks: number | null
    impressions: number | null
    avg_click_position: number | null
    avg_impression_position: number | null
  }
  const rows: Row[] = []
  const dupeGuard = new Set<string>()

  for (const raw of fetched.data) {
    const iso = parseWcfDate(raw.Date)
    if (!iso) continue
    const snapshot_date = iso.slice(0, 10)
    const rawUrl = typeof raw.Page === 'string' ? raw.Page : null
    if (!rawUrl) continue
    const canonical = canonicaliseUrl(rawUrl)
    const key = `${snapshot_date}${canonical ?? rawUrl}`
    if (dupeGuard.has(key)) continue
    dupeGuard.add(key)
    rows.push({
      snapshot_date,
      raw_url: rawUrl,
      canonical_url: canonical,
      clicks:      numOrNull(raw.Clicks),
      impressions: numOrNull(raw.Impressions),
      avg_click_position:      numOrNull(raw.AvgClickPosition),
      avg_impression_position: numOrNull(raw.AvgImpressionPosition),
    })
  }

  if (rows.length === 0) return { status: 'ok', ...empty }

  const table = `${ctx.projectId}.${BING_BQ_DATASET}.${BING_TABLES.pageWeekly}`
  // Logical key is (snapshot_date, canonical_url) per the spec. For rows
  // where canonical_url is null (off-site pages), fall back to raw_url
  // via COALESCE inside the MERGE by using canonical_url = COALESCE(...).
  // Simpler: split rows into two batches — canonicalisable + not — and
  // key each accordingly. Off-site pages are extremely rare for our
  // property (Bing returned only on-site pages in Stage 5A probes), so
  // the non-canonical path is defensive not primary.
  const canonRows = rows.filter(r => r.canonical_url != null)
  const rawOnlyRows = rows.filter(r => r.canonical_url == null)

  const valueFields = [
    { name: 'raw_url',                 type: 'STRING'  as const },
    { name: 'clicks',                  type: 'INT64'   as const },
    { name: 'impressions',             type: 'INT64'   as const },
    { name: 'avg_click_position',      type: 'FLOAT64' as const },
    { name: 'avg_impression_position', type: 'FLOAT64' as const },
  ]

  let inserted = 0, updated = 0, bytes = 0

  if (canonRows.length > 0) {
    const r = await upsertRows(
      ctx, table,
      [
        { name: 'snapshot_date', type: 'DATE'   },
        { name: 'canonical_url', type: 'STRING' },
      ],
      valueFields,
      canonRows.map(r => ({
        snapshot_date: r.snapshot_date,
        canonical_url: r.canonical_url,
        raw_url: r.raw_url,
        clicks: r.clicks,
        impressions: r.impressions,
        avg_click_position: r.avg_click_position,
        avg_impression_position: r.avg_impression_position,
      })),
      ingestRunId,
    )
    if (!r.ok) {
      return { status: 'error', ...empty, rows_seen: rows.length, error: r.error }
    }
    inserted += r.rows_inserted
    updated  += r.rows_updated
    bytes    += r.bytes_billed
  }

  // Off-site / unparsable pages: key on (snapshot_date, raw_url) with
  // canonical_url stored as NULL. Very unlikely for our property.
  if (rawOnlyRows.length > 0) {
    const r = await upsertRows(
      ctx, table,
      [
        { name: 'snapshot_date', type: 'DATE'   },
        { name: 'raw_url',       type: 'STRING' },
      ],
      [
        { name: 'canonical_url',           type: 'STRING'  },
        { name: 'clicks',                  type: 'INT64'   },
        { name: 'impressions',             type: 'INT64'   },
        { name: 'avg_click_position',      type: 'FLOAT64' },
        { name: 'avg_impression_position', type: 'FLOAT64' },
      ],
      rawOnlyRows.map(r => ({
        snapshot_date: r.snapshot_date,
        raw_url: r.raw_url,
        canonical_url: r.canonical_url,
        clicks: r.clicks,
        impressions: r.impressions,
        avg_click_position: r.avg_click_position,
        avg_impression_position: r.avg_impression_position,
      })),
      ingestRunId,
    )
    if (!r.ok) {
      return { status: 'error', ...empty, rows_seen: rows.length, error: r.error }
    }
    inserted += r.rows_inserted
    updated  += r.rows_updated
    bytes    += r.bytes_billed
  }

  const dates = rows.map(r => r.snapshot_date).sort()
  const distinctCanon = new Set(rows.map(r => r.canonical_url).filter((v): v is string => v != null))
  const distinctRaw   = new Set(rows.map(r => r.raw_url))

  return {
    status: 'ok',
    rows_seen: rows.length,
    rows_inserted: inserted,
    rows_updated:  updated,
    distinct_snapshot_dates: new Set(dates).size,
    first_snapshot_date: dates[0]!,
    last_snapshot_date:  dates[dates.length - 1]!,
    distinct_canonical_urls: distinctCanon.size,
    distinct_raw_urls: distinctRaw.size,
    bytes_billed: bytes,
    api_attempts: fetched.attempts,
    api_latency_ms: fetched.latency_ms,
  }
}

function numOrNull(v: unknown): number | null {
  if (v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
