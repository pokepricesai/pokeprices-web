import PokemonSpeciesPageClient from './PokemonSpeciesPageClient'

export async function generateMetadata({ params }: { params: { slug: string } }) {
  const name = params.slug.split('-').map((w: string) => w[0].toUpperCase() + w.slice(1)).join(' ')
  return {
    title: `${name} Cards & Prices | PokePrices`,
    description: `Every ${name} Pokémon card with live market prices, PSA 10 values, and grading data.`,
  }
}

export default function PokemonSpeciesPage({ params }: { params: { slug: string } }) {
  return <PokemonSpeciesPageClient slug={params.slug} />
}
