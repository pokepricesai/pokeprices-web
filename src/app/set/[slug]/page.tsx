// app/set/[slug]/page.tsx
import type { Metadata } from 'next'
import { createClient } from '@supabase/supabase-js'
import SetPageClient from './SetPageClient'

const supabaseServer = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const setName = decodeURIComponent(params.slug)

  // Fetch set stats for richer titles
  const { data: setData } = await supabaseServer
    .from('cards')
    .select('set_release_date')
    .eq('set_name', setName)
    .not('set_release_date', 'is', null)
    .limit(1)
    .single()

  const year = setData?.set_release_date
    ? new Date(setData.set_release_date).getFullYear()
    : null

  const titleYear = year ? ` (${year})` : ''

  const title = `${setName}${titleYear} Card Prices — Complete Price Guide | PokePrices`
  const description = `All ${setName} Pokémon card prices — raw, PSA 9 and PSA 10 values, grading calculator, PSA population data and 30-day price trends. Updated daily.`

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `https://pokeprices.io/set/${params.slug}`,
      siteName: 'PokePrices',
      type: 'website',
    },
    twitter: {
      card: 'summary',
      title,
      description,
    },
    alternates: {
      canonical: `https://pokeprices.io/set/${params.slug}`,
    },
  }
}

export default function SetPage({ params }: { params: { slug: string } }) {
  return <SetPageClient slug={params.slug} />
}
