// app/page.tsx
import type { Metadata } from 'next'
import HomeClient from './HomeClient'

export const metadata: Metadata = {
  title: 'Pokémon Card Value Checker & Price Guide (2026) | PokePrices',
  description: 'Free Pokémon card value checker — live raw and PSA 10 prices for 40,000+ cards across 156 sets. Price guide with grading spreads, PSA pop data and 30-day trends. No login.',
  openGraph: {
    title: 'Pokémon Card Value Checker & Price Guide (2026)',
    description: 'Free Pokémon card value checker — live raw and PSA 10 prices for 40,000+ cards. Price guide with grading spreads, PSA pop data and 30-day trends.',
    url: 'https://www.pokeprices.io',
    siteName: 'PokePrices',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Pokémon Card Value Checker & Price Guide (2026)',
    description: 'Free Pokémon card value checker — live raw and PSA 10 prices for 40,000+ cards. Price guide with grading spreads, PSA pop data and 30-day trends.',
  },
  alternates: {
    canonical: 'https://www.pokeprices.io',
  },
}

export default function HomePage() {
  return <HomeClient />
}