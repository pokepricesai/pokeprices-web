// app/page.tsx
import type { Metadata } from 'next'
import HomeClient from './HomeClient'

export const metadata: Metadata = {
  title: 'Pokémon Card Prices & PSA 10 Values (2026) | PokePrices',
  description: 'How much is your Pokémon card worth? Live raw and PSA 10 values for 40,000+ cards across 156 sets. Price trends, grading spreads, PSA population data. Free, no login.',
  keywords: 'pokemon card prices, pokemon card value, pokemon tcg price guide, psa 10 prices, pokemon card price list, pokemon card price checker, grading calculator, psa population',
  openGraph: {
    title: 'Pokémon Card Prices & PSA 10 Values (2026)',
    description: 'Live raw and PSA 10 values for 40,000+ Pokémon cards. Price trends, grading spreads, PSA population data. Free, no login.',
    url: 'https://www.pokeprices.io',
    siteName: 'PokePrices',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Pokémon Card Prices & PSA 10 Values (2026)',
    description: 'Live raw and PSA 10 values for 40,000+ Pokémon cards. Price trends, grading spreads, PSA population data. Free, no login.',
  },
  alternates: {
    canonical: 'https://www.pokeprices.io',
  },
}

export default function HomePage() {
  return <HomeClient />
}