// app/browse/page.tsx
import type { Metadata } from 'next'
import BrowsePageClient from './BrowsePageClient'

export const metadata: Metadata = {
  title: 'Pokemon Card Sets — Browse All 156 Sets',
  description: 'Browse all Pokemon TCG sets and find card prices. From Base Set to the latest releases — prices, PSA population data and grading insights for every set.',
  openGraph: {
    title: 'Pokemon Card Sets — Browse All 156 Sets | PokePrices',
    description: 'Browse all Pokemon TCG sets and find card prices. From Base Set to the latest releases.',
    url: 'https://pokeprices.io/browse',
  },
}

export default function BrowsePage() {
  return <BrowsePageClient />
}
