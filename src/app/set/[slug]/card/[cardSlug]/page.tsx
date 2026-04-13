// app/set/[slug]/card/[cardSlug]/page.tsx
import type { Metadata } from 'next'
import { createClient } from '@supabase/supabase-js'
import CardPageClient from './CardPageClient'

const supabaseServer = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

function fmt(cents: number): string {
  const v = cents / 100
  return v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v.toFixed(0)}`
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string; cardSlug: string }> }): Promise<Metadata> {
  const { slug, cardSlug } = await params
  const setName = decodeURIComponent(slug)

  const { data: card } = await supabaseServer.rpc('get_card_detail_by_url_slug', {
    p_set_name: setName,
    p_card_url_slug: cardSlug,
  })

  if (!card) return { title: 'Card Not Found | PokePrices' }

  const name     = card.card_name
  const num      = card.card_number ? ` #${card.card_number}` : ''
  const rawUsd   = card.raw_usd   ? card.raw_usd   / 100 : null
  const psa9Usd  = card.psa9_usd  ? card.psa9_usd  / 100 : null
  const psa10Usd = card.psa10_usd ? card.psa10_usd / 100 : null
  const multiple = rawUsd && psa10Usd ? psa10Usd / rawUsd : null
  const canonical = `https://pokeprices.io/set/${slug}/card/${cardSlug}`

  // Variant A: grading-focused (PSA 10 is 3x+ the raw price)
  const useGradingVariant = multiple != null && multiple >= 3

  let title: string
  let description: string

  if (useGradingVariant) {
    title = `${name}${num}: Is It Worth Grading? Raw vs PSA 10`
    description = rawUsd && psa10Usd
      ? `${name}${num} — Raw ${fmt(card.raw_usd)}, PSA 10 ${fmt(card.psa10_usd)} (${multiple.toFixed(1)}x). Grading gap, price trend, PSA population data and whether the upside is worth the risk.`
      : `See raw, PSA 9 and PSA 10 prices for ${name}${num}. Compare the grading gap, recent trend and whether the upside looks worth the risk.`
  } else {
    title = `${name}${num} Price: Raw, PSA 9, PSA 10`
    description = rawUsd
      ? `${name}${num} from ${card.set_name} — Raw ${fmt(card.raw_usd)}${psa9Usd ? `, PSA 9 ${fmt(card.psa9_usd)}` : ''}${psa10Usd ? `, PSA 10 ${fmt(card.psa10_usd)}` : ''}. Price trend, grading spread, PSA population and live eBay listings.`
      : `Track ${name}${num} prices across raw, PSA 9 and PSA 10. See current value, grading spread, recent trend and population-backed context.`
  }

  return {
    title: `${title} | PokePrices`,
    description,
    openGraph: {
      title,
      description,
      images: card.image_url ? [{ url: card.image_url, width: 245, height: 342, alt: name }] : [],
      url: canonical,
      siteName: 'PokePrices',
      type: 'website',
    },
    twitter: {
      card: 'summary',
      title,
      description,
      images: card.image_url ? [card.image_url] : [],
    },
    alternates: { canonical },
  }
}

export default async function CardPage({ params }: { params: Promise<{ slug: string; cardSlug: string }> }) {
  const { slug, cardSlug } = await params
  const setName = decodeURIComponent(slug)
  return <CardPageClient setName={setName} cardUrlSlug={cardSlug} />
}