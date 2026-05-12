import type { Metadata } from 'next'
import RisersFallersClient from './RisersFallersClient'

export const metadata: Metadata = {
  title: 'Pokémon TCG risers & fallers — biggest 30d / 90d / 365d moves | PokePrices',
  description: 'Leaderboards of the biggest Pokémon card movers over 30, 90 and 365 days. Volume-verified sold listings only — no asking-price noise.',
  alternates: { canonical: 'https://www.pokeprices.io/visualisations/risers-fallers' },
}

export default function RisersFallersPage() {
  return <RisersFallersClient />
}
