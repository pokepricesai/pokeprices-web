// app/set/[slug]/card/[cardSlug]/page.tsx
import type { Metadata } from 'next'
import { createClient } from '@supabase/supabase-js'
import CardPageClient from './CardPageClient'

const supabaseServer = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function generateMetadata({ params }: { params: Promise<{ slug: string; cardSlug: string }> }): Promise<Metadata> {
  const { slug, cardSlug } = await params
  const setName = decodeURIComponent(slug)

  const { data: card } = await supabaseServer.rpc('get_card_detail_by_url_slug', {
    p_set_name: setName,
    p_card_url_slug: cardSlug,
  })

  if (!card) return { title: 'Card Not Found | PokePrices' }

  const rawFmt   = card.raw_usd   ? `$${(card.raw_usd / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : null
  const psa10Fmt = card.psa10_usd ? `$${(card.psa10_usd / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : null
  const psa9Fmt  = card.psa9_usd  ? `$${(card.psa9_usd / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : null

  const priceParts: string[] = []
  if (rawFmt)   priceParts.push(`Raw ${rawFmt}`)
  if (psa10Fmt) priceParts.push(`PSA 10 ${psa10Fmt}`)
  const priceStr = priceParts.length > 0 ? ` — ${priceParts.join(' · ')}` : ''

  const title = `${card.card_name} Price${priceStr} | PokePrices`

  const descParts: string[] = []
  if (rawFmt)   descParts.push(`Raw: ${rawFmt}`)
  if (psa9Fmt)  descParts.push(`PSA 9: ${psa9Fmt}`)
  if (psa10Fmt) descParts.push(`PSA 10: ${psa10Fmt}`)
  const priceDesc = descParts.length > 0 ? ` ${descParts.join(' · ')}.` : ''

  const description = `${card.card_name} from ${card.set_name}.${priceDesc} PSA population data, 30-day price trend, grading calculator and live eBay listings. Updated daily.`

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: card.image_url ? [{ url: card.image_url, width: 245, height: 342, alt: card.card_name }] : [],
      url: `https://pokeprices.io/set/${slug}/card/${cardSlug}`,
      siteName: 'PokePrices',
      type: 'website',
    },
    twitter: {
      card: 'summary',
      title,
      description,
      images: card.image_url ? [card.image_url] : [],
    },
    alternates: { canonical: `https://pokeprices.io/set/${slug}/card/${cardSlug}` },
  }
}

export default async function CardPage({ params }: { params: Promise<{ slug: string; cardSlug: string }> }) {
  const { slug, cardSlug } = await params
  const setName = decodeURIComponent(slug)
  return <CardPageClient setName={setName} cardUrlSlug={cardSlug} />
}