import type { Metadata } from 'next'
import { createClient } from '@supabase/supabase-js'
import SetPageClient from './SetPageClient'

const supabaseServer = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const setName = decodeURIComponent(params.slug)
  return {
    title: `${setName} — Card Prices`,
    description: `All ${setName} Pokémon card prices, PSA population data and market trends. Updated daily.`,
    openGraph: {
      title: `${setName} | PokePrices`,
      url: `https://pokeprices.io/set/${params.slug}`,
    },
  }
}

export default function SetPage({ params }: { params: { slug: string } }) {
  return <SetPageClient slug={params.slug} />
}
