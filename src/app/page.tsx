// app/page.tsx
import type { Metadata } from 'next'
import HomeClient from './HomeClient'

export const metadata: Metadata = {
  title: 'Pokémon Card Prices — Free Price Guide for UK Collectors | PokePrices',
  description: 'Free Pokémon TCG price guide. Live prices for 40,000+ cards — raw, PSA 9 & PSA 10. Price trends, grading calculator, PSA population data. No login. Updated nightly.',
  keywords: 'pokemon card prices, pokemon tcg price guide, psa 10 prices, pokemon card values uk, grading calculator, psa population',
  openGraph: {
    title: 'Pokémon Card Prices — Free Price Guide for UK Collectors',
    description: 'Live prices for 40,000+ Pokémon cards. Raw, PSA 9 & PSA 10 values, grading calculator and market trends. Free, no login, updated nightly.',
    url: 'https://pokeprices.io',
    siteName: 'PokePrices',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Pokémon Card Prices — Free Price Guide for UK Collectors',
    description: 'Live prices for 40,000+ Pokémon cards. Free, no login, updated nightly.',
  },
  alternates: {
    canonical: 'https://pokeprices.io',
  },
}

export default function HomePage() {
  return <HomeClient />
}
