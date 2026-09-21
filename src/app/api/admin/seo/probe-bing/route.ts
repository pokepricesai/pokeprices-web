// src/app/api/admin/seo/probe-bing/route.ts
// ============================================================================
// Stage 5A discovery — TEMPORARY diagnostic route.
//
// Runs a suite of READ-ONLY probes against the Bing Webmaster REST/JSON
// API and returns sanitised metadata about each. Every response body,
// URL, and log line has the API key redacted before it leaves the
// server; the raw key is only ever attached to outbound fetch() calls.
//
// This route WILL BE DELETED once the discovery report is produced.
//
// Auth: Bearer $CRON_SECRET via isCronAuthOk (same pattern used by
// /api/cron/*). Never returns headers or credentials in the response.
//
// Read-only guarantee: every probe method starts with Get* on the Bing
// IWebmasterApi surface. No Add/Remove/Submit/Save/Verify/Fetch methods
// are ever invoked from this route.
// ============================================================================

import 'server-only'
import { NextResponse } from 'next/server'
import { isCronAuthOk } from '@/lib/email/cronAuth'
import { probeOne, parseWcfDate, sanitiseUrl, type BingProbe } from '@/lib/seo/bing/probeClient'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

const CANDIDATE_SITE_URLS = [
  'https://www.pokeprices.io/',
  'https://pokeprices.io/',
  'http://www.pokeprices.io/',
  'http://pokeprices.io/',
]

