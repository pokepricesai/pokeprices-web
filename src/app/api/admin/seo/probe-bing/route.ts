// src/app/api/admin/seo/probe-bing/route.ts
// ============================================================================
// Stage 5A discovery · SECOND PASS — TEMPORARY diagnostic route.
//
// Runs a focused suite of READ-ONLY probes against the Bing Webmaster
// REST/JSON API and returns sanitised metadata. This route WILL BE
// DELETED once the Stage 5A report is complete.
//
// Sanitisation contract:
//   * API key redacted from every surfaced URL.
//   * AuthenticationCode / DnsVerificationCode / any *token/*secret*
//     field wholesale replaced with '[REDACTED]' via sanitiseSampleRow.
//   * https(?://)?(www\.)?pokeprices\.io in URL-shaped strings is
//     replaced with '<site>' — paths remain visible so a reader can
//     judge response semantics, but the exact host/scheme form is
//     never leaked in the sanitised output.
//
// Read-only guarantee: every probe method starts with Get* on the Bing
// IWebmasterApi surface. No Add/Remove/Submit/Save/Update/Verify/Fetch
// method is ever invoked from this route.
//
// Auth: Bearer $CRON_SECRET via isCronAuthOk. Response never contains
// headers, credentials, or the raw API key.
// ============================================================================

import 'server-only'
import { NextResponse } from 'next/server'
import { isCronAuthOk } from '@/lib/email/cronAuth'
import {
  probeOne, parseWcfDate, sanitiseUrl, sanitiseSampleRow,
  type BingProbe,
} from '@/lib/seo/bing/probeClient'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

const BING_JSON_BASE = 'https://ssl.bing.com/webmaster/api.svc/json'

// Redact the API key from any URL, and additionally strip our origins
// from anything URL-shaped, so notes / URL fields never leak raw
// canonicals.
function sanitiseString(s: string): string {
  return sanitiseUrl(s).replace(/https?:\/\/(?:www\.)?pokeprices\.io/gi, '<site>')
}
function ISO(d: string | Date | null | undefined): string | null {
  if (!d) return null
  if (typeof d === 'string') return d.slice(0, 10)
  return d.toISOString().slice(0, 10)
}
function weekdayOf(iso: string): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const d = new Date(iso + 'T00:00:00Z')
  return days[d.getUTCDay()] ?? '?'
}
function dayDiff(a: string, b: string): number {
  return Math.round((new Date(b + 'T00:00:00Z').getTime() - new Date(a + 'T00:00:00Z').getTime()) / 86_400_000)
}

async function fetchRows<T = Record<string, unknown>>(method: string, params: Record<string, unknown>, apiKey: string): Promise<T[] | null> {
  const qs = new URLSearchParams({ apikey: apiKey })
  for (const [k, v] of Object.entries(params)) {
    if (v != null) qs.set(k, String(v))
  }
  try {
    const res = await fetch(`${BING_JSON_BASE}/${method}?${qs.toString()}`, { headers: { accept: 'application/json' } })
    if (!res.ok) return null
    const json = await res.json() as { d?: unknown }
    if (Array.isArray(json.d)) return json.d as T[]
    return null
  } catch { return null }
}

/** Distinct ISO dates + gap analysis for a per-day stats response.
 *  Used to prove the weekly cadence of GetPageStats / GetQueryStats. */
