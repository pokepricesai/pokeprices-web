// src/lib/seo/bing/sources/feedSnapshots.ts
// ============================================================================
// GetFeeds → bing_feed_snapshots
//
// Grain: one row per (snapshot_date, feed_url).
//
// snapshot_date is the date this ingest ran (there is no per-feed date
// field in the API response; each call returns the current-state list).
//
// Raw feed URL is preserved. If the feed URL is a PokePrices URL under our
// canonicalisation rule, canonical_feed_url is populated; otherwise null.
// ============================================================================

import 'server-only'
import { bingFetch, parseWcfDate } from '../restClient'
import { canonicaliseUrl } from '../../canonicaliseUrl'
import type { BqContext } from '../../bqClient'
import { BING_BQ_DATASET, BING_TABLES } from '../bqSchema'
import { upsertRows } from '../bqMerge'

type ApiRow = {
  Url?: unknown
  FeedType?: unknown
  Status?: unknown
  UrlCount?: unknown
  FileSize?: unknown
  LastCrawled?: unknown
  Submitted?: unknown
  Compressed?: unknown
  [k: string]: unknown
}

export type FeedSnapshotResult = {
  status: 'ok' | 'error'
  rows_seen: number
  rows_inserted: number
  rows_updated: number
  snapshot_date: string
  distinct_feed_urls: number
  first_row_keys: string[]
  bytes_billed: number
  api_attempts: number
  api_latency_ms: number
  error?: string
}

export async function ingestFeedSnapshots(
  ctx: BqContext,
  apiKey: string,
  siteUrl: string,
  ingestRunId: string,
  snapshotDateOverride?: string,
): Promise<FeedSnapshotResult> {
  const snapshotDate = snapshotDateOverride ?? new Date().toISOString().slice(0, 10)
  const fetched = await bingFetch<ApiRow[]>('GetFeeds', { siteUrl }, apiKey)
  const empty = {
    rows_seen: 0, rows_inserted: 0, rows_updated: 0,
    snapshot_date: snapshotDate,
    distinct_feed_urls: 0, first_row_keys: [],
    bytes_billed: 0,
    api_attempts: fetched.attempts, api_latency_ms: fetched.latency_ms,
  }
  if (!fetched.ok) return { status: 'error', ...empty, error: fetched.error }
  if (!Array.isArray(fetched.data)) {
    return { status: 'error', ...empty, error: '`d` field is not an array' }
  }

  const firstRowKeys = fetched.data.length > 0 && typeof fetched.data[0] === 'object' && fetched.data[0] !== null
    ? Object.keys(fetched.data[0] as Record<string, unknown>)
    : []

  const rows: Array<{
    snapshot_date: string
    feed_url: string
    canonical_feed_url: string | null
    feed_type: string | null
    status: string | null
    url_count: number | null
    file_size: number | null
    last_crawled: string | null
    submitted: string | null
    compressed: boolean | null
  }> = []
  const seen = new Set<string>()

  for (const raw of fetched.data) {
    const feedUrl = typeof raw.Url === 'string' ? raw.Url : null
    if (!feedUrl) continue
    const key = `${snapshotDate}\x00${feedUrl}`
    if (seen.has(key)) continue
    seen.add(key)
    rows.push({
      snapshot_date: snapshotDate,
      feed_url: feedUrl,
      canonical_feed_url: canonicaliseUrl(feedUrl),
      feed_type: typeof raw.FeedType === 'string' ? raw.FeedType : null,
      status:    typeof raw.Status   === 'string' ? raw.Status   : null,
      url_count: numOrNull(raw.UrlCount),
      file_size: numOrNull(raw.FileSize),
      last_crawled: parseWcfDate(raw.LastCrawled),
      submitted:    parseWcfDate(raw.Submitted),
      compressed: typeof raw.Compressed === 'boolean' ? raw.Compressed : null,
    })
  }

  if (rows.length === 0) return { status: 'ok', ...empty, first_row_keys: firstRowKeys }

  const table = `${ctx.projectId}.${BING_BQ_DATASET}.${BING_TABLES.feedSnapshots}`
  const result = await upsertRows(
    ctx, table,
    [
      { name: 'snapshot_date', type: 'DATE'   },
      { name: 'feed_url',      type: 'STRING' },
    ],
    [
      { name: 'canonical_feed_url', type: 'STRING'    },
      { name: 'feed_type',          type: 'STRING'    },
      { name: 'status',             type: 'STRING'    },
      { name: 'url_count',          type: 'INT64'     },
      { name: 'file_size',          type: 'INT64'     },
      { name: 'last_crawled',       type: 'TIMESTAMP' },
      { name: 'submitted',          type: 'TIMESTAMP' },
      { name: 'compressed',         type: 'BOOL'      },
    ],
    rows,
    ingestRunId,
  )
  if (!result.ok) {
    return { status: 'error', ...empty, rows_seen: rows.length, first_row_keys: firstRowKeys, error: result.error }
  }

  return {
    status: 'ok',
    rows_seen: rows.length,
    rows_inserted: result.rows_inserted,
    rows_updated:  result.rows_updated,
    snapshot_date: snapshotDate,
    distinct_feed_urls: new Set(rows.map(r => r.feed_url)).size,
    first_row_keys: firstRowKeys,
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
