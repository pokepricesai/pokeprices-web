import type { Metadata } from 'next'
import Link from 'next/link'
import { getCardShowsByCountry, getRegionsForCountry } from '@/data/cardShows'
import CardShowList from '../CardShowList'

export const metadata: Metadata = {
  title: 'Upcoming Pokémon Card Shows Canada | PokePrices',
  description:
    'Find upcoming Pokémon card shows, trading card fairs and TCG events across Canada. Browse dates, cities, venues and organiser links across Ontario, BC, Alberta and Quebec.',
  alternates: { canonical: 'https://www.pokeprices.io/card-shows/ca' },
  openGraph: {
    title: 'Upcoming Pokémon Card Shows Canada | PokePrices',
    description: 'Find upcoming Pokémon card shows, trading card fairs and TCG events across Canada.',
    url: 'https://www.pokeprices.io/card-shows/ca',
    siteName: 'PokePrices',
    type: 'website',
  },
}

export default function CACardShowsPage() {
  const shows = getCardShowsByCountry('ca')
  const regions = getRegionsForCountry('ca')

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 24px' }}>
      <Link href="/card-shows" style={{
        display: 'inline-block', fontSize: 13, fontWeight: 700,
        color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif",
        textDecoration: 'none', marginBottom: 16,
      }}>
        ← All card shows
      </Link>

      <header style={{ marginBottom: 22 }}>
        <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 30, margin: '0 0 8px', color: 'var(--text)', letterSpacing: -0.4 }}>
          Upcoming Pokémon Card Shows in Canada
        </h1>
        <p style={{ fontSize: 14, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: 0, lineHeight: 1.6, maxWidth: 720 }}>
          Province-by-province listings for Pokémon card shows, trading card fairs and major collector events across Canada. Filter by province, event type, or sort by nearest to your city. Includes Sport Card Expo Toronto, Collecttopia, and regional Ontario / BC / AB / QC shows.
        </p>
      </header>

      <CardShowList shows={shows} regions={regions} country="ca" />
    </div>
  )
}
