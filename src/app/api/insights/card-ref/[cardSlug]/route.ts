// src/app/api/insights/card-ref/[cardSlug]/route.ts
//
// Phase 3 — insights-article cost reduction.
//
// Legacy article blocks (`card_grid` → CardTile, `chart` → ChartBlock)
// previously issued two direct browser → Supabase calls per embedded
// card reference (one for the `cards` row, one for `daily_prices`).
// An article with ten referenced cards fired ~20 queries per view.
// Modern articles use the server-rendered DataBlockRenderer and do not
// touch this endpoint.
//
// This handler returns the metadata + 90-day history for one card so
// both CardTile and ChartBlock can read from a single cached fetch per
// slug. CDN cache is per cardSlug, so the first referenced card on an
// article populates the cache for every subsequent article that cites
// the same card.
//
// Slug convention — see CLAUDE.md:
//   cards.card_slug         is BARE  numeric (e.g. "959616")
//   daily_prices.card_slug  uses the "pc-" prefix (e.g. "pc-959616")
// The handler accepts either shape and canonicalises internally.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

const BARE_SLUG_RE = /^[a-z0-9][a-z0-9-]*$/

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' } as const
const SUCCESS_CACHE_CONTROL =
  'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800, must-revalidate'
const PARTIAL_CACHE_CONTROL =
  'public, max-age=0, s-maxage=3600, stale-while-revalidate=604800, must-revalidate'

type Chunk<T> = { status: 'ok'; data: T } | { status: 'error'; data: null }

type CardMetadata = {
  card_name:     string
  set_name:      string
  card_number:   string | null
  image_url:     string | null
  card_url_slug: string | null
}

type Response = {
  cardSlug:    string
  metadata:    Chunk<CardMetadata | null>
  // Chart consumer: 90 ascending-date values with raw_usd > 0.
  // Tile consumer: reads the last element as "latest price".
  priceHistory: Chunk<Array<{ raw_usd: number }>>
}

type Params = { cardSlug: string }

function canonicaliseSlug(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase()
  const bare = trimmed.replace(/^pc-/, '')
  if (!BARE_SLUG_RE.test(bare)) return null
  return bare
}

export async function GET(
  _req: Request,
  context: { params: Promise<Params> },
): Promise<NextResponse> {
  const { cardSlug: rawSlug } = await context.params
  const bareSlug = canonicaliseSlug(rawSlug)
  if (!bareSlug) {
    return NextResponse.json(
      { error: 'invalid cardSlug' },
      { status: 400, headers: NO_STORE_HEADERS },
    )
  }
  const pcSlug = `pc-${bareSlug}`

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
      .from('cards')
      .select('card_name, set_name, card_number, image_url, card_url_slug')
      .eq('card_slug', bareSlug)
      .maybeSingle(),
    supabase
      .from('daily_prices')
      .select('raw_usd')
      .eq('card_slug', pcSlug)
      .gt('raw_usd', 0)
      .order('date', { ascending: true })
      .limit(90),
  ])

  const metadata: Chunk<CardMetadata | null> =
    results[0].status === 'fulfilled'
      ? (results[0].value.error
          ? { status: 'error', data: null }
          : { status: 'ok', data: (results[0].value.data as CardMetadata | null) ?? null })
      : { status: 'error', data: null }

  const priceHistory: Chunk<Array<{ raw_usd: number }>> =
    results[1].status === 'fulfilled'
      ? (results[1].value.error
          ? { status: 'error', data: null }
          : { status: 'ok', data: (results[1].value.data as Array<{ raw_usd: number }>) ?? [] })
      : { status: 'error', data: null }

  const body: Response = { cardSlug: bareSlug, metadata, priceHistory }

  const errorCount =
    (metadata.status === 'error' ? 1 : 0) +
    (priceHistory.status === 'error' ? 1 : 0)

  if (errorCount === 2) {
    return NextResponse.json(
      body,
      { status: 500, headers: NO_STORE_HEADERS },
    )
  }

  const cacheControl = errorCount === 0 ? SUCCESS_CACHE_CONTROL : PARTIAL_CACHE_CONTROL
  return NextResponse.json(
    body,
    { status: 200, headers: { 'Cache-Control': cacheControl } },
  )
}