function distinctDatesAnalysis(rows: Array<{ Date?: unknown }>): {
  distinct_dates: string[]
  weekdays: string[]
  gaps_days: number[]
  gap_summary: string
  first: string | null
  last: string | null
  span_days: number | null
} {
  const days = new Set<string>()
  for (const r of rows) {
    const iso = parseWcfDate(r.Date)
    if (iso) days.add(iso.slice(0, 10))
  }
  const distinct = Array.from(days).sort()
  const weekdays = distinct.map(weekdayOf)
  const gaps: number[] = []
  for (let i = 1; i < distinct.length; i++) gaps.push(dayDiff(distinct[i - 1], distinct[i]))
  const first = distinct[0] ?? null
  const last = distinct[distinct.length - 1] ?? null
  const span = (first && last) ? dayDiff(first, last) : null
  let summary = 'insufficient data'
  if (gaps.length > 0) {
    const min = Math.min(...gaps), max = Math.max(...gaps)
    const sum = gaps.reduce((s, g) => s + g, 0)
    const avg = sum / gaps.length
    summary = `${gaps.length} gap(s) · min=${min}d · max=${max}d · avg=${avg.toFixed(1)}d`
  }
  return { distinct_dates: distinct, weekdays, gaps_days: gaps, gap_summary: summary, first, last, span_days: span }
}

/** Given a row array with a Query field that holds either a page URL
 *  or a query string, return the value with highest Clicks. */
function topByClicks(rows: Array<{ Query?: unknown; Clicks?: unknown }>): string | null {
  const sorted = rows.slice().sort((a, b) => Number(b.Clicks ?? 0) - Number(a.Clicks ?? 0))
  const top = sorted[0]?.Query
  return typeof top === 'string' && top.length > 0 ? top : null
}

/** Convert a Bing-returned URL to its www canonical form so we can
 *  test whether GetUrlTrafficInfo recognises canonical variants. */
function toWwwCanonical(u: string): string {
  try {
    const parsed = new URL(u)
    parsed.protocol = 'https:'
    if (parsed.host === 'pokeprices.io') parsed.host = 'www.pokeprices.io'
    return parsed.toString()
  } catch { return u }
}

