// app/page.tsx
import type { Metadata } from 'next'
import HomeClient from './HomeClient'

export const metadata: Metadata = {
  title: 'Pokémon Card Prices, PSA 10 Values and Grading Data | PokePrices',
  description: 'Free Pokémon card price guide with live raw and graded values, PSA population data, trend analysis and practical grading insights. 40,000+ cards, updated nightly.',
  keywords: 'pokemon card prices, pokemon tcg price guide, psa 10 prices, pokemon card values uk, grading calculator, psa population',
  openGraph: {
    title: 'Pokémon Card Prices, PSA 10 Values and Grading Data | PokePrices',
    description: 'Free Pokémon card price guide — raw, PSA 9 and PSA 10 values, population data, market trends and grading analysis. No login, updated nightly.',
    url: 'https://pokeprices.io',
    siteName: 'PokePrices',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Pokémon Card Prices, PSA 10 Values and Grading Data',
    description: 'Free Pokémon card price guide. Live raw and graded values, PSA population data, trend analysis. No login.',
  },
  alternates: {
    canonical: 'https://pokeprices.io',
  },
}

export default function HomePage() {
  return <HomeClient />
}