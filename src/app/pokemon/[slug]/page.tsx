// app/pokemon/[slug]/page.tsx
import type { Metadata } from 'next'
import PokemonSpeciesPageClient from './PokemonSpeciesPageClient'

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const name = slug.split('-').map((w: string) => w[0].toUpperCase() + w.slice(1)).join(' ')

  const year        = new Date().getFullYear()
  const title       = `${name} Card Value (${year}) — Every ${name} Card + Prices`
  const description = `How much are ${name} cards worth? See every ${name} Pokémon card with current raw and PSA 10 values, grading spreads and market trends across all sets. Updated daily.`
  const canonical   = `https://www.pokeprices.io/pokemon/${slug}`

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: canonical,
      siteName: 'PokePrices',
      type: 'website',
    },
    twitter: { card: 'summary', title, description },
    alternates: { canonical },
  }
}

export default async function PokemonSpeciesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  return <PokemonSpeciesPageClient slug={slug} />
}