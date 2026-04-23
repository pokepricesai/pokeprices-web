// app/set/[slug]/page.tsx
import type { Metadata } from 'next'
import { createClient } from '@supabase/supabase-js'
import SetPageClient from './SetPageClient'

const supabaseServer = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const setName = decodeURIComponent(slug)

  const title       = `${setName} Price Guide: Best Cards, Raw Prices, PSA 10 Values`
  const description = `Explore ${setName} card prices, chase cards, raw vs PSA 10 spreads and the cards collectors are grading most aggressively. Updated daily.`
  const canonical   = `https://www.pokeprices.io/set/${slug}`

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

export default async function SetPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  return <SetPageClient slug={slug} />
}