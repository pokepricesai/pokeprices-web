// app/insights/page.tsx
import type { Metadata } from 'next'
import InsightsPageClient from './InsightsPageClient'

export const metadata: Metadata = {
  title: 'Pokémon Card Guides (2026) — Grading, PSA 10 Values & Market Trends',
  description: 'Practical Pokémon card guides — when to grade, PSA 10 value gaps, chase card analysis, market trends and price breakdowns. Real data, no hype.',
  openGraph: {
    title: 'Pokémon Card Guides (2026) — Grading, PSA 10 Values & Market Trends',
    description: 'Practical Pokémon card guides — when to grade, PSA 10 value gaps, chase card analysis, market trends. Real data.',
    url: 'https://www.pokeprices.io/insights',
    siteName: 'PokePrices',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Pokémon Card Guides (2026) — Grading, PSA 10 & Market Trends',
    description: 'Practical Pokémon card guides — grading advice, PSA 10 value gaps, chase cards and trends.',
  },
  alternates: {
    canonical: 'https://www.pokeprices.io/insights',
  },
}

export default function InsightsPage() {
  return <InsightsPageClient />
}