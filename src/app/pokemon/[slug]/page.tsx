// app/pokemon/[slug]/page.tsx
import PokemonSpeciesPageClient from './PokemonSpeciesPageClient'

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const name = slug.split('-').map((w: string) => w[0].toUpperCase() + w.slice(1)).join(' ')
  return {
    title: `${name} Cards & Prices | PokePrices`,
    description: `Every ${name} Pokémon card with live market prices, PSA 10 values, and grading data.`,
  }
}

export default async function PokemonSpeciesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  return <PokemonSpeciesPageClient slug={slug} />
}