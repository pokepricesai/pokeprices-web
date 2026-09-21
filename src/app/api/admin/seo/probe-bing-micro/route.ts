// src/app/api/admin/seo/probe-bing-micro/route.ts
// ============================================================================
// Stage 5A · single-shot micro-check for GetQueryPageDetailStats.
//
// One probe only, using the validated pair discovered in pass 1:
//   query = "pokemon chaos rising card list price"
//   page  = the Chaos Rising page from GetPageQueryStats (Bing-returned form)
//
// Cron-secret gated. Read-only. Deleted after Stage 5A report is done.
// ============================================================================

import 'server-only'
import { NextResponse } from 'next/server'
import { isCronAuthOk } from '@/lib/email/cronAuth'
import { probeOne, parseWcfDate, sanitiseSampleRow } from '@/lib/seo/bing/probeClient'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const BING_SITE_URL_HOSTS = ['https://pokeprices.io/', 'https://www.pokeprices.io/']

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

  // Find the Chaos Rising page from GetPageQueryStats to get the exact
  // Bing-returned URL form. We probe the property under both host variants
  // (Bing property is https://pokeprices.io/ non-www; per pass 1 the API
  // accepts both).
  const query = 'pokemon chaos rising card list price'
  const chaosRisingPathHints = ['chaos-rising', 'chaos%20rising', 'chaos+rising']

  // First: fetch GetPageQueryStats for our siteUrl so we can find the
  // exact page URL Bing returned in pass 1. We use the SAME siteUrl the
  // pass-1 probe found rows on.
  const siteUrl = BING_SITE_URL_HOSTS[0]
  const pqs = await probeOne(
    'page_query_stats_for_lookup',
    'GetPageQueryStats',
    { siteUrl },
    apiKey,
    { timeoutMs: 20_000 },
  )

  // Bing PageQueryStats returns { Page, Queries: [ { Query, Clicks, ... } ] }
  // — but the SHAPE of the response can vary. We need to enumerate the
  // full response body ourselves for the URL selection step; probeOne
  // only returns the first row. So do one raw fetch too.
  let chaosPageUrl: string | null = null
  let chaosPageMatchedField: string | null = null
  let pqsRawTopPages: string[] = []
  try {
    const url = `https://ssl.bing.com/webmaster/api.svc/json/GetPageQueryStats?apikey=${encodeURIComponent(apiKey)}&siteUrl=${encodeURIComponent(siteUrl)}`
    const res = await fetch(url, { headers: { accept: 'application/json' } })
    if (res.ok) {
      const json = await res.json() as { d?: unknown }
      const rows = Array.isArray(json.d) ? json.d as Array<Record<string, unknown>> : []
      // Look for a row where Page/Url contains "chaos-rising".
      for (const row of rows) {
        const candidateFields = ['Page', 'Url', 'PageUrl']
        for (const f of candidateFields) {
          const v = row[f]
          if (typeof v === 'string') {
            pqsRawTopPages.push(v)
            const lower = v.toLowerCase()
            if (chaosRisingPathHints.some(h => lower.includes(h))) {
              chaosPageUrl = v
              chaosPageMatchedField = f
              break
            }
          }
        }
        if (chaosPageUrl) break
      }
      // Deduplicate + limit the raw-top-pages list for the sanitised report.
      pqsRawTopPages = Array.from(new Set(pqsRawTopPages)).slice(0, 8)
    }
  } catch {
    // fall through
  }

  // Sanitise the top-pages list before it goes into the response.
  const pqsRawTopPagesSan = pqsRawTopPages.map(u =>
    u.replace(/https?:\/\/(?:www\.)?pokeprices\.io/gi, '<site>'),
  )

  const notes: string[] = []
  if (!chaosPageUrl) {
    notes.push('Could not locate Chaos Rising page in GetPageQueryStats — falling back to canonical guess.')
  }

  // Fallback: canonical set-detail URL for Chaos Rising on our site.
  const fallbackPage = 'https://www.pokeprices.io/set/chaos-rising'
  const pagesToTry: Array<{ label: string; page: string }> = []
  if (chaosPageUrl) {
    pagesToTry.push({ label: 'discovered_from_page_query_stats', page: chaosPageUrl })
  }
  pagesToTry.push({ label: 'canonical_set_detail_www', page: fallbackPage })

  // Run the actual micro-check(s).
  const detailProbes: Array<Record<string, unknown>> = []
  for (const { label, page } of pagesToTry) {
    // Try both http verbs / both site url forms just to be thorough.
    for (const site of BING_SITE_URL_HOSTS) {
      const probe = await probeOne(
        `query_page_detail_${label}_${site.includes('www') ? 'www' : 'apex'}`,
        'GetQueryPageDetailStats',
        { siteUrl: site, query, page },
        apiKey,
        { timeoutMs: 20_000 },
      )

      // Also do a raw fetch so we can compute distinct-dates cadence
      // ourselves without relying on probeOne's single-row sample.
      let distinct_dates: string[] = []
      let weekdays: string[] = []
      let has_clicks = false, has_impressions = false, has_position = false
      let position_field_names: string[] = []
      let clicks_sum = 0
      let impressions_sum = 0
      let row_count = 0
      let first_row_keys: string[] = probe.first_row_keys ?? []
      let error: string | undefined
      try {
        const url = `https://ssl.bing.com/webmaster/api.svc/json/GetQueryPageDetailStats?apikey=${encodeURIComponent(apiKey)}&siteUrl=${encodeURIComponent(site)}&query=${encodeURIComponent(query)}&page=${encodeURIComponent(page)}`
        const res = await fetch(url, { headers: { accept: 'application/json' } })
        if (!res.ok) {
          error = `HTTP ${res.status}`
        } else {
          const json = await res.json() as { d?: unknown }
          if (Array.isArray(json.d)) {
            const rows = json.d as Array<Record<string, unknown>>
            row_count = rows.length
            if (rows.length > 0) {
              first_row_keys = Object.keys(rows[0])
              // Look for position-like fields.
              position_field_names = first_row_keys.filter(k =>
                /position|rank/i.test(k),
              )
              has_position = position_field_names.length > 0
              has_clicks = first_row_keys.some(k => /^clicks?$/i.test(k))
              has_impressions = first_row_keys.some(k => /^impressions?$/i.test(k))
              // Extract dates + sums.
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
              weekdays = Array.from(weekdaySet).sort()
            }
          }
        }
      } catch (e) {
        error = e instanceof Error ? e.message : 'unknown'
      }

      const min = distinct_dates[0] ?? null
      const max = distinct_dates[distinct_dates.length - 1] ?? null
      let gaps: number[] = []
      for (let i = 1; i < distinct_dates.length; i++) {
        const a = new Date(distinct_dates[i - 1] + 'T00:00:00Z').getTime()
        const b = new Date(distinct_dates[i] + 'T00:00:00Z').getTime()
        gaps.push(Math.round((b - a) / 86400000))
      }
      const gap_summary = gaps.length
        ? { min: Math.min(...gaps), max: Math.max(...gaps), avg: Number((gaps.reduce((s, x) => s + x, 0) / gaps.length).toFixed(2)) }
        : null

      const sample_row = probe.sample_row ? sanitiseSampleRow(probe.sample_row) : undefined

      detailProbes.push({
        label,
        page_used: page.replace(/https?:\/\/(?:www\.)?pokeprices\.io/gi, '<site>'),
        site_url_variant: site,
        http_status: probe.status,
        row_count,
        first_row_keys,
        distinct_dates_count: distinct_dates.length,
        distinct_dates_first: min,
        distinct_dates_last: max,
        weekdays_seen: weekdays,
        gap_summary,
        clicks_sum,
        impressions_sum,
        has_clicks,
        has_impressions,
        has_position,
        position_field_names,
        sample_row,
        error,
      })
    }
  }

  return NextResponse.json({
    micro_check: 'GetQueryPageDetailStats · validated pair',
    query,
    page_source: 'GetPageQueryStats + canonical fallback',
    chaos_page_url_found: chaosPageUrl != null,
    chaos_page_matched_field: chaosPageMatchedField,
    page_query_stats_top_pages_sanitised: pqsRawTopPagesSan,
    notes,
    probes: detailProbes,
  }, { status: 200 })
}

export async function GET(req: Request)  { return handle(req) }
export async function POST(req: Request) { return handle(req) }
