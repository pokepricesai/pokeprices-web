import PokemonPageClient from './PokemonPageClient'

export const metadata = {
  title: 'Pokémon | PokePrices',
  description: 'Browse all 1025 Pokémon species and find every card they appear on with live market prices.',
}

export default function PokemonPage() {
  return <PokemonPageClient />
}