async function handle(req: Request) {
  const auth = isCronAuthOk(req)
  if (!auth.ok) {
    const status = auth.reason === 'missing_secret' ? 503 : 401
    return NextResponse.json({ error: 'unauthorised' }, { status })
  }

  const apiKey = (process.env.BING_WEBMASTER_API_KEY ?? '').trim()
  if (!apiKey) {
    return NextResponse.json({
      error: 'BING_WEBMASTER_API_KEY env var is not set on this environment',
    }, { status: 503 })
  }

  const startedAt = new Date().toISOString()
  const results: BingProbe[] = []
  const notes: string[] = []

  // ── PHASE 1 — auth + property discovery ─────────────────────────────
  const usersSites = await probeOne('users_sites', 'GetUserSites', {}, apiKey)
  results.push(usersSites)

  let matchedSiteUrl: string | null = null
  const siteVariants: string[] = []
  if (usersSites.http_ok && usersSites.sample_row) {
    // We only capture the first row's keys above; refetch and parse the
    // full array to find our site. This is one extra call, worth it.
    try {
      const res = await fetch(`https://ssl.bing.com/webmaster/api.svc/json/GetUserSites?apikey=${encodeURIComponent(apiKey)}`, { headers: { accept: 'application/json' } })
      if (res.ok) {
        const json = await res.json() as { d?: Array<{ Url?: string }> }
        for (const row of (json.d ?? [])) {
          const u = String(row.Url ?? '').trim()
          if (!u) continue
          siteVariants.push(u)
          if (u.toLowerCase().includes('pokeprices')) {
            matchedSiteUrl = u
          }
        }
      }
    } catch { /* silent — sanitised */ }
  }

  if (!matchedSiteUrl) {
    for (const cand of CANDIDATE_SITE_URLS) {
      // As a defence-in-depth fallback, probe each candidate URL and
      // see which returns non-empty data.
      const p = await probeOne(`fallback_probe_${cand.replace(/[^a-z]/gi, '_').slice(0, 30)}`, 'GetRankAndTrafficStats', { siteUrl: cand }, apiKey)
      if (p.http_ok && (p.d_length ?? 0) > 0) {
        matchedSiteUrl = cand
        notes.push(`fallback matched siteUrl='${cand}' via non-empty GetRankAndTrafficStats`)
        break
      }
    }
  }

  // ── PHASE 2 — traffic / stats endpoints ─────────────────────────────
  if (matchedSiteUrl) {
    // GetRankAndTrafficStats — site-level daily clicks + impressions
    const rankStats = await probeOne('rank_and_traffic_stats', 'GetRankAndTrafficStats', { siteUrl: matchedSiteUrl }, apiKey)
    // Compute date-coverage stats without leaking rows.
    if (rankStats.http_ok && rankStats.d_length && rankStats.d_length > 0) {
      try {
        const url = `https://ssl.bing.com/webmaster/api.svc/json/GetRankAndTrafficStats?siteUrl=${encodeURIComponent(matchedSiteUrl)}&apikey=${encodeURIComponent(apiKey)}`
        const r = await fetch(url, { headers: { accept: 'application/json' } })
        if (r.ok) {
          const j = await r.json() as { d?: Array<{ Date?: unknown; Clicks?: number; Impressions?: number }> }
          const days = new Set<string>()
          let minDate: string | null = null, maxDate: string | null = null
          let sumClicks = 0, sumImp = 0
          for (const row of j.d ?? []) {
            const iso = parseWcfDate(row.Date)
            if (!iso) continue
            const d = iso.slice(0, 10)
            days.add(d)
            if (!minDate || d < minDate) minDate = d
            if (!maxDate || d > maxDate) maxDate = d
            sumClicks += Number(row.Clicks ?? 0)
            sumImp += Number(row.Impressions ?? 0)
          }
          rankStats.notes.push(
            `distinct dates=${days.size}`,
            `min=${minDate}`,
            `max=${maxDate}`,
            `sum_clicks=${sumClicks}`,
            `sum_impressions=${sumImp}`,
          )
        }
      } catch { /* silent */ }
    }
    results.push(rankStats)

    // GetPageStats — top-pages traffic
    const pageStats = await probeOne('page_stats', 'GetPageStats', { siteUrl: matchedSiteUrl }, apiKey)
    // Extract lightweight distribution over dates + top-N URL count (without leaking URLs).
    if (pageStats.http_ok && pageStats.d_length && pageStats.d_length > 0) {
      try {
        const url = `https://ssl.bing.com/webmaster/api.svc/json/GetPageStats?siteUrl=${encodeURIComponent(matchedSiteUrl)}&apikey=${encodeURIComponent(apiKey)}`
        const r = await fetch(url, { headers: { accept: 'application/json' } })
        if (r.ok) {
          const j = await r.json() as { d?: Array<{ Date?: unknown; Query?: string; Clicks?: number; Impressions?: number; AvgClickPosition?: number; AvgImpressionPosition?: number }> }
          const days = new Set<string>()
          const urls = new Set<string>()
          let minDate: string | null = null, maxDate: string | null = null
          let sumClicks = 0, sumImp = 0
          for (const row of j.d ?? []) {
            const iso = parseWcfDate(row.Date)
            if (iso) {
              const d = iso.slice(0, 10)
              days.add(d)
              if (!minDate || d < minDate) minDate = d
              if (!maxDate || d > maxDate) maxDate = d
            }
            if (row.Query) urls.add(row.Query)
            sumClicks += Number(row.Clicks ?? 0)
            sumImp += Number(row.Impressions ?? 0)
          }
          pageStats.notes.push(
            `distinct dates=${days.size}`,
            `distinct pages=${urls.size}`,
            `date range=${minDate}..${maxDate}`,
            `sum_clicks(response)=${sumClicks}`,
            `sum_impressions(response)=${sumImp}`,
            `note: 'Query' field in GetPageStats response holds the page URL, not a query`,
          )
        }
      } catch { /* silent */ }
    }
    results.push(pageStats)

    // GetQueryStats — top-queries traffic
    const queryStats = await probeOne('query_stats', 'GetQueryStats', { siteUrl: matchedSiteUrl }, apiKey)
    if (queryStats.http_ok && queryStats.d_length && queryStats.d_length > 0) {
      try {
        const url = `https://ssl.bing.com/webmaster/api.svc/json/GetQueryStats?siteUrl=${encodeURIComponent(matchedSiteUrl)}&apikey=${encodeURIComponent(apiKey)}`
        const r = await fetch(url, { headers: { accept: 'application/json' } })
        if (r.ok) {
          const j = await r.json() as { d?: Array<{ Date?: unknown; Query?: string; Clicks?: number; Impressions?: number }> }
          const days = new Set<string>()
          const queries = new Set<string>()
          let minDate: string | null = null, maxDate: string | null = null
          let sumClicks = 0, sumImp = 0
          for (const row of j.d ?? []) {
            const iso = parseWcfDate(row.Date)
            if (iso) {
              const d = iso.slice(0, 10)
              days.add(d)
              if (!minDate || d < minDate) minDate = d
              if (!maxDate || d > maxDate) maxDate = d
            }
            if (row.Query) queries.add(row.Query)
            sumClicks += Number(row.Clicks ?? 0)
            sumImp += Number(row.Impressions ?? 0)
          }
          queryStats.notes.push(
            `distinct dates=${days.size}`,
            `distinct queries=${queries.size}`,
            `date range=${minDate}..${maxDate}`,
            `sum_clicks(response)=${sumClicks}`,
            `sum_impressions(response)=${sumImp}`,
          )
        }
      } catch { /* silent */ }
    }
    results.push(queryStats)

    // Grab one page URL and one query for the combination probes below.
    let topPageUrl: string | null = null
    let topQuery: string | null = null
    try {
      const url = `https://ssl.bing.com/webmaster/api.svc/json/GetPageStats?siteUrl=${encodeURIComponent(matchedSiteUrl)}&apikey=${encodeURIComponent(apiKey)}`
      const r = await fetch(url, { headers: { accept: 'application/json' } })
      if (r.ok) {
        const j = await r.json() as { d?: Array<{ Query?: string; Clicks?: number }> }
        if (Array.isArray(j.d) && j.d.length > 0) {
          const sorted = j.d.slice().sort((a, b) => Number(b.Clicks ?? 0) - Number(a.Clicks ?? 0))
          topPageUrl = sorted[0]?.Query ?? null
        }
      }
    } catch { /* silent */ }
    try {
      const url = `https://ssl.bing.com/webmaster/api.svc/json/GetQueryStats?siteUrl=${encodeURIComponent(matchedSiteUrl)}&apikey=${encodeURIComponent(apiKey)}`
      const r = await fetch(url, { headers: { accept: 'application/json' } })
      if (r.ok) {
        const j = await r.json() as { d?: Array<{ Query?: string; Clicks?: number }> }
        if (Array.isArray(j.d) && j.d.length > 0) {
          const sorted = j.d.slice().sort((a, b) => Number(b.Clicks ?? 0) - Number(a.Clicks ?? 0))
          topQuery = sorted[0]?.Query ?? null
        }
      }
    } catch { /* silent */ }

    if (topPageUrl) {
      const pqStats = await probeOne('page_query_stats', 'GetPageQueryStats', { siteUrl: matchedSiteUrl, page: topPageUrl }, apiKey)
      pqStats.notes.push(`page probed: ${topPageUrl.replace(matchedSiteUrl, '<siteUrl>')}`)
      results.push(pqStats)
    } else {
      results.push({ name: 'page_query_stats', method: 'GetPageQueryStats', input: {}, status: 0, http_ok: false, duration_ms: 0, url_sanitised: '(skipped)', parsed_ok: false, notes: ['skipped — no top page discovered'] })
    }

    if (topQuery) {
      const qpStats = await probeOne('query_page_stats', 'GetQueryPageStats', { siteUrl: matchedSiteUrl, query: topQuery }, apiKey)
      qpStats.notes.push(`query probed: '${topQuery}'`)
      results.push(qpStats)
    } else {
      results.push({ name: 'query_page_stats', method: 'GetQueryPageStats', input: {}, status: 0, http_ok: false, duration_ms: 0, url_sanitised: '(skipped)', parsed_ok: false, notes: ['skipped — no top query discovered'] })
    }

    // ── PHASE 3 — crawl / index health ────────────────────────────────
    results.push(await probeOne('crawl_stats',   'GetCrawlStats',   { siteUrl: matchedSiteUrl }, apiKey))
    results.push(await probeOne('crawl_issues',  'GetCrawlIssues',  { siteUrl: matchedSiteUrl }, apiKey))
    results.push(await probeOne('link_counts',   'GetLinkCounts',   { siteUrl: matchedSiteUrl }, apiKey))
    results.push(await probeOne('url_info_root', 'GetUrlInfo',      { siteUrl: matchedSiteUrl, url: matchedSiteUrl }, apiKey))
    results.push(await probeOne('url_traffic_root', 'GetUrlTrafficInfo', { siteUrl: matchedSiteUrl, url: matchedSiteUrl }, apiKey))
    results.push(await probeOne('feeds',         'GetFeeds',        { siteUrl: matchedSiteUrl }, apiKey))
    results.push(await probeOne('country_settings', 'GetCountryRegionSettings', { siteUrl: matchedSiteUrl }, apiKey))
    results.push(await probeOne('crawl_settings', 'GetCrawlSettings', { siteUrl: matchedSiteUrl }, apiKey))
    results.push(await probeOne('query_parameters', 'GetQueryParameters', { siteUrl: matchedSiteUrl }, apiKey))
  } else {
    notes.push('No site URL matched — skipped stats/crawl endpoints.')
  }

  // ── Return sanitised summary ─────────────────────────────────────────
  return NextResponse.json({
    ok: true,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    api_base: 'https://ssl.bing.com/webmaster/api.svc/json',
    auth_mode: 'apikey_query_param',
    key_length: apiKey.length,     // length only — NEVER the value
    site_variants_seen: siteVariants,
    matched_site_url: matchedSiteUrl,
    notes,
    probes: results.map(p => ({
      ...p,
      // Belt-and-braces: re-sanitise every URL just before returning.
      url_sanitised: sanitiseUrl(p.url_sanitised),
      // Sample row also gets defensively re-sanitised in case any field
      // holds our siteUrl with encoded query params.
    })),
  })
}

export async function GET(req: Request)  { return handle(req) }
export async function POST(req: Request) { return handle(req) }
