// src/lib/seo/bing/sources/crawlDaily.ts
// ============================================================================
// GetCrawlStats → bing_crawl_daily
//
// Grain: one row per date. Idempotent MERGE on `date`.
//
// Field names preserve Bing API semantics as-returned. Do not rename any
// field into an interpretation we have not verified from the official docs.
// ============================================================================

import 'server-only'
import { bingFetch, parseWcfDate } from '../restClient'
import type { BqContext } from '../../bqClient'
import { BING_BQ_DATASET, BING_TABLES } from '../bqSchema'
import { upsertRows } from '../bqMerge'

type ApiRow = {
  Date?: unknown
  CrawledPages?: unknown
  CrawlErrors?: unknown
  HttpCode2xx?: unknown
  HttpCode301?: unknown
  HttpCode302?: unknown
  HttpCode4xx?: unknown
  HttpCode5xx?: unknown
  BlockedByRobotsTxt?: unknown
  ConnectionTimeout?: unknown
  DnsFailures?: unknown
  ContainsMalware?: unknown
  AllOtherCodes?: unknown
  InIndex?: unknown
  InLinks?: unknown
  // Some responses may use unexpected variants — capture everything we
  // don't recognise into `all_other_codes` conservatively.
  [k: string]: unknown
}

export type CrawlDailyResult = {
  status: 'ok' | 'error'
  rows_seen: number
  rows_inserted: number
  rows_updated: number
  distinct_dates: number
  first_date: string | null
  last_date:  string | null
  first_row_keys: string[]
  bytes_billed: number
  api_attempts: number
  api_latency_ms: number
  error?: string
}

export async function ingestCrawlDaily(
  ctx: BqContext,
  apiKey: string,
  siteUrl: string,
  ingestRunId: string,
): Promise<CrawlDailyResult> {
  const fetched = await bingFetch<ApiRow[]>('GetCrawlStats', { siteUrl }, apiKey)
  const empty = {
    rows_seen: 0, rows_inserted: 0, rows_updated: 0, distinct_dates: 0,
    first_date: null, last_date: null, first_row_keys: [],
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
    date: string
    crawled_pages: number | null
    crawl_errors: number | null
    code_2xx: number | null
    code_301: number | null
    code_302: number | null
    code_4xx: number | null
    code_5xx: number | null
    blocked_by_robots_txt: number | null
    connection_timeout: number | null
    dns_failures: number | null
    contains_malware: number | null
    all_other_codes: number | null
    in_index: number | null
    in_links: number | null
  }> = []
  const dupe = new Set<string>()

  for (const raw of fetched.data) {
    const iso = parseWcfDate(raw.Date)
    if (!iso) continue
    const date = iso.slice(0, 10)
    if (dupe.has(date)) continue
    dupe.add(date)
    rows.push({
      date,
      crawled_pages:         numOrNull(raw.CrawledPages),
      crawl_errors:          numOrNull(raw.CrawlErrors),
      code_2xx:              numOrNull(raw.HttpCode2xx),
      code_301:              numOrNull(raw.HttpCode301),
      code_302:              numOrNull(raw.HttpCode302),
      code_4xx:              numOrNull(raw.HttpCode4xx),
      code_5xx:              numOrNull(raw.HttpCode5xx),
      blocked_by_robots_txt: numOrNull(raw.BlockedByRobotsTxt),
      connection_timeout:    numOrNull(raw.ConnectionTimeout),
      dns_failures:          numOrNull(raw.DnsFailures),
      contains_malware:      numOrNull(raw.ContainsMalware),
      all_other_codes:       numOrNull(raw.AllOtherCodes),
      in_index:              numOrNull(raw.InIndex),
      in_links:              numOrNull(raw.InLinks),
    })
  }

  if (rows.length === 0) return { status: 'ok', ...empty, first_row_keys: firstRowKeys }

  const table = `${ctx.projectId}.${BING_BQ_DATASET}.${BING_TABLES.crawlDaily}`
  const result = await upsertRows(
    ctx, table,
    [{ name: 'date', type: 'DATE' }],
    [
      { name: 'crawled_pages',         type: 'INT64' },
      { name: 'crawl_errors',          type: 'INT64' },
      { name: 'code_2xx',              type: 'INT64' },
      { name: 'code_301',              type: 'INT64' },
      { name: 'code_302',              type: 'INT64' },
      { name: 'code_4xx',              type: 'INT64' },
      { name: 'code_5xx',              type: 'INT64' },
      { name: 'blocked_by_robots_txt', type: 'INT64' },
      { name: 'connection_timeout',    type: 'INT64' },
      { name: 'dns_failures',          type: 'INT64' },
      { name: 'contains_malware',      type: 'INT64' },
      { name: 'all_other_codes',       type: 'INT64' },
      { name: 'in_index',              type: 'INT64' },
      { name: 'in_links',              type: 'INT64' },
    ],
    rows,
    ingestRunId,
  )
  if (!result.ok) {
    return { status: 'error', ...empty, rows_seen: rows.length, first_row_keys: firstRowKeys, error: result.error }
  }

  const dates = rows.map(r => r.date).sort()
  return {
    status: 'ok',
    rows_seen: rows.length,
    rows_inserted: result.rows_inserted,
    rows_updated:  result.rows_updated,
    distinct_dates: new Set(dates).size,
    first_date: dates[0]!,
    last_date:  dates[dates.length - 1]!,
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
