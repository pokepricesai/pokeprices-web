// app/browse/page.tsx
import type { Metadata } from 'next'
import BrowsePageClient from './BrowsePageClient'

export const metadata: Metadata = {
  title: 'Pokémon Card Sets — Browse All Sets & Prices | PokePrices',
  description: 'Browse all Pokémon TCG sets from Base Set to the latest releases. Find card prices, PSA population data, grading insights and market trends for every set. Free, updated daily.',
  openGraph: {
    title: 'Pokémon Card Sets — Browse All Sets & Prices | PokePrices',
    description: 'Browse all Pokémon TCG sets. Card prices, PSA population data and market trends for every set.',
    url: 'https://pokeprices.io/browse',
    siteName: 'PokePrices',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Pokémon Card Sets — Browse All Sets & Prices | PokePrices',
    description: 'Browse all Pokémon TCG sets. Card prices, PSA data and market trends. Free, updated daily.',
  },
  alternates: {
    canonical: 'https://pokeprices.io/browse',
  },
}

export default function BrowsePage() {
  return <BrowsePageClient />
}
