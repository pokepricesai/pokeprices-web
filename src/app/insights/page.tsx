// app/insights/page.tsx
import type { Metadata } from 'next'
import InsightsPageClient from './InsightsPageClient'

export const metadata: Metadata = {
  title: 'Market Insights',
  description: 'Pokemon TCG market analysis, price trend reports and collecting guides — powered by real sales data. Updated weekly.',
  openGraph: {
    title: 'Pokemon TCG Market Insights | PokePrices',
    description: 'Pokemon TCG market analysis, price trend reports and collecting guides — powered by real sales data.',
    url: 'https://pokeprices.io/insights',
  },
}

export default function InsightsPage() {
  return <InsightsPageClient />
}
