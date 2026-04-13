// app/pokemon/[slug]/page.tsx
import type { Metadata } from 'next'
import PokemonSpeciesPageClient from './PokemonSpeciesPageClient'

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const name = slug.split('-').map((w: string) => w[0].toUpperCase() + w.slice(1)).join(' ')

  const title       = `${name} Pokémon Card Prices: Best Cards, PSA 10s and Trends`
  const description = `Track the top ${name} cards by raw price, PSA 10 value, demand and grading potential. A clean view of what collectors care about most.`
  const canonical   = `https://pokeprices.io/pokemon/${slug}`

  return {
    title: `${title} | PokePrices`,
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