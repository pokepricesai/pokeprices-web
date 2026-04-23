// app/insights/page.tsx
import type { Metadata } from 'next'
import InsightsPageClient from './InsightsPageClient'

export const metadata: Metadata = {
  title: 'Pokémon Card Guides: Grading Advice, Market Trends and Price Analysis | PokePrices',
  description: 'Read practical Pokémon card guides on grading, PSA 10 value gaps, market trends, chase cards and smarter buying decisions.',
  openGraph: {
    title: 'Pokémon Card Guides: Grading, Trends and Price Analysis | PokePrices',
    description: 'Practical guides for Pokémon card collectors — grading advice, PSA population analysis, market trends and price breakdowns.',
    url: 'https://www.pokeprices.io/insights',
    siteName: 'PokePrices',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Pokémon Card Guides: Grading, Trends and Price Analysis',
    description: 'Practical Pokémon card guides on grading, PSA 10 value gaps, market trends and chase cards.',
  },
  alternates: {
    canonical: 'https://www.pokeprices.io/insights',
  },
}

export default function InsightsPage() {
  return <InsightsPageClient />
}