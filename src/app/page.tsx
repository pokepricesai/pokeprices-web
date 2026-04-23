// app/page.tsx
import type { Metadata } from 'next'
import HomeClient from './HomeClient'

export const metadata: Metadata = {
  title: 'The numbers behind every Pokémon card | PokePrices',
  description: 'Live prices, PSA 10 values, grading calculator and a collector\'s AI assistant. 40,000+ cards tracked nightly from real sold listings. Free forever, no login.',
  keywords: 'pokemon card prices, pokemon tcg price guide, psa 10 prices, pokemon card values uk, grading calculator, psa population',
  openGraph: {
    title: 'The numbers behind every Pokémon card | PokePrices',
    description: 'Live prices, PSA 10 values, grading calculator and a collector\'s AI assistant. 40,000+ cards, updated nightly.',
    url: 'https://www.pokeprices.io',
    siteName: 'PokePrices',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'The numbers behind every Pokémon card',
    description: 'Live prices, PSA 10 values, grading calculator and a collector\'s AI assistant.',
  },
  alternates: {
    canonical: 'https://www.pokeprices.io',
  },
}

export default function HomePage() {
  return <HomeClient />
}