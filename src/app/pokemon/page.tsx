// /pokemon — top-level species directory.
//
// PP-URGENT-01 Job 3: eliminate the "All 0 species" flash and the
// client-only data-fetch waterfall. The page now fetches the cached
// /api/pokemon/extras endpoint server-side so the initial HTML
// already carries the real species list + totals. PokemonPageClient
// retains client-side interactivity (search, sort, pagination) but
// no longer blocks the fold on a browser round trip.

import PokemonPageClient, { type PokemonEntry } from './PokemonPageClient'
import { headers } from 'next/headers'

export const metadata = {
  title: 'All Pokémon Cards by Species (2026) — 1,025 Pokémon, Live Prices',
  description: 'Browse all 1,025 Pokémon species and find every card they appear on. Raw prices, PSA 10 values, full checklists and grading data across every Pokémon TCG set. Free, no login.',
  alternates: { canonical: 'https://www.pokeprices.io/pokemon' },
}

// 24h ISR mirrors the extras endpoint's s-maxage. If the catalogue
// changes mid-day, the next scheduled rebuild picks it up — same
// cadence as the price-guide refresh.
export const revalidate = 86400

type ExtrasResponse = {
  species?: {
    status: 'ok' | 'error'
    data: Array<{
      id: number
      name: string
      total_cards: number | null
      highest_card_price_cents: number | null
      total_market_value_cents: number | string | null
      type_primary: string | null
      generation: number | null
    }> | null
  }
  totalCards?: { status: 'ok' | 'error'; data: number | null }
}

async function fetchInitialExtras(): Promise<{
  initialSpecies: PokemonEntry[]
  initialTotalCards: number
  usedFallback: boolean
}> {
  try {
    const h = await headers()
    const proto = h.get('x-forwarded-proto') ?? 'https'
    const host = h.get('host') ?? 'www.pokeprices.io'
    const url = `${proto}://${host}/api/pokemon/extras`
    // ISR cadence matches the endpoint's s-maxage. Next.js will cache
    // the fetched payload at the route layer; the handler itself is
    // CDN-cached too.
    const res = await fetch(url, { next: { revalidate: 86400 } })
    if (!res.ok) throw new Error(`extras ${res.status}`)
    const payload = (await res.json()) as ExtrasResponse
    const rows = payload.species?.status === 'ok' ? payload.species.data ?? [] : []
    const initialSpecies: PokemonEntry[] = rows.map((r) => ({
      id:          r.id,
      name:        r.name,
      cardCount:   r.total_cards ?? 0,
      maxPrice:    r.highest_card_price_cents ?? null,
      totalValue:  Number(r.total_market_value_cents ?? 0),
      typePrimary: r.type_primary ?? null,
      generation:  r.generation ?? null,
    }))
    const initialTotalCards =
      payload.totalCards?.status === 'ok' ? payload.totalCards.data ?? 0 : 0
    return { initialSpecies, initialTotalCards, usedFallback: false }
  } catch {
    // Degrade silently — the client component can still refetch on mount.
    return { initialSpecies: [], initialTotalCards: 0, usedFallback: true }
  }
}

export default async function PokemonPage() {
  const { initialSpecies, initialTotalCards, usedFallback } = await fetchInitialExtras()
  return (
    <PokemonPageClient
      initialSpecies={initialSpecies}
      initialTotalCards={initialTotalCards}
      // When SSR fetch failed we flag that so the client runs its
      // own fetch on mount instead of trusting the empty seed.
      initialFallback={usedFallback}
    />
  )
}
