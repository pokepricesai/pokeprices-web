// app/browse/page.tsx
import type { Metadata } from 'next'
import BrowsePageClient from './BrowsePageClient'

export const metadata: Metadata = {
  title: 'All Pokémon TCG Sets (2026) — Card Lists, Prices & PSA 10 Values',
  description: 'Browse every Pokémon TCG set from Base Set to the latest releases. Full card lists, raw and PSA 10 prices, PSA population data and market trends. Free, updated daily.',
  openGraph: {
    title: 'All Pokémon TCG Sets (2026) — Card Lists, Prices & PSA 10 Values',
    description: 'Browse every Pokémon TCG set. Full card lists, raw and PSA 10 prices, PSA population data, market trends. Free, updated daily.',
    url: 'https://www.pokeprices.io/browse',
    siteName: 'PokePrices',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'All Pokémon TCG Sets (2026) — Card Lists, Prices & PSA 10 Values',
    description: 'Browse every Pokémon TCG set. Full card lists, raw and PSA 10 prices, market trends. Free.',
  },
  alternates: {
    canonical: 'https://www.pokeprices.io/browse',
  },
}

export default function BrowsePage() {
  return <BrowsePageClient />
}
