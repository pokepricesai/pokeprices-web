// src/app/api/admin/seo/probe-bing-micro/route.ts
// ============================================================================
// Stage 5A · single-shot GetQueryPageDetailStats with the exact known-valid
// pair from pass 1. No discovery, no canonicalisation, no case changes.
//
//   siteUrl: https://pokeprices.io/
//   query:   pokemon chaos rising card list price
//   page:    https://www.pokeprices.io/set/Chaos%20Rising
//
// Read-only. Cron-secret gated. Deleted after Stage 5A report.
// ============================================================================

import 'server-only'
import { NextResponse } from 'next/server'
import { isCronAuthOk } from '@/lib/email/cronAuth'
import { parseWcfDate, sanitiseSampleRow } from '@/lib/seo/bing/probeClient'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

async function handle(req: Request) {
  const auth = isCronAuthOk(req)
  if (!auth.ok) {
    const status = auth.reason === 'missing_secret' ? 503 : 401
    return NextResponse.json({ error: 'unauthorised' }, { status })
  }

  const apiKey = process.env.BING_WEBMASTER_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'BING_WEBMASTER_API_KEY not configured' }, { status: 503 })
  }

  const siteUrl = 'https://pokeprices.io/'
  const query = 'pokemon chaos rising card list price'
  // Exact form as returned by pass-1 GetPageQueryStats — no rewrite.
  const page = 'https://www.pokeprices.io/set/Chaos%20Rising'

  const url = `https://ssl.bing.com/webmaster/api.svc/json/GetQueryPageDetailStats`
    + `?apikey=${encodeURIComponent(apiKey)}`
    + `&siteUrl=${encodeURIComponent(siteUrl)}`
    + `&query=${encodeURIComponent(query)}`
    + `&page=${encodeURIComponent(page)}`

  const started = performance.now()
  let status = 0
  let http_ok = false
  let error: string | undefined
  let bodyText = ''
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' } })
    status = res.status
    http_ok = res.ok
    bodyText = await res.text()
  } catch (e) {
    error = e instanceof Error ? e.message : 'unknown'
  }
  const duration_ms = Math.round(performance.now() - started)

  let row_count = 0
  let first_row_keys: string[] = []
  let distinct_dates: string[] = []
  let weekdays_seen: string[] = []
  let clicks_sum = 0
  let impressions_sum = 0
  let has_clicks = false
  let has_impressions = false
  let has_position = false
  let position_field_names: string[] = []
  let sample_row: Record<string, unknown> | undefined
  let parse_error: string | undefined

  if (http_ok && bodyText) {
    try {
      const json = JSON.parse(bodyText) as { d?: unknown }
      if (Array.isArray(json.d)) {
        const rows = json.d as Array<Record<string, unknown>>
        row_count = rows.length
        if (rows.length > 0) {
          first_row_keys = Object.keys(rows[0])
          position_field_names = first_row_keys.filter(k => /position|rank/i.test(k))
          has_position = position_field_names.length > 0
          has_clicks = first_row_keys.some(k => /^clicks?$/i.test(k))
          has_impressions = first_row_keys.some(k => /^impressions?$/i.test(k))
          const dateSet = new Set<string>()
          const weekdaySet = new Set<string>()
          for (const row of rows) {
            const iso = parseWcfDate(row.Date ?? row.date)
            if (iso) {
              const day = iso.slice(0, 10)
              dateSet.add(day)
              const dayName = new Date(day + 'T00:00:00Z').toUTCString().slice(0, 3)
              weekdaySet.add(dayName)
            }
            const c = Number(row.Clicks ?? row.clicks ?? 0)
            const i = Number(row.Impressions ?? row.impressions ?? 0)
            if (Number.isFinite(c)) clicks_sum += c
            if (Number.isFinite(i)) impressions_sum += i
          }
          distinct_dates = Array.from(dateSet).sort()
          weekdays_seen = Array.from(weekdaySet).sort()
          const raw = { ...rows[0] }
          for (const [k, v] of Object.entries(raw)) {
            const iso = parseWcfDate(v)
            if (iso) raw[k] = iso
          }
          sample_row = sanitiseSampleRow(raw)
        }
      } else {
        parse_error = 'no `d` array in response'
      }
    } catch (e) {
      parse_error = e instanceof Error ? e.message : 'unknown parse error'
    }
  } else if (!http_ok) {
    error = error ?? bodyText.slice(0, 300)
  }

  let gaps: number[] = []
  for (let i = 1; i < distinct_dates.length; i++) {
    const a = new Date(distinct_dates[i - 1] + 'T00:00:00Z').getTime()
    const b = new Date(distinct_dates[i] + 'T00:00:00Z').getTime()
    gaps.push(Math.round((b - a) / 86400000))
  }
  const gap_summary = gaps.length
    ? { min: Math.min(...gaps), max: Math.max(...gaps), avg: Number((gaps.reduce((s, x) => s + x, 0) / gaps.length).toFixed(2)) }
    : null

  return NextResponse.json({
    micro_check: 'GetQueryPageDetailStats · exact known-valid pair from pass 1',
    input: {
      siteUrl,
      query,
      // Show the exact page shape (no rewrite) but with our origin
      // collapsed for the response payload.
      page_sanitised: page.replace(/https?:\/\/(?:www\.)?pokeprices\.io/gi, '<site>'),
    },
    http_status: status,
    duration_ms,
    row_count,
    first_row_keys,
    distinct_dates,
    distinct_dates_count: distinct_dates.length,
    distinct_dates_first: distinct_dates[0] ?? null,
    distinct_dates_last: distinct_dates[distinct_dates.length - 1] ?? null,
    weekdays_seen,
    gap_summary,
    has_clicks,
    has_impressions,
    clicks_sum,
    impressions_sum,
    has_position,
    position_field_names,
    sample_row,
    error,
    parse_error,
  }, { status: 200 })
}

export async function GET(req: Request)  { return handle(req) }
export async function POST(req: Request) { return handle(req) }
