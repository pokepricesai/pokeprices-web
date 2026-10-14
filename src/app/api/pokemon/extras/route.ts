// src/app/api/pokemon/extras/route.ts
//
// Phase 3 — Pokémon-hub cost reduction.
//
// PokemonPageClient previously issued up to four direct browser →
// Supabase calls per view (three pages of `get_pokemon_species_list`
// plus one `cards` count query). That paginated fan-out ran on every
// visit even though the species list changes once per night at most.
//
// This handler paginates server-side, returns the full species list
// in a single response, and the browser issues one same-origin fetch
// instead. CDN-cached for 24h.
//
// Mirrors the home/browse extras shape exactly: anon client,
// Promise.allSettled, per-chunk discriminated status.

import { NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' } as const
const SUCCESS_CACHE_CONTROL =
  'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800, must-revalidate'
const PARTIAL_CACHE_CONTROL =
  'public, max-age=0, s-maxage=3600, stale-while-revalidate=604800, must-revalidate'

type Chunk<T> = { status: 'ok'; data: T } | { status: 'error'; data: null }

type SpeciesRow = {
  id: number
  name: string
  total_cards: number | null
  highest_card_price_cents: number | null
  total_market_value_cents: number | string | null
  type_primary: string | null
  generation: number | null
}

type ExtrasResponse = {
  species:    Chunk<SpeciesRow[]>
  totalCards: Chunk<number>
}

// Match the client's prior pagination exactly: pages of 500 rows, hard
// cap at 5,000 rows. The PostgREST row limit is 1,000 which this RPC
// paginates around at the RPC level, so repeated calls are required.
async function fetchAllSpecies(supabase: SupabaseClient): Promise<SpeciesRow[]> {
  const PAGE = 500
  const HARD_CAP = 5000
  const all: SpeciesRow[] = []
  let offset = 0
  while (all.length < HARD_CAP) {
    const { data, error } = await supabase.rpc('get_pokemon_species_list', {
      p_lim: PAGE, p_offset: offset,
    })
    if (error) throw new Error(`get_pokemon_species_list failed at offset ${offset}: ${error.message}`)
    if (!data || data.length === 0) break
    all.push(...(data as SpeciesRow[]))
    if (data.length < PAGE) break
    offset += PAGE
  }
  return all
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
    fetchAllSpecies(supabase),
    supabase.from('cards').select('id', { count: 'exact', head: true }).eq('is_sealed', false),
  ])

  // species is a plain thrown-promise result (not a PostgREST tuple)
  const species: Chunk<SpeciesRow[]> =
    results[0].status === 'fulfilled'
      ? { status: 'ok', data: results[0].value }
      : { status: 'error', data: null }

  // The count-only query returns { data: [], count: number, error }. The
  // Chunk shape stores count directly as a number.
  const totalCards: Chunk<number> =
    results[1].status === 'fulfilled'
      ? (results[1].value.error
          ? { status: 'error', data: null }
          : { status: 'ok', data: results[1].value.count ?? 0 })
      : { status: 'error', data: null }

  const chunks: ExtrasResponse = { species, totalCards }

  const errorCount =
    (species.status === 'error' ? 1 : 0) +
    (totalCards.status === 'error' ? 1 : 0)

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
