// app/set/[slug]/page.tsx
import type { Metadata } from 'next'
import { cache } from 'react'
import { createClient } from '@supabase/supabase-js'
import { notFound } from 'next/navigation'
import SetPageClient from './SetPageClient'

export const revalidate = 86400

const supabaseServer = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// Shared existence check. Two layers, both cheap:
//   1. set_metadata row by exact set_name match (canonical source of
//      truth that drives sitemap-sets.xml)
//   2. fallback to a cards.set_name lookup — sets without a metadata
//      row but with cards in the DB still render rather than 404
// We don't gate on either query failing transiently; only when BOTH
// return zero rows do we call notFound().
const setExists = cache(async (setName: string): Promise<boolean> => {
  try {
    const { data: meta } = await supabaseServer
      .from('set_metadata')
      .select('set_name')
      .eq('set_name', setName)
      .maybeSingle()
    if (meta) return true
    const { data: card } = await supabaseServer
      .from('cards')
      .select('set_name')
      .eq('set_name', setName)
      .limit(1)
      .maybeSingle()
    return !!card
  } catch (e) {
    console.error('[set/[slug]] existence check error:', e)
    return true   // fail-open: don't 404 on a transient DB error
  }
})

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const setName = decodeURIComponent(slug)

  // Soft-404 fix: prior version rendered metadata for any URL slug,
  // even nonsense ones. Confirm the set exists before promising Google
  // a canonical for it.
  if (!(await setExists(setName))) notFound()

  const year        = new Date().getFullYear()
  const title       = `${setName} Card List & Price Guide (${year}) — Card Prices, PSA 10 Values | PokePrices`
  const description = `${setName} card list with live raw and PSA 10 prices for every card. Price guide with grading spreads, chase cards and 30-day trends. Full ${setName} checklist updated daily.`
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
  const setName = decodeURIComponent(slug)
  if (!(await setExists(setName))) notFound()
  return <SetPageClient slug={slug} />
}
