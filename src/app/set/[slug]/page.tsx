// app/set/[slug]/page.tsx
import type { Metadata } from 'next'
import { createClient } from '@supabase/supabase-js'
import SetPageClient from './SetPageClient'

export const revalidate = 86400

const supabaseServer = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const setName = decodeURIComponent(slug)

  const year        = new Date().getFullYear()
  const title       = `${setName} Card List (${year}) — All Cards, Prices & PSA 10 Values`
  const description = `Every card from ${setName} with current raw and PSA 10 prices, grading spreads and chase cards. Full ${setName} checklist with market trends. Updated daily.`
  const canonical   = `https://www.pokeprices.io/set/${slug}`

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

export default async function SetPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  return <SetPageClient slug={slug} />
}