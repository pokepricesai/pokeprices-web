import type { Metadata } from 'next'
import DealerPageClient from './DealerPageClient'

export const metadata: Metadata = {
  title: 'Pokémon Card Trade Calculator — Fair Value & Cash/Trade Modes | PokePrices',
  description: 'Free Pokémon TCG trade calculator. Build two stacks of cards side-by-side, see live fair-market values, apply cash, trade-credit or blended percentages. PSA 10, PSA 9, CGC 9.5 and raw prices supported.',
  alternates: { canonical: 'https://www.pokeprices.io/dealer' },
  openGraph: {
    title: 'Pokémon Card Trade Calculator — Fair Value & Cash/Trade Modes',
    description: 'Build two stacks of cards side-by-side, see fair-market values, apply cash or trade-credit percentages. Free, no login.',
    url: 'https://www.pokeprices.io/dealer',
    siteName: 'PokePrices',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Pokémon Card Trade Calculator — Fair Value & Cash/Trade Modes',
    description: 'Build two stacks of cards side-by-side, see fair-market values, apply cash or trade-credit percentages.',
  },
}

export default function DealerPage() {
  return <DealerPageClient />
}
