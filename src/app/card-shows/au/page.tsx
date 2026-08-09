import type { Metadata } from 'next'
import Link from 'next/link'
import { getCardShowsByCountry, getRegionsForCountry } from '@/data/cardShows'
import CardShowList from '../CardShowList'

export const metadata: Metadata = {
  title: 'Upcoming Pokémon Card Shows Australia | PokePrices',
  description:
    'Find upcoming Pokémon card shows, trading card fairs and TCG events across Australia. Browse dates, cities, venues and organiser links.',
  alternates: { canonical: 'https://www.pokeprices.io/card-shows/au' },
  openGraph: {
    title: 'Upcoming Pokémon Card Shows Australia | PokePrices',
    description: 'Find upcoming Pokémon card shows, trading card fairs and TCG events across Australia.',
    url: 'https://www.pokeprices.io/card-shows/au',
    siteName: 'PokePrices',
    type: 'website',
  },
}

export default function AUCardShowsPage() {
  const shows = getCardShowsByCountry('au')
  const regions = getRegionsForCountry('au')

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
          Upcoming Pokémon Card Shows in Australia
        </h1>
        <p style={{ fontSize: 14, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: 0, lineHeight: 1.6, maxWidth: 720 }}>
          Australia-wide listings for Pokémon card shows, TCG fairs and collector meets. Filter by state, event type, or featured events worth travelling for. Updated regularly from organiser pages and collector groups.
        </p>
      </header>

      <CardShowList shows={shows} regions={regions} country="au" />
    </div>
  )
}
