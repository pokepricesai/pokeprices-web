import type { Metadata } from 'next'
import ToolsHubClient from './ToolsHubClient'

export const metadata: Metadata = {
  title: 'Tools for Pokémon TCG collectors | PokePrices',
  description: 'Calculators, trackers and creator tools built on real Pokémon TCG sold-listing data. Grading ROI, card show planner, portfolio tracker, smart price alerts and more — all free.',
  alternates: { canonical: 'https://www.pokeprices.io/tools' },
}

export default function ToolsHubPage() {
  return <ToolsHubClient />
}
