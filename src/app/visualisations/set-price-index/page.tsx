import type { Metadata } from 'next'
import SetPriceIndexClient from './SetPriceIndexClient'

export const metadata: Metadata = {
  title: 'Pokémon TCG set price index — compare any two sets over time | PokePrices',
  description: 'Track and compare total set value over time. Pick any Pokémon TCG sets, see the price trend on one chart, find which sets are running and which are cooling.',
  alternates: { canonical: 'https://www.pokeprices.io/visualisations/set-price-index' },
}

export default function SetPriceIndexPage() {
  return <SetPriceIndexClient />
}
