// app/studio/page.tsx
import type { Metadata } from 'next'
import StudioPageClient from './StudioPageClient'

export const metadata: Metadata = {
  title: 'PokePrices Studio — Create Shareable Market Visuals',
  description: 'Turn Pokémon TCG price data into beautiful shareable visuals. Insight cards, PSA premium gauges, market temperature charts and more. Free, no login required.',
  openGraph: {
    title: 'PokePrices Studio — Create Shareable Market Visuals',
    description: 'Turn Pokémon TCG price data into shareable visuals.',
    url: 'https://pokeprices.io/studio',
    siteName: 'PokePrices',
  },
  alternates: {
    canonical: 'https://pokeprices.io/studio',
  },
}

interface Props {
  searchParams: { card?: string; visual?: string }
}

export default function StudioPage({ searchParams }: Props) {
  return (
    <StudioPageClient
      initialCardSlug={searchParams.card}
    />
  )
}
