// app/studio/page.tsx
import type { Metadata } from 'next'
import StudioPageClient from './StudioPageClient'

export const metadata: Metadata = {
  title: 'PokePrices Studio — Create Shareable Market Visuals',
  description: 'Turn Pokémon TCG price data into beautiful shareable visuals. PSA gauge, market temperature, peak distance and more. Free, no login required.',
  openGraph: {
    title: 'PokePrices Studio — Shareable Pokémon Market Visuals',
    description: 'Turn Pokémon TCG price data into shareable visuals.',
    url: 'https://www.pokeprices.io/studio',
    siteName: 'PokePrices',
  },
  alternates: { canonical: 'https://www.pokeprices.io/studio' },
}

interface Props {
  searchParams: { card?: string; visual?: string }
}

export default function StudioPage({ searchParams }: Props) {
  return (
    <StudioPageClient
      initialCardSlug={searchParams.card}
      initialVisual={searchParams.visual}
    />
  )
}
