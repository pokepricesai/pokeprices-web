// src/app/api/set/[slug]/extras/route.ts
//
// Phase 3 — set-page cost reduction.
//
// SetPageClient previously issued six public Supabase queries after
// its primary card-list RPC on every page view (release-date fallback,
// set_metadata.language, get_set_insight, get_set_price_history,
// psa_set_totals, card_trends) plus two enrichment queries whenever
// card_trends returned slugs (cards.in + card_volume.in). This handler
// moves all of that behind one cached same-origin fetch keyed per set.
//
// The primary `get_set_cards_sortable` RPC stays on the client because
// it varies by sort and the user changes sort interactively — bringing
// it under this handler would multiply the cache fan-out by 5 and
// still require a round-trip on every sort switch.
//
// Mirrors /api/home/extras exactly: anon client, Promise.allSettled,
// discriminated per-chunk status, SUCCESS_CACHE_CONTROL for fully-OK,
// PARTIAL_CACHE_CONTROL for recovery after a chunk fails, no-store
// for total failure.

import { NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' } as const
const SUCCESS_CACHE_CONTROL =
  'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800, must-revalidate'
const PARTIAL_CACHE_CONTROL =
  'public, max-age=0, s-maxage=3600, stale-while-revalidate=604800, must-revalidate'

const MAX_SET_NAME_LEN = 128

type Chunk<T> = { status: 'ok'; data: T } | { status: 'error'; data: null }

type Params = { slug: string }

type PopStats = { total_graded: number; gem_rate: number; total_psa10: number }

type TrendCard = {
  card_slug: string
  card_name: string
  card_url_slug: string | null
  raw_usd: number
  raw_pct_30d: number | null
  image_url: string | null
  volume_label: string | null
}

type MoversPayload = {
  topMovers:       TrendCard[]
  topFallers:      TrendCard[]
  topSealedMovers: TrendCard[]
}

type PriceHistoryRow = { date: string; value_usd: number | null }

type ExtrasResponse = {
  setName:      string
  releaseDate:  Chunk<string | null>
  language:     Chunk<string | null>
  insight:      Chunk<string | null>
  priceHistory: Chunk<PriceHistoryRow[]>
  popStats:     Chunk<PopStats | null>
  movers:       Chunk<MoversPayload>
}

function canonicaliseInput(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim()
}

export async function GET(
  _req: Request,
  context: { params: Promise<Params> },
): Promise<NextResponse> {
  const { slug: rawSlug } = await context.params

  let decoded: string
  try {
    decoded = decodeURIComponent(rawSlug)
  } catch {
    return NextResponse.json(
      { error: 'invalid slug' },
      { status: 400, headers: NO_STORE_HEADERS },
    )
  }
  const setName = canonicaliseInput(decoded)
  if (!setName || setName.length > MAX_SET_NAME_LEN) {
    return NextResponse.json(
      { error: 'invalid or oversized setName' },
      { status: 400, headers: NO_STORE_HEADERS },
    )
  }

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

  // Fan out the six per-set queries. Order matches SetPageClient's
  // former sequence 1:1 so a future diff can audit parity by eye.
  const results = await Promise.allSettled([
    supabase
      .from('cards').select('set_release_date')
      .eq('set_name', setName).not('set_release_date', 'is', null)
      .limit(1).maybeSingle(),
    supabase.from('set_metadata').select('language').eq('set_name', setName).maybeSingle(),
    supabase.rpc('get_set_insight',       { set_text: setName }),
    supabase.rpc('get_set_price_history', { set_text: setName }),
    supabase
      .from('psa_set_totals').select('*')
      .or(`set_name.eq.Pokemon ${setName},set_name.ilike.%${setName}%`)
      .order('snapshot_date', { ascending: false }).limit(1),
    supabase
      .from('card_trends').select('card_name, card_slug, current_raw, raw_pct_30d')
      .eq('set_name', setName).not('raw_pct_30d', 'is', null).gt('current_raw', 500)
      .order('raw_pct_30d', { ascending: false }).limit(200),
  ])

  const releaseDateChunk: Chunk<string | null> =
    results[0].status === 'fulfilled'
      ? (results[0].value.error
          ? { status: 'error', data: null }
          : { status: 'ok', data: (results[0].value.data as any)?.set_release_date ?? null })
      : { status: 'error', data: null }

  const languageChunk: Chunk<string | null> =
    results[1].status === 'fulfilled'
      ? (results[1].value.error
          ? { status: 'error', data: null }
          : { status: 'ok', data: (results[1].value.data as any)?.language ?? null })
      : { status: 'error', data: null }

  const insightChunk: Chunk<string | null> =
    results[2].status === 'fulfilled'
      ? (results[2].value.error
          ? { status: 'error', data: null }
          : { status: 'ok', data: (results[2].value.data as any) ?? null })
      : { status: 'error', data: null }

  const priceHistoryChunk: Chunk<PriceHistoryRow[]> =
    results[3].status === 'fulfilled'
      ? (results[3].value.error
          ? { status: 'error', data: null }
          : {
              status: 'ok',
              // Mirror the client-side cents conversion so the UI
              // consumes identical values.
              data: ((results[3].value.data as any[]) ?? []).map(d => ({
                ...d,
                value_usd: d.value_usd != null ? Number(d.value_usd) * 100 : null,
              })),
            })
      : { status: 'error', data: null }

  const popStatsChunk: Chunk<PopStats | null> =
    results[4].status === 'fulfilled'
      ? (results[4].value.error
          ? { status: 'error', data: null }
          : (() => {
              const rows = (results[4].value.data as any[]) ?? []
              if (rows.length === 0) return { status: 'ok' as const, data: null }
              const pop = rows[0]
              return {
                status: 'ok' as const,
                data: {
                  total_graded: pop.total_graded || 0,
                  gem_rate:     pop.gem_rate     || 0,
                  total_psa10:  pop.total_psa_10 || 0,
                },
              }
            })())
      : { status: 'error', data: null }

  // Movers requires the trends shortlist AND two enrichment queries.
  // If the trends query errored, movers is error — we don't lie about
  // partial data. If trends succeeded but returned zero rows, movers
  // is ok-empty. If trends succeeded and the enrichment queries fail,
  // we treat the whole movers chunk as error so the UI falls back to
  // its "no movers" branch rather than render half-built rows.
  const moversChunk: Chunk<MoversPayload> = await (async () => {
    if (results[5].status !== 'fulfilled') return { status: 'error', data: null }
    if (results[5].value.error) return { status: 'error', data: null }
    const trendRows = (results[5].value.data as any[]) ?? []
    if (trendRows.length === 0) {
      return { status: 'ok', data: { topMovers: [], topFallers: [], topSealedMovers: [] } }
    }
    const enriched = await enrichMovers(supabase, trendRows)
    if (!enriched) return { status: 'error', data: null }
    return { status: 'ok', data: enriched }
  })()

  const chunks: ExtrasResponse = {
    setName,
    releaseDate:  releaseDateChunk,
    language:     languageChunk,
    insight:      insightChunk,
    priceHistory: priceHistoryChunk,
    popStats:     popStatsChunk,
    movers:       moversChunk,
  }

  const errorCount =
    (releaseDateChunk.status === 'error' ? 1 : 0) +
    (languageChunk.status === 'error' ? 1 : 0) +
    (insightChunk.status === 'error' ? 1 : 0) +
    (priceHistoryChunk.status === 'error' ? 1 : 0) +
    (popStatsChunk.status === 'error' ? 1 : 0) +
    (moversChunk.status === 'error' ? 1 : 0)

  if (errorCount === 6) {
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

// Enrichment chain: 1) image/slug/is_sealed from cards, 2) sales_30d +
// volume_label from card_volume (Ungraded only). Returns null on
// either enrichment query erroring so the caller marks movers as a
// backend-error chunk rather than render half-populated rows.
async function enrichMovers(
  supabase: SupabaseClient,
  trendRows: any[],
): Promise<MoversPayload | null> {
  const slugs = trendRows.map(t => t.card_slug)
  const [imgRes, volRes] = await Promise.all([
    supabase.from('cards').select('card_slug, image_url, card_url_slug, is_sealed').in('card_slug', slugs),
    supabase.from('card_volume').select('card_slug, sales_30d, volume_label').in('card_slug', slugs).eq('grade', 'Ungraded'),
  ])
  if (imgRes.error || volRes.error) return null

  const imgMap: Record<string, any> = {}
  for (const c of (imgRes.data || [])) imgMap[c.card_slug] = c
  const volMap: Record<string, any> = {}
  for (const v of (volRes.data || [])) volMap[v.card_slug] = v

  const allEnriched = trendRows
    .filter(t => {
      const vol = volMap[t.card_slug]
      return vol && vol.sales_30d >= 1
    })
    .map(t => ({
      card_slug:     t.card_slug,
      card_name:     t.card_name,
      card_url_slug: imgMap[t.card_slug]?.card_url_slug ?? null,
      raw_usd:       t.current_raw / 100,
      raw_pct_30d:   t.raw_pct_30d,
      image_url:     imgMap[t.card_slug]?.image_url ?? null,
      is_sealed:     imgMap[t.card_slug]?.is_sealed === true || imgMap[t.card_slug]?.is_sealed === 'true',
      volume_label:  volMap[t.card_slug]?.volume_label ?? null,
    }))

  const isReliable = (t: any) => Math.abs(t.raw_pct_30d ?? 0) <= 300
  const cardEnriched   = allEnriched.filter(t => !t.is_sealed)
  const sealedEnriched = allEnriched.filter(t =>  t.is_sealed)

  const stripSealed = (t: any): TrendCard => {
    // The UI type never carries is_sealed on movers; drop it so the
    // response shape matches the TrendCard contract exactly.
    const { is_sealed: _is_sealed, ...rest } = t
    return rest as TrendCard
  }

  const topMovers = cardEnriched
    .filter(t => (t.raw_pct_30d ?? 0) > 0 && isReliable(t))
    .slice(0, 5)
    .map(stripSealed)
  const topFallers = cardEnriched
    .filter(t => (t.raw_pct_30d ?? 0) < 0 && isReliable(t))
    .sort((a, b) => (a.raw_pct_30d ?? 0) - (b.raw_pct_30d ?? 0))
    .slice(0, 5)
    .map(stripSealed)
  const topSealedMovers = sealedEnriched
    .filter(t => (t.raw_pct_30d ?? 0) > 0 && isReliable(t))
    .slice(0, 5)
    .map(stripSealed)

  return { topMovers, topFallers, topSealedMovers }
}