async function handle(req: Request) {
  const auth = isCronAuthOk(req)
  if (!auth.ok) {
    const status = auth.reason === 'missing_secret' ? 503 : 401
    return NextResponse.json({ error: 'unauthorised' }, { status })
  }
  const apiKey = (process.env.BING_WEBMASTER_API_KEY ?? '').trim()
  if (!apiKey) return NextResponse.json({ error: 'BING_WEBMASTER_API_KEY not set on this environment' }, { status: 503 })

  const started_at = new Date().toISOString()
  const probes: BingProbe[] = []
  const notes: string[] = []

  // ── PROPERTY DISCOVERY ─────────────────────────────────────────────
  const sitesProbe = await probeOne('users_sites', 'GetUserSites', {}, apiKey)
  probes.push(sitesProbe)

  const usersSitesRows = await fetchRows<{ Url?: string }>('GetUserSites', {}, apiKey)
  const siteUrlsSeen: string[] = []
  let matchedSiteUrl: string | null = null
  for (const row of usersSitesRows ?? []) {
    const raw = String(row?.Url ?? '').trim()
    if (!raw) continue
    // We record the *sanitised* form here — never the raw origin.
    siteUrlsSeen.push(sanitiseString(raw))
    if (/pokeprices/i.test(raw) && !matchedSiteUrl) matchedSiteUrl = raw
  }

  // ── SITE-LEVEL DAILY TRAFFIC ───────────────────────────────────────
  if (matchedSiteUrl) {
    const rankProbe = await probeOne('rank_and_traffic_stats', 'GetRankAndTrafficStats', { siteUrl: matchedSiteUrl }, apiKey)
    const rankRows = await fetchRows<{ Date?: unknown; Clicks?: number; Impressions?: number }>('GetRankAndTrafficStats', { siteUrl: matchedSiteUrl }, apiKey)
    if (rankRows) {
      const a = distinctDatesAnalysis(rankRows)
      const sumClicks = rankRows.reduce((s, r) => s + Number(r.Clicks ?? 0), 0)
      const sumImp    = rankRows.reduce((s, r) => s + Number(r.Impressions ?? 0), 0)
      rankProbe.notes.push(
        `distinct_dates=${a.distinct_dates.length}`,
        `date_range=${a.first}..${a.last}`,
        `span_days=${a.span_days}`,
        `gap_summary=${a.gap_summary}`,
        `sum_clicks=${sumClicks}`,
        `sum_impressions=${sumImp}`,
      )
    }
    probes.push(rankProbe)

    // ── WEEKLY-CADENCE PROOF: GetPageStats + GetQueryStats ──────────
    const pageStatsProbe = await probeOne('page_stats', 'GetPageStats', { siteUrl: matchedSiteUrl }, apiKey)
    const pageRows = await fetchRows<{ Date?: unknown; Query?: string; Clicks?: number; Impressions?: number; AvgClickPosition?: number; AvgImpressionPosition?: number }>('GetPageStats', { siteUrl: matchedSiteUrl }, apiKey)
    if (pageRows) {
      const a = distinctDatesAnalysis(pageRows)
      const pagesSet = new Set<string>()
      const rowsPerDate: Record<string, number> = {}
      let sumClicks = 0, sumImp = 0
      for (const r of pageRows) {
        if (r.Query) pagesSet.add(r.Query)
        const iso = parseWcfDate(r.Date)
        if (iso) {
          const d = iso.slice(0, 10)
          rowsPerDate[d] = (rowsPerDate[d] ?? 0) + 1
        }
        sumClicks += Number(r.Clicks ?? 0)
        sumImp += Number(r.Impressions ?? 0)
      }
      pageStatsProbe.notes.push(
        `distinct_dates=${a.distinct_dates.length}`,
        `distinct_dates_list=${a.distinct_dates.slice(0, 10).join(',')}${a.distinct_dates.length > 10 ? '...' : ''}`,
        `weekdays=${Array.from(new Set(a.weekdays)).join(',')}`,
        `gap_summary=${a.gap_summary}`,
        `rows_per_date_min=${Math.min(...Object.values(rowsPerDate))}`,
        `rows_per_date_max=${Math.max(...Object.values(rowsPerDate))}`,
        `distinct_pages_across_response=${pagesSet.size}`,
        `sum_clicks(response)=${sumClicks}`,
        `sum_impressions(response)=${sumImp}`,
        `note: 'Query' field holds page URL (Bing reuses QueryStats type for pages)`,
      )
    }
    probes.push(pageStatsProbe)

    const queryStatsProbe = await probeOne('query_stats', 'GetQueryStats', { siteUrl: matchedSiteUrl }, apiKey)
    const queryRows = await fetchRows<{ Date?: unknown; Query?: string; Clicks?: number; Impressions?: number }>('GetQueryStats', { siteUrl: matchedSiteUrl }, apiKey)
    if (queryRows) {
      const a = distinctDatesAnalysis(queryRows)
      const querySet = new Set<string>()
      const rowsPerDate: Record<string, number> = {}
      let sumClicks = 0, sumImp = 0
      for (const r of queryRows) {
        if (r.Query) querySet.add(r.Query)
        const iso = parseWcfDate(r.Date)
        if (iso) {
          const d = iso.slice(0, 10)
          rowsPerDate[d] = (rowsPerDate[d] ?? 0) + 1
        }
        sumClicks += Number(r.Clicks ?? 0)
        sumImp += Number(r.Impressions ?? 0)
      }
      queryStatsProbe.notes.push(
        `distinct_dates=${a.distinct_dates.length}`,
        `distinct_dates_list=${a.distinct_dates.slice(0, 10).join(',')}${a.distinct_dates.length > 10 ? '...' : ''}`,
        `weekdays=${Array.from(new Set(a.weekdays)).join(',')}`,
        `gap_summary=${a.gap_summary}`,
        `rows_per_date_min=${Math.min(...Object.values(rowsPerDate))}`,
        `rows_per_date_max=${Math.max(...Object.values(rowsPerDate))}`,
        `distinct_queries_across_response=${querySet.size}`,
        `sum_clicks(response)=${sumClicks}`,
        `sum_impressions(response)=${sumImp}`,
      )
    }
    probes.push(queryStatsProbe)

    // ── DERIVE TOP PAGE + TOP QUERY FROM PROBE-1 RESPONSES ───────────
    const topPageRaw = pageRows ? topByClicks(pageRows as any) : null
    const topPageWww = topPageRaw ? toWwwCanonical(topPageRaw) : null
    const topQuery = queryRows ? topByClicks(queryRows as any) : null

    if (topPageRaw) {
      notes.push(`top_page(sanitised) = ${sanitiseString(topPageRaw)}`)
      notes.push(`top_page_www(sanitised) = ${sanitiseString(topPageWww ?? '')}`)
    }
    if (topQuery) notes.push(`top_query = '${topQuery}'`)

    // ── CANONICAL URL TEST ───────────────────────────────────────────
    // 1. GetUrlTrafficInfo for https://www.pokeprices.io/  (www root)
    const wwwRoot = 'https://www.pokeprices.io/'
    const wwwRootProbe = await probeOne('url_traffic_info_www_root', 'GetUrlTrafficInfo', { siteUrl: matchedSiteUrl, url: wwwRoot }, apiKey)
    wwwRootProbe.notes.push(`probed_url = ${sanitiseString(wwwRoot)}`)
    probes.push(wwwRootProbe)

    // 2. GetUrlTrafficInfo for the top page — both raw and www form.
    if (topPageRaw) {
      const rawProbe = await probeOne('url_traffic_info_top_raw', 'GetUrlTrafficInfo', { siteUrl: matchedSiteUrl, url: topPageRaw }, apiKey)
      rawProbe.notes.push(`probed_url(shape) = ${sanitiseString(topPageRaw)}`)
      probes.push(rawProbe)
    }
    if (topPageWww && topPageWww !== topPageRaw) {
      const wwwProbe = await probeOne('url_traffic_info_top_www', 'GetUrlTrafficInfo', { siteUrl: matchedSiteUrl, url: topPageWww }, apiKey)
      wwwProbe.notes.push(`probed_url(shape) = ${sanitiseString(topPageWww)}`)
      probes.push(wwwProbe)
    }

    // ── DAILY QUERY TRAFFIC ──────────────────────────────────────────
    // GetQueryTrafficStats(siteUrl, query) — daily clicks/imp for one query.
    if (topQuery) {
      const qtProbe = await probeOne('query_traffic_stats', 'GetQueryTrafficStats', { siteUrl: matchedSiteUrl, query: topQuery }, apiKey)
      const qtRows = await fetchRows<{ Date?: unknown; Clicks?: number; Impressions?: number; AvgClickPosition?: number; AvgImpressionPosition?: number }>('GetQueryTrafficStats', { siteUrl: matchedSiteUrl, query: topQuery }, apiKey)
      if (qtRows) {
        const a = distinctDatesAnalysis(qtRows)
        const hasPos = qtRows.some(r => r.AvgClickPosition != null || r.AvgImpressionPosition != null)
        let sumClicks = 0, sumImp = 0
        for (const r of qtRows) { sumClicks += Number(r.Clicks ?? 0); sumImp += Number(r.Impressions ?? 0) }
        qtProbe.notes.push(
          `distinct_dates=${a.distinct_dates.length}`,
          `date_range=${a.first}..${a.last}`,
          `gap_summary=${a.gap_summary}`,
          `has_position_data=${hasPos}`,
          `sum_clicks=${sumClicks}`,
          `sum_impressions=${sumImp}`,
        )
      }
      probes.push(qtProbe)
    }

    // ── QUERY + PAGE DETAIL ─────────────────────────────────────────
    if (topQuery && topPageRaw) {
      const qpdProbe = await probeOne('query_page_detail_stats', 'GetQueryPageDetailStats', { siteUrl: matchedSiteUrl, query: topQuery, page: topPageRaw }, apiKey)
      const qpdRows = await fetchRows<{ Date?: unknown; Clicks?: number; Impressions?: number; AvgClickPosition?: number; AvgImpressionPosition?: number; Position?: number }>('GetQueryPageDetailStats', { siteUrl: matchedSiteUrl, query: topQuery, page: topPageRaw }, apiKey)
      if (qpdRows) {
        const a = distinctDatesAnalysis(qpdRows)
        const hasPos = qpdRows.some(r => r.Position != null || r.AvgClickPosition != null || r.AvgImpressionPosition != null)
        let sumClicks = 0, sumImp = 0
        for (const r of qpdRows) { sumClicks += Number(r.Clicks ?? 0); sumImp += Number(r.Impressions ?? 0) }
        qpdProbe.notes.push(
          `distinct_dates=${a.distinct_dates.length}`,
          `date_range=${a.first}..${a.last}`,
          `gap_summary=${a.gap_summary}`,
          `has_position_data=${hasPos}`,
          `sum_clicks=${sumClicks}`,
          `sum_impressions=${sumImp}`,
        )
      }
      probes.push(qpdProbe)
    }

    // ── KEYWORD HISTORICAL ──────────────────────────────────────────
    if (topQuery) {
      // GetKeywordStats(query, country, language) — 'gb' + 'en-GB' UK bias
      const kwProbe = await probeOne('keyword_stats', 'GetKeywordStats', { q: topQuery, country: 'gb', language: 'en-GB' }, apiKey)
      probes.push(kwProbe)
    }

    // ── TECHNICAL / INDEX HEALTH ────────────────────────────────────
    probes.push(await probeOne('crawl_stats',      'GetCrawlStats',   { siteUrl: matchedSiteUrl }, apiKey))
    probes.push(await probeOne('crawl_issues',     'GetCrawlIssues',  { siteUrl: matchedSiteUrl }, apiKey))
    probes.push(await probeOne('link_counts',      'GetLinkCounts',   { siteUrl: matchedSiteUrl }, apiKey))
    probes.push(await probeOne('url_info_matched_root', 'GetUrlInfo',   { siteUrl: matchedSiteUrl, url: matchedSiteUrl }, apiKey))
    probes.push(await probeOne('feeds',            'GetFeeds',        { siteUrl: matchedSiteUrl }, apiKey))
  } else {
    notes.push('Could not resolve pokeprices site from GetUserSites — all site probes skipped.')
  }

  // ── FINAL SANITISATION SWEEP ─────────────────────────────────────
  // Every probe's url_sanitised + notes get one more pass to catch
  // any string that slipped through.
  const finalProbes = probes.map(p => ({
    ...p,
    url_sanitised: sanitiseString(p.url_sanitised),
    notes: p.notes.map(sanitiseString),
    sample_row: p.sample_row ? sanitiseSampleRow(p.sample_row) : undefined,
    input: Object.fromEntries(
      Object.entries(p.input).map(([k, v]) => [k, typeof v === 'string' ? sanitiseString(v) : v]),
    ),
  }))

  return NextResponse.json({
    ok: true,
    started_at,
    finished_at: new Date().toISOString(),
    api_base: BING_JSON_BASE,
    auth_mode: 'apikey_query_param',
    key_length_only: apiKey.length,
    site_urls_seen: siteUrlsSeen,
    matched_site_url: matchedSiteUrl ? sanitiseString(matchedSiteUrl) : null,
    matched_site_url_scheme: matchedSiteUrl ? new URL(matchedSiteUrl).protocol : null,
    matched_site_url_host: matchedSiteUrl ? new URL(matchedSiteUrl).host : null,
    notes: notes.map(sanitiseString),
    probes: finalProbes,
  })
}

export async function GET(req: Request)  { return handle(req) }
export async function POST(req: Request) { return handle(req) }
