// app/studio/page.tsx
import type { Metadata } from 'next'
import StudioPageClient from './StudioPageClient'

export const metadata: Metadata = {
  title: 'PokePrices Studio — Free Pokémon Card Market Visuals (PNG Export)',
  description: 'Turn Pokémon TCG price data into shareable visuals — PSA gauge, market temperature, peak distance and more. Free PNG export, no login required.',
  openGraph: {
    title: 'PokePrices Studio — Free Pokémon Card Market Visuals',
    description: 'Turn Pokémon TCG price data into shareable PNG visuals. PSA gauge, market temperature and more. Free.',
    url: 'https://www.pokeprices.io/studio',
    siteName: 'PokePrices',
    type: 'website',
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
