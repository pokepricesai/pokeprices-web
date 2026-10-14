// src/app/api/home/extras/route.ts
//
// Phase 2 — homepage cost + performance consolidation.
//
// Replaces the five direct browser → Supabase requests HomeClient
// previously issued on every homepage view (market_index select,
// get_hidden_gems, get_market_total, insights select, and
// get_weekly_market_report). The browser now issues one same-origin
// fetch to this endpoint and the Vercel edge caches the response for
// 24h. The auth-session hydration path in HomeClient is unchanged
// because it is user-specific and must NOT be cached.
//
// Mirrors src/app/api/card/[cardSlug]/extras/route.ts exactly:
//   * anon Supabase client — RLS boundary unchanged
//   * Promise.allSettled fan-out so one failure cannot destroy four
//     successes
//   * discriminated { status: 'ok' | 'error', data } per chunk — a
//     backend blip must NEVER pose as a legitimate factual zero
//   * cache-control:
//       fully OK  → s-maxage=86400 (24h) + SWR=604800 (7d)
//       partial   → s-maxage=3600  (1h)  + SWR=604800
//       total     → no-store + 500
//
// This endpoint takes no parameters: the homepage data is the same
// for every viewer. One cache key, one entry in the CDN per edge.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' } as const
const SUCCESS_CACHE_CONTROL =
  'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800, must-revalidate'
const PARTIAL_CACHE_CONTROL =
  'public, max-age=0, s-maxage=3600, stale-while-revalidate=604800, must-revalidate'

type Chunk<T> = { status: 'ok'; data: T } | { status: 'error'; data: null }

type MarketIndexRow = {
  date: string
  total_raw_usd: number
  median_raw_usd: number
  raw_pct_30d: number | null
}

type MarketTotal = {
  total_raw_usd: number
  cards_tracked: number
}

type HiddenGem = {
  card_slug: string
  card_name: string
  set_name: string
  card_url_slug: string | null
  current_price: number
  pct_30d: number | null
  psa10_pop: number
  gem_score: number
}

type Insight = {
  id: string
  slug: string
  headline: string
  intro: string | null
  theme_label: string | null
  published_at: string
  image_url: string | null
  read_time_mins: number | null
}

type WeeklyReportRow = {
  category: string
  card_slug: string
  card_name: string
  set_name: string
  card_url_slug: string | null
  current_price: number
  metric_label: string
}

type ExtrasResponse = {
  marketIndex:  Chunk<MarketIndexRow[]>
  hiddenGems:   Chunk<HiddenGem[]>
  marketTotal:  Chunk<MarketTotal | null>
  insights:     Chunk<Insight[]>
  weeklyReport: Chunk<WeeklyReportRow[]>
}

export async function GET(): Promise<NextResponse> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnon) {
    return NextResponse.json(
      { error: 'supabase env missing' },
      { status: 500, headers: NO_STORE_HEADERS },
    )
  }

  const supabase = createClient(supabaseUrl, supabaseAnon, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const results = await Promise.allSettled([
    supabase
      .from('market_index')
      .select('date, total_raw_usd, median_raw_usd, raw_pct_30d')
      .order('date', { ascending: true })
      .limit(80),
    supabase.rpc('get_hidden_gems', { lim: 6 }),
    supabase.rpc('get_market_total'),
    supabase
      .from('insights')
      .select('id, slug, headline, intro, theme_label, published_at, image_url, read_time_mins')
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(3),
    supabase.rpc('get_weekly_market_report'),
  ])

  const marketIndex  = classifyRpc<MarketIndexRow[]>(results[0], { defaultOk: [] })
  const hiddenGems   = classifyRpc<HiddenGem[]>(results[1], { defaultOk: [] })
  const marketTotal  = classifyRpc<MarketTotal | null>(results[2], { defaultOk: null })
  const insights     = classifyRpc<Insight[]>(results[3], { defaultOk: [] })
  const weeklyReport = classifyRpc<WeeklyReportRow[]>(results[4], { defaultOk: [] })

  const chunks: ExtrasResponse = {
    marketIndex,
    hiddenGems,
    marketTotal,
    insights,
    weeklyReport,
  }

  const errorCount =
    (marketIndex.status === 'error' ? 1 : 0) +
    (hiddenGems.status === 'error' ? 1 : 0) +
    (marketTotal.status === 'error' ? 1 : 0) +
    (insights.status === 'error' ? 1 : 0) +
    (weeklyReport.status === 'error' ? 1 : 0)

  if (errorCount === 5) {
    return NextResponse.json(
      chunks,
      { status: 500, headers: NO_STORE_HEADERS },
    )
  }

  const cacheControl = errorCount === 0 ? SUCCESS_CACHE_CONTROL : PARTIAL_CACHE_CONTROL

  return NextResponse.json(
    chunks,
    { status: 200, headers: { 'Cache-Control': cacheControl } },
  )
}

type PostgrestLikeResult<T> = { data: T | null; error: { message?: string } | null }

/** Convert one PostgREST result into our discriminated Chunk shape.
 *  Rejected promise OR non-null `error` → `{ status: 'error', data: null }`.
 *  A null `data` with no `error` is a legitimate factual zero — the
 *  chunk is `ok` with null, or `defaultOk` if the caller prefers an
 *  empty collection. Keeps the CDN from pinning backend blips as
 *  confident emptiness. */
function classifyRpc<T>(
  settled: PromiseSettledResult<PostgrestLikeResult<T>>,
  opts: { defaultOk?: T } = {},
): Chunk<T> {
  if (settled.status === 'rejected') {
    return { status: 'error', data: null }
  }
  const r = settled.value
  if (r && r.error) {
    return { status: 'error', data: null }
  }
  const value = (r?.data ?? null) as T | null
  if (value === null && opts.defaultOk !== undefined) {
    return { status: 'ok', data: opts.defaultOk }
  }
  return { status: 'ok', data: value as T }
}
