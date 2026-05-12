import type { Metadata } from 'next'
import HeatmapClient from './HeatmapClient'

export const metadata: Metadata = {
  title: 'Pokémon TCG market heatmap — 30-day price movement | PokePrices',
  description: 'A grid of the most-watched Pokémon cards, colour-coded by 30-day price movement. Spot the whole market at a glance — only volume-verified sales.',
  alternates: { canonical: 'https://www.pokeprices.io/visualisations/heatmap' },
}

export default function HeatmapPage() {
  return <HeatmapClient />
}
