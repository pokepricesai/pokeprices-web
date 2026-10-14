// src/app/api/browse/extras/route.ts
//
// Phase 3 — browse-page cost reduction.
//
// Collapses the two direct browser → Supabase RPCs BrowsePageClient
// previously issued on every /browse view (`get_set_list_v2`,
// `get_trending_sets`) into one same-origin fetch. CDN-cached for 24h.
//
// Mirrors /api/home/extras exactly: anon client, Promise.allSettled,
// per-chunk discriminated status, SUCCESS_CACHE_CONTROL for fully-OK,
// PARTIAL_CACHE_CONTROL for recovery after a chunk fails, no-store
// for total failure. The auth-session hydration + per-user portfolio-
// completion loads in BrowsePageClient are UNCHANGED — those are
// user-specific and must not be CDN-cached.
//
// No parameters: both RPCs return the same data for every viewer.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' } as const
const SUCCESS_CACHE_CONTROL =
  'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800, must-revalidate'
const PARTIAL_CACHE_CONTROL =
  'public, max-age=0, s-maxage=3600, stale-while-revalidate=604800, must-revalidate'

type Chunk<T> = { status: 'ok'; data: T } | { status: 'error'; data: null }

type SetInfo = {
  set_name: string
  card_count: number
  avg_raw_usd: number | null
  total_raw_usd: number | null
  set_image_url: string | null
  set_release_date: string | null
  language?: string | null
}

type TrendingSet = {
  set_name: string
  card_count: number
  avg_raw_usd: number
  total_raw_usd: number
  avg_pct_30d: number
  avg_pct_90d: number
  total_pct_30d: number
  total_pct_90d: number
}

type TrendingData = { rising: TrendingSet[]; falling: TrendingSet[] }

type ExtrasResponse = {
  sets:     Chunk<SetInfo[]>
  trending: Chunk<TrendingData>
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
    supabase.rpc('get_set_list_v2'),
    supabase.rpc('get_trending_sets', { lim: 8 }),
  ])

  const sets     = classifyRpc<SetInfo[]>(results[0], { defaultOk: [] })
  const trending = classifyTrending(results[1])

  const chunks: ExtrasResponse = { sets, trending }

  const errorCount =
    (sets.status === 'error' ? 1 : 0) +
    (trending.status === 'error' ? 1 : 0)

  if (errorCount === 2) {
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

function classifyRpc<T>(
  settled: PromiseSettledResult<PostgrestLikeResult<T>>,
  opts: { defaultOk?: T } = {},
): Chunk<T> {
  if (settled.status === 'rejected') return { status: 'error', data: null }
  const r = settled.value
  if (r && r.error) return { status: 'error', data: null }
  const value = (r?.data ?? null) as T | null
  if (value === null && opts.defaultOk !== undefined) {
    return { status: 'ok', data: opts.defaultOk }
  }
  return { status: 'ok', data: value as T }
}

// `get_trending_sets` returns a single object { rising: [], falling: [] };
// we normalise either shape into the Chunk<TrendingData> contract so a
// null-data RPC still yields an empty-but-ok result.
function classifyTrending(
  settled: PromiseSettledResult<PostgrestLikeResult<TrendingData>>,
): Chunk<TrendingData> {
  const base = classifyRpc<TrendingData>(settled, { defaultOk: { rising: [], falling: [] } })
  if (base.status === 'error') return base
  const d = base.data as any
  const rising  = Array.isArray(d?.rising)  ? d.rising  : []
  const falling = Array.isArray(d?.falling) ? d.falling : []
  return { status: 'ok', data: { rising, falling } }
}
