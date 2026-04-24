import PokemonPageClient from './PokemonPageClient'

export const metadata = {
  title: 'All Pokémon Cards by Species (2026) — 1,025 Pokémon, Live Prices',
  description: 'Browse all 1,025 Pokémon species and find every card they appear on. Raw prices, PSA 10 values, full checklists and grading data across every Pokémon TCG set. Free, no login.',
  alternates: { canonical: 'https://www.pokeprices.io/pokemon' },
}

export default function PokemonPage() {
  return <PokemonPageClient />
}
